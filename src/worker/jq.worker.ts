import * as Comlink from 'comlink'
import { loadJq } from 'jq-wasm'
import wasmURL from 'jq-wasm/jq.wasm?url'
import { createEngine } from './engine.ts'

/**
 * Invariant 4: jq runs in a Web Worker, always. The main thread never touches
 * the WASM module, so canvas interaction stays smooth while a transform runs.
 * The engine itself lives in engine.ts; jq is instantiated on first use.
 */
Comlink.expose(createEngine(() => loadJq({ wasmURL })))
