import * as Comlink from 'comlink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineError } from './client.ts'
import type { JqApi, RunOutput } from './engine.ts'

/**
 * The client's restart logic, against a fake Worker: a MessageChannel whose far
 * end exposes `behavior` over comlink, as the real worker exposes the engine.
 */
let behavior: JqApi
const workers: FakeWorker[] = []

class FakeWorker {
  readonly port: MessagePort
  terminated = false

  constructor() {
    const { port1, port2 } = new MessageChannel()
    Comlink.expose(
      {
        run: (f: string, i: string, max: number) => behavior.run(f, i, max),
        format: (t: string, n: number) => behavior.format(t, n),
        sample: (t: string, n: number) => behavior.sample(t, n),
      },
      port2,
    )
    this.port = port1
    workers.push(this)
  }
  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.port.postMessage(message, transfer)
  }
  addEventListener(type: 'message', listener: (e: MessageEvent) => void) {
    this.port.addEventListener(type, listener)
    this.port.start()
  }
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void) {
    this.port.removeEventListener(type, listener)
  }
  terminate() {
    this.terminated = true
    this.port.close()
  }
}

const named = (name: string, message: string) => Object.assign(new Error(message), { name })
const ok = (text: string): RunOutput => ({ text, truncated: false })
const never = () => new Promise<RunOutput>(() => {}) // e.g. until(false; .), which outputs nothing

async function loadClient() {
  vi.resetModules() // a fresh client, and so a fresh worker, per test
  return import('./client.ts')
}

async function rejection(promise: Promise<unknown>): Promise<EngineError> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: EngineError) => e,
  )
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  behavior = {
    run: async (f, i) => ok(`${i} | ${f}`),
    format: async (t) => t,
    sample: async (t) => ({ text: t, sampled: false }),
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const w of workers.splice(0)) w.terminate()
})

describe('worker client', () => {
  it('passes results through', async () => {
    const { runFilterInWorker } = await loadClient()
    expect(await runFilterInWorker('.a', '1')).toEqual(ok('1 | .a'))
  })

  it('maps the engine error names to kinds, keeping the worker', async () => {
    const { runFilterInWorker } = await loadClient()
    behavior.run = async () => {
      throw named('JqCompileError', 'undefined filter')
    }
    const e = await rejection(runFilterInWorker('nope', '1'))
    expect([e.kind, e.message]).toEqual(['compile', 'undefined filter'])

    behavior.run = async () => ok('ok')
    await runFilterInWorker('.', '1')
    expect(workers).toHaveLength(1)
  })

  it('restarts the worker after a crash', async () => {
    const { runFilterInWorker } = await loadClient()
    behavior.run = async () => {
      throw named('RuntimeError', 'unreachable')
    }
    expect((await rejection(runFilterInWorker('.', '1'))).kind).toBe('crash')
    expect(workers[0]?.terminated).toBe(true)

    behavior.run = async () => ok('ok')
    expect(await runFilterInWorker('.', '1')).toEqual(ok('ok'))
    expect(workers).toHaveLength(2)
  })

  it('says what a crash means, not what Emscripten printed', async () => {
    const { crashMessage } = await loadClient()
    // what jq-wasm throws when its heap runs out, and on a deeply nested value
    expect(crashMessage('Aborted(). Build with -sASSERTIONS for more info.')).toMatch(/^jq ran out of memory/)
    expect(crashMessage('memory access out of bounds')).toMatch(/^jq ran out of stack/)
    expect(crashMessage('unreachable')).toBe('The jq engine crashed and was restarted: unreachable')
  })

  it('times out a filter that never finishes; calls queued behind it go to a fresh worker', async () => {
    vi.useFakeTimers()
    const { runFilterInWorker } = await loadClient()
    // the first worker never answers, as one stuck in `until(false; .)` wouldn't
    behavior.run = (f, i) => (workers.length === 1 ? never() : Promise.resolve(ok(`${i} | ${f}`)))

    const stuck = rejection(runFilterInWorker('stuck', '1'))
    const queued = runFilterInWorker('.a', '1')
    await vi.advanceTimersByTimeAsync(10_000)

    expect((await stuck).kind).toBe('timeout')
    expect(await queued).toEqual(ok('1 | .a')) // a bystander never inherits another call's error
    expect(workers[0]?.terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })
})

describe('abandoning a call', () => {
  it('rejects at once, and a call that finishes quickly keeps its worker', async () => {
    const { runFilterInWorker } = await loadClient()
    let release: ((out: RunOutput) => void) | undefined
    behavior.run = () => new Promise((resolve) => (release = resolve))

    const controller = new AbortController()
    const call = runFilterInWorker('.', '1', controller.signal)
    await vi.waitFor(() => expect(release).toBeDefined()) // the worker has the call
    controller.abort(new Error('superseded'))
    await expect(call).rejects.toThrow('superseded')

    release?.(ok('late'))
    behavior.run = async () => ok('next')
    expect(await runFilterInWorker('.', '1')).toEqual(ok('next'))
    expect(workers).toHaveLength(1)
  })

  it('drops the worker of a call still busy after the grace period, re-sending the others', async () => {
    vi.useFakeTimers()
    const { runFilterInWorker } = await loadClient()
    behavior.run = (f, i) => (workers.length === 1 ? never() : Promise.resolve(ok(`${i} | ${f}`)))

    const controller = new AbortController()
    const abandoned = runFilterInWorker('slow', '1', controller.signal).catch((e: Error) => e.message)
    const bystander = runFilterInWorker('.b', '1')
    controller.abort(new Error('superseded'))
    await vi.advanceTimersByTimeAsync(300)

    expect(await abandoned).toBe('superseded')
    expect(workers[0]?.terminated).toBe(true)
    expect(await bystander).toEqual(ok('1 | .b'))
  })

  it('rejects straight away when the signal is already aborted', async () => {
    const { sampleInWorker } = await loadClient()
    const controller = new AbortController()
    controller.abort(new Error('gone'))
    await expect(sampleInWorker('[1]', 200, controller.signal)).rejects.toThrow('gone')
  })
})
