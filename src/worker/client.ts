import * as Comlink from 'comlink'
import type { JqApi, RunOutput } from './engine.ts'
import type { RunFilter } from '../core/eval/cache.ts'
import { SAMPLE_ITEMS, type Sample } from '../core/eval/sample.ts'

export type { RunOutput }

/**
 * Most compact output a preview keeps, in characters (about 1 MB of typical
 * JSON; invariant 4: previews are samples). jq buffers its whole output, so
 * this bounds what is kept and shown, not how long a runaway filter runs:
 * that is the timeout below, and jq's 256 MB heap.
 */
export const PREVIEW_OUTPUT_LIMIT = 1_000_000

/** How an engine call failed. `crash` and `timeout` also restart the worker. */
export type EngineErrorKind = 'input' | 'compile' | 'runtime' | 'crash' | 'timeout'

export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** Longest one call may take before the worker is presumed stuck. */
const TIMEOUT_MS = 10_000

/**
 * Longest a "run full" may take: the whole program on a whole input of up to
 * 50 MB or so can take seconds, and the user asked for it (and can stop it).
 */
export const FULL_RUN_TIMEOUT_MS = 60_000

/**
 * jq on an input this large grows the wasm heap by hundreds of MB, and wasm
 * memory never shrinks; the worker that ran it is retired once idle, and the
 * next call starts a fresh one.
 */
export const RETIRE_AFTER_INPUT = 10_000_000

/** How long an abandoned call may keep its worker busy before the worker goes. */
const ABANDON_GRACE_MS = 300

/** The names engine.ts gives its errors. */
const KINDS: Partial<Record<string, EngineErrorKind>> = {
  JqInputError: 'input',
  JqCompileError: 'compile',
  JqRuntimeError: 'runtime',
}

interface Engine {
  worker: Worker
  api: Comlink.Remote<JqApi>
  /** Calls sent to this worker that haven't settled. */
  pending: Set<Call>
  /** Terminate once `pending` empties: it ran jq on a large input. */
  retiring: boolean
}

interface Call {
  run: (api: Comlink.Remote<JqApi>) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  /** The caller stopped waiting (aborted); whatever comes back is dropped. */
  abandoned: boolean
  engine: Engine | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  timeoutMs: number
  /** Retire the worker afterwards (RETIRE_AFTER_INPUT). */
  retire: boolean
  detach: () => void
}

/**
 * Main-thread handle to the jq worker, spawned lazily so the WASM module is
 * only instantiated when the first preview runs.
 *
 * jq can't be interrupted mid-run, so a worker whose call crashes, times out
 * (an infinite filter blocks it for good) or is abandoned while still busy is
 * terminated. Only that call fails: the others it was holding are bystanders
 * and are re-sent to a fresh worker, so they never inherit its error.
 */
let engine: Engine | null = null

function getEngine(): Engine {
  if (!engine) {
    const worker = new Worker(new URL('./jq.worker.ts', import.meta.url), { type: 'module' })
    engine = { worker, api: Comlink.wrap<JqApi>(worker), pending: new Set(), retiring: false }
  }
  return engine
}

const isCurrent = (call: Call, target: Engine) => call.engine === target && target.pending.has(call)

function finish(call: Call): void {
  clearTimeout(call.timer)
  call.detach()
  const target = call.engine
  if (!target) return
  target.pending.delete(call)
  if (call.retire) {
    target.retiring = true
    if (engine === target) engine = null // new calls get a fresh worker
  }
  if (target.retiring && target.pending.size === 0) target.worker.terminate()
}

function dispatch(call: Call): void {
  const target = getEngine()
  call.engine = target
  target.pending.add(call)
  call.timer = setTimeout(() => {
    const seconds = call.timeoutMs / 1000
    restart(target, call, new EngineError('timeout', `Stopped after ${seconds} s: the filter may never finish.`))
  }, call.timeoutMs)

  call.run(target.api).then(
    (value) => {
      if (!isCurrent(call, target)) return
      finish(call)
      if (!call.abandoned) call.resolve(value)
    },
    (e: unknown) => {
      if (!isCurrent(call, target)) return
      const name = e instanceof Error ? e.name : ''
      const message = e instanceof Error ? e.message : String(e)
      const kind = KINDS[name]
      if (kind) {
        finish(call)
        if (!call.abandoned) call.reject(new EngineError(kind, message))
        return
      }
      // Anything else is the wasm trapping or overflowing its stack; its
      // state can no longer be trusted, so start over.
      restart(target, call, new EngineError('crash', crashMessage(message)))
    },
  )
}

/**
 * What a crash says, in place of Emscripten's own words ("Aborted(). Build
 * with -sASSERTIONS for more info."), which mean nothing to someone running
 * a filter. jq-wasm aborts when its heap runs out (1 GB here, raised from
 * 256 MB by scripts/patch-jq-wasm.mjs), and overflowing its stack (values
 * nested thousands deep) reads as a memory fault.
 */
export function crashMessage(message: string): string {
  if (/^Aborted\(/.test(message)) {
    return 'jq ran out of memory and was restarted. It has 1 GB to work in here.'
  }
  if (/memory access out of bounds|call stack/i.test(message)) {
    return 'jq ran out of stack, likely on values nested thousands of levels deep, and was restarted.'
  }
  return `The jq engine crashed and was restarted: ${message}`
}

function restart(target: Engine, culprit: Call, error: EngineError): void {
  target.worker.terminate()
  if (engine === target) engine = null
  const bystanders = [...target.pending].filter((c) => c !== culprit)
  for (const c of target.pending) clearTimeout(c.timer)
  target.pending.clear()

  culprit.detach()
  if (!culprit.abandoned) culprit.reject(error)
  for (const c of bystanders) {
    if (c.abandoned) c.detach()
    else dispatch(c)
  }
}

interface CallOptions {
  timeoutMs?: number
  retire?: boolean
}

function call<T>(
  run: (api: Comlink.Remote<JqApi>) => Promise<T>,
  signal?: AbortSignal,
  { timeoutMs = TIMEOUT_MS, retire = false }: CallOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      c.abandoned = true
      reject(signal?.reason)
      const target = c.engine
      setTimeout(() => {
        if (target && isCurrent(c, target)) restart(target, c, new EngineError('timeout', 'Abandoned.'))
      }, ABANDON_GRACE_MS)
    }
    const c: Call = {
      run,
      resolve: resolve as (value: unknown) => void,
      reject,
      abandoned: false,
      engine: undefined,
      timer: undefined,
      timeoutMs,
      retire,
      detach: () => signal?.removeEventListener('abort', onAbort),
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    dispatch(c)
  })
}

/**
 * Run one filter in the worker, keeping about `maxOutput` characters of
 * output, stopping it after `timeoutMs`.
 */
export const runInWorker = (
  filter: string,
  input: string,
  maxOutput = PREVIEW_OUTPUT_LIMIT,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS,
): Promise<RunOutput> =>
  call((api) => api.run(filter, input, maxOutput), signal, { timeoutMs, retire: input.length >= RETIRE_AFTER_INPUT })

/** A {@link RunFilter} backed by the workered jq instance. */
export const runFilterInWorker: RunFilter = (filter, input, signal) =>
  runInWorker(filter, input, PREVIEW_OUTPUT_LIMIT, signal)

/** Pretty-print JSON text in the worker, for display. */
export const formatInWorker = (text: string, indent = 2, signal?: AbortSignal): Promise<string> =>
  call((api) => api.format(text, indent), signal)

/** Cut input text to a preview sample in the worker (core/eval/sample). */
export const sampleInWorker = (text: string, limit = SAMPLE_ITEMS, signal?: AbortSignal): Promise<Sample> =>
  call((api) => api.sample(text, limit), signal)
