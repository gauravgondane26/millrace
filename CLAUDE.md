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
- jq 1.8.2 compiled to WASM (the `jq-wasm` package, pinned exactly) for execution,
  in a worker, via comlink. Chosen over jaq, which differs from jq in common
  idioms (see Status).
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
- `npm run test:e2e` — Playwright against the production build (served on :4174);
  screenshots land in `test-results/screens/`
- `npm run build:grammar` — rebuild the jq grammar wasm (needs git and network)

## Status

**Phases 1–5 done.** Paste JSON, edit jq in CodeMirror or on the React Flow
canvas, and see a preview on every node; the Output pane shows the selected
node's. Previews run stage by stage on a sample of the input; "Run full" runs the
whole program on the whole input.

- **Execution.** `src/worker/engine.ts` drives jq 1.8.2 itself (the `jq-wasm`
  package, pinned exactly), so previews are what jq produces. The engine was
  jaq until jq's own test suites showed it diverging in common idioms
  (assignment into missing paths, `del` key order, computed numbers): jq manual
  examples passed 207/231 under jaq, 229/231 under jq-wasm. `engine.test.ts`
  covers the wrapper; `jqManual.test.ts` runs every jq manual example (the two
  that need `$PAGER` are skipped).
- **Errors.** jq's exit codes are ambiguous (a compile error and `halt_error(3)`
  both exit 3), so `engine.ts` reads stderr to name errors `JqInputError`,
  `JqCompileError` or `JqRuntimeError`, dropping jq's "(at /dev/stdin:0)".
  `src/worker/client.ts` maps them to `EngineError` kinds. jq can't be
  interrupted, so the client terminates the worker after a crash, a call running
  over 10 s (an infinite filter would otherwise block every later preview), or
  an abandoned call (`AbortSignal`) still busy after 300 ms. Only that call
  fails: calls queued behind it are re-sent to a fresh worker, so no stage ever
  inherits (and caches) another stage's error.
- **Previews (invariants 3 and 4).** `src/ui/usePreviews.ts` samples the input in
  the worker once per input change (`core/eval/sample.ts`: every array cut to 200
  elements at any depth, at most 200 documents; text in, text out), then runs
  `runPipeline` with the source node as identity, so invalid input surfaces on
  the input node. Results are per node (ok, error, or blocked by an earlier
  error), cached including errors, and a newer edit abandons the run in flight.
  Stage-by-stage previews equal the whole program except where a later stage
  reads `input`/`inputs` or `$__loc__`, or relies on stopping an earlier one
  early (`halt`, `error`); "Run full" (`src/ui/OutputPane.tsx`) is the exact jq
  answer, and any edit returns to previews.
- **Canvas.** `src/ui/PipelineCanvas.tsx` derives React Flow nodes from the model
  and results on every render; positions come from the node index and are never
  stored (invariant 1), so nodes aren't draggable. It does carry React Flow's
  measurements back into the nodes: without them React Flow hides nodes to
  re-measure on every render, which flickers and drops keyboard focus. Selection
  (click, or Enter on a focused node) is UI state in the store; with none, the
  last node is shown.
- **Graph editing (invariants 2, 6, 7).** The selected node's card offers Edit
  (also double-click or F2), Add after and Delete. `core/splice/edits.ts` turns
  each into one minimal text change (a new stage copies the user's separator
  style), and `src/ui/useGraphEdits.ts` dispatches it through the editor with
  `graphEditSpec`, so it commits at once and undo covers it; Ctrl+Z on the canvas
  is the editor's undo. Edits re-project the editor's live text at the moment of
  the edit and name the text the node should hold, so a node that changed in the
  last 200 ms is refused rather than spliced at a stale range.
- **JSON crosses the JS boundary as text, never as parsed JS values.** `JSON.parse`
  moves integer-like keys first and rounds big numbers. Input is jq's input
  format (zero or more JSON values, so several pasted documents are several
  inputs); output is one compact value per line (jq `-c`), which is valid input
  again. So node k's output text is node k+1's input as is, the eval cache
  stores text, and display formatting comes from jq (`format`, `--indent 2`).
  Parse JSON in JS only for display, never to feed jq.
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
- **Engine limits (jq-wasm).** jq's heap is capped at 256 MB, so inputs above
  roughly 20 MB abort (the worker restarts). The plan is our own jq build with a
  larger heap as the last Phase 9 item; that build can also stop output mid-run.
  Until then jq buffers its whole output: the preview limit
  (`PREVIEW_OUTPUT_LIMIT`, ~1 MB) trims what is kept, and runaway filters are
  bounded by the timeout and the heap (endlessly repeating a large value can
  hold several hundred MB until the timeout). `$ENV`/`env` show Emscripten's
  placeholder environment, `input_filename` is `"/dev/stdin"`, modules
  (`import`/`include`) can't load, and nesting thousands of levels deep
  overflows the wasm stack.
- **Known rough edges.** A stage's compile error is jq's message about that
  stage's text alone (its line and column count from the stage, not the editor);
  map them to the stage's `TextRange` before pointing into the editor. The main
  JS chunk is ~781 KB (237 KB gzipped): CodeMirror, React Flow and
  web-tree-sitter; code-split it in the Quality-bar work. The canvas fits the
  chain down to 70% zoom, then pans; at narrow widths (under ~1,100 px of canvas)
  five or more nodes render small.

### Toolchains on this machine

tree-sitter: the CLI (a devDependency) downloads wasi-sdk (~590 MB) and binaryen
into `%LOCALAPPDATA%\tree-sitter` on first use. No Emscripten or Docker needed.
Nothing else needs building: jq comes prebuilt in `jq-wasm`.

Playwright: its Chromium lives in `%LOCALAPPDATA%\ms-playwright`; on a new machine,
run `npx playwright install chromium` once before `npm run test:e2e`.

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
