/* tslint:disable */
/* eslint-disable */

/**
 * Pretty-print JSON text (a sequence of values) for display, `indent` spaces
 * per level, one value after another.
 */
export function format(text: string, indent: number): string;

/**
 * Apply `filter` to each JSON value in `input`, returning every output value
 * as compact JSON, one per line. Throws an `Error` named `JqInputError`,
 * `JqCompileError` or `JqRuntimeError` with a readable message.
 *
 * Stops once the output reaches `max_output` bytes, at a value boundary, and
 * sets [`truncated`]: a filter like `repeat(1)` never ends, and collecting its
 * output would exhaust memory long before the worker's timeout fires.
 */
export function run(filter: string, input: string, max_output: number): string;

/**
 * Whether the last [`run`] stopped at its `max_output` before the filter ended.
 */
export function truncated(): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly format: (a: number, b: number, c: number) => [number, number, number, number];
    readonly run: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly truncated: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
