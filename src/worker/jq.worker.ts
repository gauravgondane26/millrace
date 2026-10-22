import * as Comlink from 'comlink'
import init, { run as wasmRun } from './jqpkg/jq_wasm.js'

/**
 * Invariant 4: jq runs in a Web Worker, always. The main thread never touches
 * the WASM module, so canvas interaction stays smooth while a transform runs.
 *
 * The engine is jaq compiled to WASM (see crates/jq-wasm). It speaks the stream
 * convention: `input` is a JSON array of values, and the result is a JSON array
 * of all values the filter emitted across that stream.
 */

export interface JqError {
  kind: 'compile' | 'runtime'
  message: string
}

export interface JqApi {
  /** Apply a single jq filter to a stream of JSON input values. */
  run(filter: string, input: unknown): Promise<unknown>
}

// Instantiate the wasm module once, lazily, on the first run.
let ready: Promise<unknown> | null = null
function ensureReady(): Promise<unknown> {
  if (!ready) ready = init()
  return ready
}

const api: JqApi = {
  async run(filter, input) {
    await ensureReady()
    const inputsJson = JSON.stringify(input === undefined ? [] : input)
    // wasmRun throws a JS Error (readable message) on parse/compile/runtime
    // failure; comlink forwards it to the caller as a rejected promise.
    const outputsJson = wasmRun(filter, inputsJson)
    return JSON.parse(outputsJson)
  },
}

Comlink.expose(api)
