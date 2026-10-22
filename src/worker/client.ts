import * as Comlink from 'comlink'
import type { JqApi, RunOutput } from './engine.ts'
import type { RunFilter } from '../core/eval/cache.ts'

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

/** The names the wasm gives its errors (crates/jq-wasm). */
const KINDS: Partial<Record<string, EngineErrorKind>> = {
  JqInputError: 'input',
  JqCompileError: 'compile',
  JqRuntimeError: 'runtime',
}

interface Engine {
  worker: Worker
  api: Comlink.Remote<JqApi>
  /** Rejecters of calls still in flight, run if the worker is killed. */
  pending: Set<(error: EngineError) => void>
}

/**
 * Main-thread handle to the jq worker, spawned lazily so the WASM module is
 * only instantiated when the first preview runs. A worker that crashes or
 * runs too long (an infinite filter blocks it for good) is killed and the
 * next call gets a fresh one.
 */
let engine: Engine | null = null

function getEngine(): Engine {
  if (!engine) {
    const worker = new Worker(new URL('./jq.worker.ts', import.meta.url), { type: 'module' })
    engine = { worker, api: Comlink.wrap<JqApi>(worker), pending: new Set() }
  }
  return engine
}

function restart(target: Engine, error: EngineError): void {
  target.worker.terminate()
  for (const reject of target.pending) reject(error)
  target.pending.clear()
  if (engine === target) engine = null
}

function call<T>(fn: (api: Comlink.Remote<JqApi>) => Promise<T>): Promise<T> {
  const target = getEngine()
  return new Promise<T>((resolve, reject) => {
    const fail = (error: EngineError) => {
      clearTimeout(timer)
      target.pending.delete(fail)
      reject(error)
    }
    const timer = setTimeout(() => {
      const seconds = TIMEOUT_MS / 1000
      restart(target, new EngineError('timeout', `Stopped after ${seconds} s: the filter may never finish.`))
    }, TIMEOUT_MS)
    target.pending.add(fail)

    fn(target.api).then(
      (value) => {
        clearTimeout(timer)
        target.pending.delete(fail)
        resolve(value)
      },
      (e: unknown) => {
        const name = e instanceof Error ? e.name : ''
        const message = e instanceof Error ? e.message : String(e)
        const kind = KINDS[name]
        if (kind) return fail(new EngineError(kind, message))
        // Anything else is the wasm trapping or overflowing its stack; its
        // state can no longer be trusted, so start over.
        fail(new EngineError('crash', `The jq engine crashed and was restarted: ${message}`))
        restart(target, new EngineError('crash', 'The jq engine crashed and was restarted.'))
      },
    )
  })
}

/** Run one filter in the worker, keeping about `maxOutput` characters of output. */
export const runInWorker = (
  filter: string,
  input: string,
  maxOutput = PREVIEW_OUTPUT_LIMIT,
): Promise<RunOutput> => call((api) => api.run(filter, input, maxOutput))

/** A {@link RunFilter} backed by the workered jq instance. */
export const runFilterInWorker: RunFilter = (filter, input) =>
  runInWorker(filter, input).then((out) => out.text)

/** Pretty-print JSON text in the worker, for display. */
export const formatInWorker = (text: string, indent = 2): Promise<string> =>
  call((api) => api.format(text, indent))
