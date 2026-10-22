import * as Comlink from 'comlink'
import init, { format as wasmFormat, run as wasmRun } from './jqpkg/jq_wasm.js'

/**
 * Invariant 4: jq runs in a Web Worker, always. The main thread never touches
 * the WASM module, so canvas interaction stays smooth while a transform runs.
 *
 * The engine is jaq compiled to WASM (see crates/jq-wasm). JSON crosses the
 * boundary as text both ways and is never parsed into JS values here: that
 * would reorder integer-like object keys and round numbers.
 */
export interface JqApi {
  /**
   * Apply one jq filter to `input` (zero or more JSON values), returning the
   * outputs as compact JSON, one value per line. Rejects with an Error named
   * JqInputError, JqCompileError or JqRuntimeError.
   */
  run(filter: string, input: string): Promise<string>
  /** Pretty-print JSON text for display, keeping key order. */
  format(text: string, indent: number): Promise<string>
}

// Instantiate the wasm module once, lazily, on first use.
let ready: Promise<unknown> | null = null
function ensureReady(): Promise<unknown> {
  ready ??= init()
  return ready
}

const api: JqApi = {
  async run(filter, input) {
    await ensureReady()
    return wasmRun(filter, input)
  },
  async format(text, indent) {
    await ensureReady()
    return wasmFormat(text, indent)
  },
}

Comlink.expose(api)
