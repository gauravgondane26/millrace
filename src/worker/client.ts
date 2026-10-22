import * as Comlink from 'comlink'
import type { JqApi } from './jq.worker.ts'
import type { RunFilter } from '../core/eval/cache.ts'

/**
 * Main-thread handle to the jq worker. Lazily spawned so the WASM module is
 * only instantiated when the first preview actually runs.
 */
let proxy: Comlink.Remote<JqApi> | null = null

function getProxy(): Comlink.Remote<JqApi> {
  if (!proxy) {
    const worker = new Worker(new URL('./jq.worker.ts', import.meta.url), {
      type: 'module',
    })
    proxy = Comlink.wrap<JqApi>(worker)
  }
  return proxy
}

/** A {@link RunFilter} backed by the workered jaq instance. */
export const runFilterInWorker: RunFilter = (filter, input) => getProxy().run(filter, input)

/** Pretty-print JSON text in the worker, for display. */
export const formatInWorker = (text: string, indent = 2): Promise<string> =>
  getProxy().format(text, indent)
