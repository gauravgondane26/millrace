import * as Comlink from 'comlink'
import init, {
  format as wasmFormat,
  run as wasmRun,
  truncated as wasmTruncated,
} from './jqpkg/jq_wasm.js'

/**
 * Invariant 4: jq runs in a Web Worker, always. The main thread never touches
 * the WASM module, so canvas interaction stays smooth while a transform runs.
 *
 * The engine is jaq compiled to WASM (see crates/jq-wasm). JSON crosses the
 * boundary as text both ways and is never parsed into JS values here: that
 * would reorder integer-like object keys and round numbers.
 */
export interface RunOutput {
  /** Compact JSON, one value per line. */
  text: string
  /** Output stopped at the size cap; the filter would have produced more. */
  truncated: boolean
}

export interface JqApi {
  /**
   * Apply one jq filter to `input` (zero or more JSON values), keeping at most
   * `maxOutput` bytes of output. Rejects with an Error named JqInputError,
   * JqCompileError or JqRuntimeError.
   */
  run(filter: string, input: string, maxOutput: number): Promise<RunOutput>
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
  async run(filter, input, maxOutput) {
    await ensureReady()
    const text = wasmRun(filter, input, maxOutput)
    return { text, truncated: wasmTruncated() }
  },
  async format(text, indent) {
    await ensureReady()
    return wasmFormat(text, indent)
  },
}

Comlink.expose(api)
