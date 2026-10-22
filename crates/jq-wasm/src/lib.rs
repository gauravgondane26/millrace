//! jaq compiled to WASM: applies one jq filter to a stream of JSON inputs.
//!
//! Invariant 4 (CLAUDE.md): this is the only place jq actually executes, and it
//! is driven from a Web Worker — never the main thread.
//!
//! Stream convention: a pipeline node's value is a *stream*, represented as a
//! JSON array of values. `run` applies `filter` to each input value and
//! concatenates every output value into a single JSON array. That way node k's
//! output array feeds directly in as node k+1's input array (invariant 3), and
//! jq's native "one input -> many outputs" fan-out is preserved.

use jaq_core::load::{Arena, File, Loader};
use jaq_core::{data, unwrap_valr, Compiler, Ctx, Vars};
use jaq_json::{read, Val};
use wasm_bindgen::prelude::*;

/// Apply `filter` to each value in the `inputs_json` stream (a JSON array),
/// returning all outputs as a JSON array string. Throws a JS error carrying a
/// readable message on invalid input, a parse/compile error, or a runtime trap.
#[wasm_bindgen]
pub fn run(filter: &str, inputs_json: &str) -> Result<String, JsError> {
    let inputs: Vec<serde_json::Value> = serde_json::from_str(inputs_json)
        .map_err(|e| JsError::new(&format!("input is not valid JSON: {e}")))?;

    // Named filters: core (length, keys, ...) + std (map, select, ...) + json.
    let defs = jaq_core::defs().chain(jaq_std::defs()).chain(jaq_json::defs());
    let funs = jaq_core::funs().chain(jaq_std::funs()).chain(jaq_json::funs());

    let loader = Loader::new(defs);
    let arena = Arena::default();
    let program = File { code: filter, path: () };

    let modules = loader
        .load(&arena, program)
        .map_err(|errs| JsError::new(&format!("parse error: {errs:?}")))?;

    let compiled = Compiler::default()
        .with_funs(funs)
        .compile(modules)
        .map_err(|errs| JsError::new(&format!("compile error: {errs:?}")))?;

    let mut outputs: Vec<String> = Vec::new();
    for value in inputs {
        let text = value.to_string();
        let input = read::parse_single(&text.as_bytes())
            .map_err(|e| JsError::new(&format!("input parse error: {e}")))?;
        let ctx = Ctx::<data::JustLut<Val>>::new(&compiled.lut, Vars::new([]));
        for result in compiled.id.run((ctx, input)).map(unwrap_valr) {
            match result {
                Ok(v) => outputs.push(v.to_string()),
                Err(e) => return Err(JsError::new(&format!("runtime error: {e}"))),
            }
        }
    }

    Ok(format!("[{}]", outputs.join(",")))
}
