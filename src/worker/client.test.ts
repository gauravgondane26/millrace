import * as Comlink from 'comlink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineError } from './client.ts'
import type { JqApi } from './jq.worker.ts'

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
  behavior = { run: async (f, i) => ({ text: `${i} | ${f}`, truncated: false }), format: async (t) => t }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const w of workers.splice(0)) w.terminate()
})

describe('worker client', () => {
  it('passes results through', async () => {
    const { runFilterInWorker } = await loadClient()
    expect(await runFilterInWorker('.a', '1')).toBe('1 | .a')
  })

  it('maps the engine error names to kinds, keeping the worker', async () => {
    const { runFilterInWorker } = await loadClient()
    behavior.run = async () => {
      throw named('JqCompileError', 'undefined filter')
    }
    const e = await rejection(runFilterInWorker('nope', '1'))
    expect([e.kind, e.message]).toEqual(['compile', 'undefined filter'])

    behavior.run = async () => ({ text: 'ok', truncated: false })
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

    behavior.run = async () => ({ text: 'ok', truncated: false })
    expect(await runFilterInWorker('.', '1')).toBe('ok')
    expect(workers).toHaveLength(2)
  })

  it('stops a filter that never finishes, failing every call queued on it', async () => {
    vi.useFakeTimers()
    const { runFilterInWorker } = await loadClient()
    behavior.run = () => new Promise(() => {}) // e.g. until(false; .), which outputs nothing

    const first = rejection(runFilterInWorker('until(false; .)', '1'))
    const queued = rejection(runFilterInWorker('.', '1'))
    await vi.advanceTimersByTimeAsync(10_000)

    expect((await first).kind).toBe('timeout')
    expect((await queued).kind).toBe('timeout')
    expect(workers[0]?.terminated).toBe(true)

    behavior.run = async () => ({ text: 'ok', truncated: false })
    expect(await runFilterInWorker('.', '1')).toBe('ok')
    expect(workers).toHaveLength(2)
  })
})
