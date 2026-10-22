//! jaq compiled to WASM: runs one jq filter over JSON text.
//!
//! Invariant 4 (CLAUDE.md): this is the only place jq executes, and it is
//! driven from a Web Worker, never the main thread.
//!
//! JSON crosses the JS boundary as text, never as parsed JS values, so jq
//! semantics survive it: object key order (JS moves integer-like keys first),
//! number literals, and several input documents in one paste. Input is jq's
//! input format, zero or more JSON values. Output is one compact JSON value per
//! line, which is valid input again, so a node's output feeds the next node.
//!
//! Built on jaq-all, the library behind the jaq CLI. A few natives are replaced
//! because wasm32-unknown-unknown has no clock, environment or stderr.

use core::fmt::{self, Display, Formatter};
use jaq_all::data::{self, DataKind, Runner};
use jaq_all::load::{Color, FileReports, FileReportsDisp};
use jaq_core::native::{bome, run as native, v, Fun};
use jaq_core::Vars;
use jaq_fmts::write::tabular::Row;
use jaq_json::read;
use jaq_json::write::{self, Pp};
use jaq_json::{Error, Map, Val};
use jaq_std::ValT;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Date, js_name = now)]
    fn date_now() -> f64;

    #[wasm_bindgen(js_name = Error)]
    type JsError;
    #[wasm_bindgen(constructor, js_class = "Error")]
    fn new(message: &str) -> JsError;
    #[wasm_bindgen(method, setter = name, js_class = "Error")]
    fn set_name(this: &JsError, name: &str);
}

thread_local! {
    /// What the filter wrote to stderr during this run (`stderr`, `halt_error`).
    static STDERR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Apply `filter` to each JSON value in `input`, returning every output value
/// as compact JSON, one per line. Throws an `Error` named `JqInputError`,
/// `JqCompileError` or `JqRuntimeError` with a readable message.
#[wasm_bindgen]
pub fn run(filter: &str, input: &str) -> Result<String, JsValue> {
    STDERR.with(|s| s.borrow_mut().clear());

    let compiled = jaq_all::compile_with(filter, jaq_all::defs(), funs(), &["ENV".into()])
        .map_err(|reports| fail("JqCompileError", render(&reports)))?;
    // A browser has no environment: $ENV is {}.
    let vars = Vars::new([Val::obj(Map::default())]);

    let mut out = Vec::new();
    let inputs = read::parse_many(input.as_bytes());
    let result = data::run(
        &Runner::default(),
        &compiled,
        vars,
        (&Val::Null, inputs),
        Stop::Input,
        |output| match output {
            Ok(v) => {
                write::write(&mut out, &Pp::default(), 0, &v).expect("write to Vec");
                out.push(b'\n');
                Ok(())
            }
            Err(exn) => Err(match exn.get_err() {
                Ok(err) => Stop::Runtime(err.to_string()),
                Err(exn) => Stop::Halt(exn.get_halt().unwrap_or(5)),
            }),
        },
    );

    match result {
        // `halt` ends the program successfully, keeping what was output so far.
        Ok(()) | Err(Stop::Halt(0)) => Ok(String::from_utf8_lossy(&out).into_owned()),
        Err(Stop::Halt(code)) => {
            let stderr = STDERR.with(|s| s.borrow().clone());
            let message = if stderr.is_empty() {
                format!("halted with exit code {code}")
            } else {
                stderr
            };
            Err(fail("JqRuntimeError", message))
        }
        Err(Stop::Input(e)) => Err(fail("JqInputError", format!("input is not valid JSON: {e}"))),
        Err(Stop::Runtime(message)) => Err(fail("JqRuntimeError", message)),
    }
}

/// Pretty-print JSON text (a sequence of values) for display, `indent` spaces
/// per level, one value after another.
#[wasm_bindgen]
pub fn format(text: &str, indent: usize) -> Result<String, JsValue> {
    let pp = Pp {
        indent: Some(" ".repeat(indent)),
        sep_space: true, // `"a": 1`, as jq prints it
        ..Pp::default()
    };
    let mut out = Vec::new();
    for value in read::parse_many(text.as_bytes()) {
        let value = value.map_err(|e| fail("JqInputError", format!("not valid JSON: {e}")))?;
        if !out.is_empty() {
            out.push(b'\n');
        }
        write::write(&mut out, &pp, 0, &value).expect("write to Vec");
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Why a run stopped early.
enum Stop {
    Input(String),
    Runtime(String),
    Halt(i32),
}

fn fail(name: &str, message: impl AsRef<str>) -> JsValue {
    let error = JsError::new(message.as_ref());
    error.set_name(name);
    error.into()
}

/// The jaq CLI's functions, with natives this target can't run replaced, plus
/// the @csv/@tsv writers (jaq ships them only bundled with every data format).
fn funs() -> impl Iterator<Item = Fun<DataKind>> {
    const REPLACED: [&str; 3] = ["now", "env", "stderr_empty"];
    let base = data::base_funs().filter(|(name, args, _)| !(args.is_empty() && REPLACED.contains(name)));
    let native = native::<DataKind>;
    base.chain([
        native(("now", v(0), |_| bome(Ok(Val::from(date_now() / 1000.0))))),
        native(("env", v(0), |_| bome(Ok(Val::obj(Map::default()))))),
        native(("stderr_empty", v(0), |cv| {
            // as jaq's own stderr: text strings raw, anything else as JSON
            let text = match cv.1.as_utf8_bytes() {
                Some(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                None => cv.1.to_string(),
            };
            STDERR.with(|s| s.borrow_mut().push_str(&text));
            Box::new(core::iter::empty())
        })),
        native(("@csv", v(0), |cv| bome(tabular(&cv.1, "CSV", Row::write_csv)))),
        native(("@tsv", v(0), |cv| bome(tabular(&cv.1, "TSV", Row::write_tsv)))),
    ])
}

fn tabular(
    value: &Val,
    format: &str,
    write: fn(&Row, &mut dyn std::io::Write) -> std::io::Result<()>,
) -> Result<Val, Error> {
    let row = Row::try_from(value)
        .map_err(|e| Error::str(format_args!("cannot serialise {value} as {format}: {e}")))?;
    let mut buf = Vec::new();
    write(&row, &mut buf).expect("write to Vec");
    Ok(Val::utf8_str(buf))
}

/// The CLI's error reports, without colors or file paths.
fn render(reports: &[FileReports]) -> String {
    reports
        .iter()
        .map(|r| FileReportsDisp::new(r).with_paint(plain).to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn plain(f: &mut Formatter, _: &Option<Color>, text: &dyn Display) -> fmt::Result {
    text.fmt(f)
}
