import * as Comlink from 'comlink'

/**
 * Invariant 4: jq runs in a Web Worker, always. The main thread never touches
 * the WASM module, so canvas interaction stays smooth while a transform runs.
 *
 * TODO(wasm): load the jaq module here. jaq-compiled-to-WASM is not a turnkey
 * npm package — compile jaq (github.com/01mf02/jaq) to wasm, place the artifact
 * in `public/`, and instantiate it once below. `run()` then applies one filter
 * to one input and returns the JSON result (or a structured compile error that
 * the UI maps back to the offending node — never a stack trace).
 */

export interface JqError {
  kind: 'compile' | 'runtime'
  message: string
}

export interface JqApi {
  /** Apply a single jq filter to a single JSON input value. */
  run(filter: string, input: unknown): Promise<unknown>
}

const api: JqApi = {
  async run(_filter, _input) {
    throw new Error('jq worker: jaq wasm not yet wired — see TODO(wasm)')
  },
}

Comlink.expose(api)
