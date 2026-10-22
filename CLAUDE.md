# CLAUDE.md

Read this fully before writing code. These are invariants, not preferences.

## What this is

A browser-only scratchpad for working out JSON transforms. The user pastes a JSON
payload, builds a transform, sees a live preview of the data at every step, and
copies out real jq they can run anywhere.

The graph and the jq text are two views of the same thing. Editing either updates
the other. The graph is disposable. The jq is the product.

No backend. No accounts. No server-side anything. It deploys as static files.

## Invariants

Breaking any of these means the project no longer does the thing it exists to do.
If a task seems to require breaking one, stop and say so instead of working around it.

### 1. The jq source text is the only state

There is exactly one piece of mutable application state: the source string.

The CST is derived from it by parsing. The graph model is derived from the CST.
React Flow renders the graph model.

Never introduce a second mutable model of the pipeline. Never add a `nodes` array
that is edited directly and later serialized to jq. If you find yourself writing
sync logic between two models, the design has already gone wrong.

### 2. Graph edits are text splices, never regeneration

When the user edits a node, compute that node's byte range from the CST and splice
the new text into the source at that range.

Never regenerate the whole source from the AST. It destroys the user's whitespace,
line breaks and comments, and it is the single most likely way for this project to
quietly become useless.

Only nodes created from scratch get generated text, and only that node's text.

### 3. Node previews reuse the previous node's output

Node k's preview is `filter_k` applied to node k-1's cached output. One filter
invocation per node.

Never compute node k's preview by running the prefix `f1 | f2 | ... | fk`. That is
quadratic and it will feel slow by the sixth node.

On edit, mark the edited node and everything downstream dirty. Leave upstream cache
intact. Cache key is hash(filter text) + hash(input).

### 4. jq runs in a Web Worker, always

Never call the jq WASM module from the main thread. Canvas interaction must stay
smooth while a transform runs.

Previews run against a sample of the input (first 200 items by default) with an
explicit "run full" action. Full runs are also workered.

### 5. Unrepresentable jq degrades, never errors

The graph covers a subset: linear pipe chains, and object/array construction with
sub-pipelines (which fan out into a DAG).

Anything outside that subset (`reduce`, `foreach`, `def`, label/break, complex path
expressions) renders as a **custom filter node**: an opaque node holding the raw
text in a small editor. It still executes. It still shows a preview. It just can't
be structurally edited on the canvas.

The tool never rejects valid jq. It only ever says it can't draw part of it.

### 6. Text and graph updates carry an origin tag

Every CodeMirror transaction originating from a graph edit is annotated. The
text-change handler ignores annotated transactions when deciding whether to
re-derive. Without this you get an infinite update loop.

Text edits are debounced ~200ms before reparse. Graph edits apply immediately.

### 7. Undo is text history, nothing else

Because graph edits are text transactions, CodeMirror's history covers both
surfaces. Do not build a command pattern, an undo stack, or any graph-level
history. If undo breaks, the cause is a graph edit that bypassed the text.

## Stack

Pinned. Don't substitute without asking.

- Vite + React + TypeScript (strict, `noUncheckedIndexedAccess` on)
- React Flow for the canvas
- CodeMirror 6 for the editor (not Monaco; the transaction/annotation model is
  load-bearing for invariant 6)
- web-tree-sitter with a jq grammar for parsing. Error recovery and byte ranges are
  both required.
- jaq compiled to WASM for execution, in a worker, via comlink
- Zustand for the small amount of UI state that isn't derived
- Tailwind + Radix primitives
- Vitest for unit tests

## Layout

```
src/
  core/          pure logic, no React, fully unit tested
    parse/       source -> CST -> graph model projection
    splice/      graph edit -> text range replacement
    eval/        dirty marking, cache, worker RPC
  ui/            React components, dumb where possible
  worker/        jq wasm host
```

`src/core` must have no React import and no DOM dependency. It is where every
correctness-critical decision lives, so it is the part that gets tests.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b` then production build (type errors fail the build)
- `npm run preview` — serve the built `dist/`
- `npm run typecheck` — project-wide type check, no emit
- `npm run lint` — ESLint, zero-warning gate
- `npm test` — Vitest, single run
- `npm run test:watch` — Vitest in watch mode
- `npm test -- src/core/eval` — run one suite (path filter)
- `npm test -- -t "cache invalidation"` — run tests matching a name
- `npm run build:wasm` — rebuild the jaq wasm package (needs the Rust toolchain)
- `npm run build:grammar` — rebuild the jq grammar wasm (needs git and network)

## Status

**Phases 1–3 done.** Paste JSON, edit jq in CodeMirror, see live worker-computed
output, and see the source projected into pipeline stages (a read-only strip under
the editor until the React Flow canvas lands in Phase 4). Execution still runs the
whole source as one filter; per-node previews arrive with the canvas.

- **Execution.** `crates/jq-wasm` wraps jaq through `jaq-all` (the library behind
  the jaq CLI) behind two exports, `run(filter, input)` and `format(text, indent)`.
  The generated package is committed in `src/worker/jqpkg` so the app builds
  without Rust; regenerate it with `npm run build:wasm`.
  `src/worker/jqEngine.test.ts` guards it in Node. Natives the wasm target can't
  run are replaced: `now` reads `Date.now()`, `env`/`$ENV` are `{}`, and stderr is
  captured, so `halt_error` reports its message. `@csv`/`@tsv` come from
  `jaq-fmts`' tabular writer alone.
- **Errors.** The wasm throws JS Errors named `JqInputError`, `JqCompileError` and
  `JqRuntimeError`. `src/worker/client.ts` maps them to `EngineError` kinds and
  restarts the worker after a crash or a call running over 10 s (an infinite
  filter would otherwise block every later preview).
- **JSON crosses the JS boundary as text, never as parsed JS values.** `JSON.parse`
  moves integer-like keys first and rounds big numbers. Input is jq's input
  format (zero or more JSON values, so several pasted documents are several
  inputs); output is one compact value per line, which is valid input again.
  So node k's output text is node k+1's input as is, the eval cache stores text,
  and display formatting comes from jaq (`format`). Parse JSON in JS only for
  display, never to feed jaq.
- **Editor.** CodeMirror holds the live text and history; its update listener is
  the only writer of `source` in the store. Graph edits must dispatch
  `graphEditSpec` (`core/splice/transaction.ts`) so undo covers them. Typing
  commits after 200 ms, graph edits and undo/redo at once (`core/parse/schedule.ts`).
- **Parsing.** `public/tree-sitter-jq.wasm` is flurie/tree-sitter-jq
  (BSD-3-Clause, notice shipped beside it) at a pinned commit, rebuilt by
  `npm run build:grammar`. nverno/tree-sitter-jq was rejected for being GPL-3.0.
  `core/parse/parser.ts` loads it and `project.ts` flattens the pipe chain (rules
  in its header). The grammar can't parse `@format` strings; those stages degrade
  to custom nodes.
- **Offsets are UTF-16 code units, not bytes.** web-tree-sitter reports UTF-16
  indices for JS strings, the same unit as CodeMirror, so one `TextRange` type is
  used everywhere with no conversion. Where invariant 2 and the Stack section say
  "byte range", read "range".
- **jq builtins jaq lacks.** `tostream`, `leaf_paths`, `IN`, `INDEX`, `toarray`,
  `@base32`/`@base32d`, `$__loc__`, `builtins`, `input_line_number`, `ascii`,
  `have_decnum`, `have_literal_numbers`, `$__prog_args` and `date`/`dateadd`
  fail with "undefined filter". `ltrimstr`/`rtrimstr` on a non-string error in
  jaq where jq returns the input unchanged. Previews differ from real jq there.
- **Known rough edges.** Engine errors are readable (jaq's own reports) but not
  yet mapped to the offending node; their spans are UTF-8 byte offsets, so
  convert before comparing with a `TextRange`. The main JS chunk is ~555 KB
  (169 KB gzipped), mostly CodeMirror and web-tree-sitter; code-split it in the
  Quality-bar work. Previews run against the full input; sampling (invariant 4)
  comes with per-node previews.

### Toolchains on this machine

Rust: GNU host (`stable-x86_64-pc-windows-gnu`) with the `wasm32-unknown-unknown`
target and a prebuilt `wasm-pack`. Shells started before the install may not have
`~/.cargo/bin` on PATH, so prepend it. An old 32-bit `C:\MinGW\bin` on PATH breaks
host builds of crates that need `dlltool` (e.g. `windows-sys`). The jaq wrapper
doesn't pull any of those in. If a future dependency does, install a 64-bit
MinGW-w64 rather than building around it.

tree-sitter: the CLI (a devDependency) downloads wasi-sdk (~590 MB) and binaryen
into `%LOCALAPPDATA%\tree-sitter` on first use. No Emscripten or Docker needed.

## Testing

Write tests in `src/core` as you go, not at the end. The three suites that matter:

- **Round trip**: parse source to graph, apply a no-op edit, splice back. Output
  must be byte-identical to the input, comments and whitespace included.
- **Projection**: given jq text, assert the resulting node shapes. Include cases
  that must fall back to a custom filter node.
- **Cache invalidation**: edit node 3 of 6, assert nodes 1 and 2 were not
  recomputed and 4 through 6 were.

These are also the feedback loop that keeps agent-written changes honest. If a
change breaks the round-trip test, it broke invariant 2.

## Scope

Eight node types, hard cap: source, select, map, pick, sort_by, group_by, unique,
limit. Plus the custom filter node. A ninth node type is never the right use of an
hour.

Explicitly out of scope: accounts, a hosted runtime, scheduling, collaboration,
TypeScript/Python codegen (stretch goal only, after everything else is done),
multi-file projects.

Persistence is IndexedDB for the working document plus URL fragment sharing
(LZ-compressed). Nothing else.

## Quality bar

This is a portfolio piece. The following are not optional polish, they are the
deliverable:

- Every async surface has explicit loading, empty and error states
- jq compile errors map to the offending node with a readable message, never a
  stack trace
- Keyboard navigable canvas, visible focus rings, contrast passes AA
- No layout shift on preview update
- Works with a 50MB input without freezing (sampled previews, virtualized tables)
- Dark mode

## Working style

- Small commits, one concern each
- When a change touches `src/core`, add or update a test in the same commit
- Don't add dependencies without saying why in the commit message
- If a request conflicts with an invariant above, say so rather than finding a
  clever way around it
