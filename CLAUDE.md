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
  idioms (see Status). `postinstall` (`scripts/patch-jq-wasm.mjs`) raises its
  memory cap from 256 MB to 1 GB; it refuses any other jq-wasm version.
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
    persist/     share-link encoding (IndexedDB itself lives in ui/persist.ts)
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
- `npm install` also runs `postinstall`, which patches jq-wasm's memory cap
  (idempotent; `node scripts/patch-jq-wasm.mjs` reruns it)

## Status

**Phases 1–8 done.** Paste JSON, edit jq in CodeMirror, on the React Flow canvas
or as fields in the Stage pane, and see a preview on every node; the Output pane
shows the selected node's. Object and array constructions fan out into lanes.
The document survives a reload, and Share copies a link to it.
Previews run stage by stage on a sample of the input; "Run full" runs the whole
program on the whole input.

**Phase 9 (quality bar) done.** Compile errors placed on their node and in
the editor (see Errors); no layout shift (see Layout); keyboard, focus and
contrast (see Accessibility); narrow screens; big inputs and outputs, and
code-splitting (see Big inputs); license notices (see Bundle); a 1 GB jq heap,
so Run full handles a 50 MB input (see Engine limits). The app is dark only,
which the user accepted as the quality bar's "Dark mode". What remains before
the app is done is the "Open issues" list below.

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
  over 10 s (60 s for Run full, which has a Stop button; an infinite filter
  would otherwise block every later preview), or
  an abandoned call (`AbortSignal`) still busy after 300 ms. Only that call
  fails: calls queued behind it are re-sent to a fresh worker, so no stage ever
  inherits (and caches) another stage's error.
  A stage is compiled alone, so jq's line and column (1-based, UTF-8 bytes)
  count from the stage's text: `core/eval/diagnose.ts` parses them out of the
  message, converts them to a range in the stage and shifts it by the node's
  `TextRange`, then redraws jq's caret diagram from the program's own line.
  Error results carry the `filter` that failed, and a range is applied only
  while the node still holds that text. `src/ui/errors.ts` turns a failure
  into the card's one line (also the node's accessible description), the
  Output pane's text, and editor diagnostics (`@codemirror/lint`,
  `useEditorDiagnostics.ts`): what jq pointed at for a compile error, the
  whole stage for any other; bad input marks nothing.
- **Previews (invariants 3 and 4).** `src/ui/usePreviews.ts` samples the input in
  the worker once per input change (`core/eval/sample.ts`: every array cut to 200
  elements at any depth, at most 200 documents; text in, text out), then runs
  `runPipeline` with the source node as identity, so invalid input surfaces on
  the input node. Results are per node id (ok, error, or blocked, naming the
  node whose error blocked it), cached including errors, and a newer edit
  abandons the run in flight.
  Stage-by-stage previews equal the whole program except where a later stage
  reads `input`/`inputs` or `$__loc__`, or relies on stopping an earlier one
  early (`halt`, `error`); "Run full" (`src/ui/OutputPane.tsx`) is the exact jq
  answer, and any edit returns to previews.
- **Fan-out (Phase 7).** An object or array construction stage (`{a: f, b: g}`,
  `[f]`) is a custom node with `construct` lanes (`core/parse/model.ts`), not a
  new kind: the eight-kind cap stands. Each object value, or an array's contents,
  is a lane: a pipe chain projected by the usual rules, constructions included.
  A shorthand entry (`{name}`, `{$v}`) is a lane with no stages, so nothing is
  drawn for it. Ids are positional: `n3.1.0` is the first stage of lane 1 of
  `n3`; `core/parse/graph.ts` has `flatten`, `locate` and `siblingId`.
  Evaluation (`core/eval/cache.ts`): each lane runs on the construction's input,
  then the construction runs its whole text once on that same input (jq's own
  semantics, cartesian products and all, not a JS merge of lane outputs); a lane
  error blocks the construction and shows on the lane stage. Editing a lane
  stage recomputes the rest of its lane, the construction and downstream, never
  the other lanes. Arguments of calls (`map({name})`) don't fan out. The grammar
  is stricter than jq 1.8 in object values (jq takes `{n: .a + 1}`, `if`, `try`,
  `reduce`; the grammar flags them): its recovery usually stays inside the entry,
  which becomes one custom stage; when it leaks (`{a: .[0].x + 1, ...}`,
  `if ... end`), the whole construction stays custom. A stage spliced into an
  object value is parenthesized unless the grammar reads it as a term there
  (`core/parse/term.ts`), so `.age * 2` lands as `(.age * 2)`.
- **Canvas.** `src/ui/PipelineCanvas.tsx` derives React Flow nodes from the model
  and results on every render; positions come from `core/parse/layout.ts`
  (grid cells: the top chain along row 0, a construction's lanes stacked in the
  columns before it, the first on its row) and are never stored (invariant 1),
  so nodes aren't draggable. Edges into and out of lanes bend in the gap beside
  the construction or the stage feeding it, so they never cross another lane's
  nodes; a lane's first stage shows its key. It does carry React Flow's
  measurements back into the nodes: without them React Flow hides nodes to
  re-measure on every render, which flickers and drops keyboard focus. Selection
  (click, or Enter on a focused node) is UI state in the store; with none, the
  last node is shown.
- **Graph editing (invariants 2, 6, 7).** The selected node's card offers Edit
  (its raw jq, in place; also double-click or F2), Add after (opens a form in the
  Stage pane) and Delete. `core/splice/edits.ts` turns each into one minimal text
  change (a new stage copies the user's separator style), and
  `src/ui/useGraphEdits.ts` dispatches it through the editor with
  `graphEditSpec`, so it commits at once and undo covers it; Ctrl+Z on the canvas
  is the editor's undo. Edits re-project the editor's live text at the moment of
  the edit and name the text the node should hold, so a node that changed in the
  last 200 ms is refused rather than spliced at a stale range.
- **Stage pane.** `src/ui/StagePane.tsx` shows the selected node as labelled
  fields; `core/parse/kinds.ts` says which: select's predicate, map's
  projection, sort_by/group_by's key, limit's count and generator, a pick path
  (or `pick()`'s argument), a custom stage's whole text; source and unique have
  none. A field edit splices only its argument (`replaceArg`), so
  `select( .age > 40 )` keeps its spacing. Enter (Ctrl+Enter in the multi-line
  jq field) or leaving the field commits, as one undo step; Escape puts the value
  back; an unfocused field follows the document. "Add after" opens a form there:
  pick a kind and fill its fields, and it shows the jq it will write
  (`stageText`, the only generated text) before Add. The new stage is then
  selected and focused; Escape or Cancel writes nothing.
- **Persistence (Phase 8).** `src/ui/persist.ts` keeps the jq and the input in
  IndexedDB (database `millrace`, store `document`, keys `source` and `input`,
  separate so typing jq never rewrites a big input), saved 300 ms after a change
  and at once when the page is hidden. `src/ui/Boot.tsx` restores before the
  app renders ("Opening your document…"), so the editor starts from the saved
  text with no undo step for it and the default `.` is never saved over it.
  Share (`src/ui/Share.tsx`) copies `#v1=<lz-string>` (`core/persist/share.ts`):
  the jq, plus the input while the fragment stays under 32,000 characters
  (input over 10× that isn't even compressed, so a big input can't freeze the
  page); otherwise the link holds the jq only and says so. If the clipboard is
  refused, the link is shown to copy by hand. Opening a link at startup wins
  over the saved document and becomes the working one; the fragment is then
  cleared, so a reload keeps later edits. A link pasted into a tab already
  open only fires `hashchange` (`src/ui/useSharedLinks.ts`): its jq goes
  through the editor as one undoable step (`openSpec`, committed at once like
  undo); its input replaces the input pane, which has no undo. Unreadable
  links, storage the browser refuses, and failed saves each post a notice in
  the header (store `notice`, a live region). The trade-offs still open are
  listed under "Open issues" below.
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
  `core/parse/parser.ts` loads it and `project.ts` flattens the pipe chain and
  projects constructions (rules in its header). The grammar can't parse
  `@format` strings; those stages degrade to custom nodes. It lays an object
  value's pipes out flat (no `query` node), so `project.ts` splits them itself.
- **Offsets are UTF-16 code units, not bytes.** web-tree-sitter reports UTF-16
  indices for JS strings, the same unit as CodeMirror, so one `TextRange` type is
  used everywhere with no conversion. Where invariant 2 and the Stack section say
  "byte range", read "range".
- **Engine limits (jq-wasm).** jq's heap is capped at 1 GB: stock jq-wasm stops
  at 256 MB (about 20 MB of input), and `scripts/patch-jq-wasm.mjs` raises the
  two numbers that set it, the wasm memory's maximum pages and the glue's
  `getHeapMax()`, on install (the user chose this over building jq with
  Emscripten). A 50 MB input runs in 1 to 5 s; `engine.test.ts` checks the cap
  with a 320 MB string. wasm memory never shrinks, so the client retires a
  worker once idle after jq ran on an input of 10 MB or more
  (`RETIRE_AFTER_INPUT`). jq buffers its whole output and can't be stopped
  mid-run (that needed our own build): the preview limit
  (`PREVIEW_OUTPUT_LIMIT`, ~1 MB) trims what is kept, and runaway filters are
  bounded by the timeout and the heap (endlessly repeating a large value can
  hold up to 1 GB until the timeout). `$ENV`/`env` show Emscripten's
  placeholder environment, `input_filename` is `"/dev/stdin"`, modules
  (`import`/`include`) can't load, and nesting thousands of levels deep
  overflows the wasm stack. `crashMessage` in `client.ts` names both in plain
  words (jq-wasm says "Aborted()" and "memory access out of bounds").
- **Big inputs (50 MB).** The browser's own textarea takes ~130 ms per MB to
  take text in, so `src/ui/InputPane.tsx` edits input only up to
  `EDITABLE_INPUT_LIMIT` (1 MB). Past it the input is shown (size and first
  64 KB) and replaced by pasting, Open file… or dropping a file; a paste that
  would cross the limit is caught before the browser inserts it. Never call
  `.trim()` or similar on the input per render: it copies 50 MB. Output goes
  through `src/ui/TextView.tsx`, which draws only the visible lines (fixed
  20 px line height) and cuts a line past 5,000 characters; Copy takes the
  whole text. Card summaries are capped at 200 characters. `e2e/big.spec.ts`
  pastes 50 MB and fails on any main-thread task over 250 ms. Measured on the
  production build: no task over 50 ms, first preview under a second, reload
  with a 50 MB saved input shows the app in ~150 ms.
- **Bundle.** `Boot` dynamic-imports the app, started in parallel with the
  restore; `vite.config.ts` gives React, CodeMirror, React Flow and
  web-tree-sitter chunks of their own (entry 10 KB, largest 313 KB).
  Overrides of React Flow's CSS live in `src/ui/canvas.css`, imported right
  after it: in `index.css` they would load before it and lose.
  `scripts/license-notices.ts` (a Vite plugin, also in `worker.plugins`)
  writes `dist/licenses.txt`, linked from the header: every npm package with
  code in the app or worker bundles, Tailwind, and the software compiled into
  the wasm (texts in `licenses/`). A new dependency is picked up by itself;
  software compiled into a new wasm needs an entry in `COMPILED_IN`. The file
  exists only in builds, so the link 404s under `npm run dev`.
- **Narrow screens.** The canvas fits the chain down to 70% zoom (readable
  beats complete), then pans just far enough that the selected node (by
  default the last, the result) is whole on screen; Tab focus pans to a node
  too. The editor wraps long lines. Below 768 px (`md`) the panes stack in
  one column of fixed heights that scrolls as a page.
- **Accessibility.** `e2e/a11y.spec.ts` runs axe (WCAG 2.2 AA, no
  violations) in several states, checks every visible text's contrast with
  `e2e/contrast.ts` (axe can't judge the canvas, whose cards overlap the
  pane), and tabs round the page checking each stop shows a focus ring.
  `src/index.css` gives React Flow 3:1 edges and a readable attribution, and
  puts a focus ring on a focused card (React Flow removes the node outline
  and rings only its built-in node types). Borders are `neutral-500` and
  placeholders `neutral-400` for contrast. React Flow's `<Controls>` is
  replaced by `ZoomControls` (it labels a role-less div). The Output views
  scroll, so they take focus. The app is dark only (`color-scheme: dark`).
- **Layout (no shift).** `e2e/layout.spec.ts` holds these. The Stage pane has
  one fixed height (9.25rem, the add form for a custom stage being the
  tallest; it scrolls at larger text sizes) and is there before the parser
  loads: labels sit beside fields, and Add/Cancel follow the last field on
  its row. The Output pane's notices are a one-line status bar at its foot,
  always present. A card's status line has a fixed height, and its edge
  handles sit a fixed 34 px from its top, so a selected card growing its
  buttons moves no edge.

### Open issues (address all before calling the app done)

Known gaps, accepted for now so each phase could land. Each needs a fix, or an
explicit decision to keep it, before the app is done. Remove an entry once it
is resolved.

1. **Stale-range race, unchecked in a browser.** A canvas edit within 200 ms of
   typing in the editor is guarded and unit-tested (`edits.ts` refuses a node
   whose text changed), but forcing that timing makes a flaky e2e test. Try it
   by hand; if an edit ever lands in the wrong place, fix it.
2. **Opening a share link loses the document it replaces.** At startup the
   link's document overwrites the saved one, with no way back. In an open tab
   the jq can be undone (Ctrl+Z in the editor), but the input pane has no undo,
   so a link that carries input replaces yours for good. Any fix has to stay
   within the persistence scope (IndexedDB working document plus URL fragment,
   nothing else), or the scope has to change first.
3. **Share links cap at 32,000 characters** (`MAX_FRAGMENT_LENGTH` in
   `core/persist/share.ts`); past that, a link carries the jq only and says so.
   Browsers take far longer URLs, but chat apps and address bars mangle them
   sooner. Settle the limit, or offer the longer link with a warning.
4. **Several tabs overwrite each other.** Each tab saves its own document to the
   same IndexedDB records, and the last save wins, with no warning.
5. **The last moments of typing can be lost on close.** Saves wait 300 ms, and
   jq edits reach the store only after the 200 ms reparse debounce. The save on
   `visibilitychange`/`pagehide` is asynchronous and doesn't include the editor's
   uncommitted text, so closing a tab right after typing can drop the last
   keystrokes.
6. **Previews publish only when the whole pipeline is done.** `usePreviews`
   sets results once `runPipeline` finishes, so one slow or endless stage
   keeps every node, the input node included, at "running…" until it ends or
   times out (10 s). Publishing each node's result as it lands would fix it.

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
