import type { GraphModel } from './model.ts'

/**
 * Projects a parsed jq CST into the graph model.
 *
 * TODO(wasm): this requires the web-tree-sitter jq grammar. The grammar `.wasm`
 * is not an npm artifact — build it from a tree-sitter-jq grammar and drop it in
 * `public/` (error recovery + byte ranges are both required; see Stack notes).
 * Until then `parse()` is unimplemented and the UI should treat the whole source
 * as a single custom filter node.
 *
 * The projection rules, once the parser is in place:
 *   - A top-level pipe chain becomes one node per stage.
 *   - `select(...)`, `map(...)`, `{...}`/`.a.b` (pick), `sort_by`, `group_by`,
 *     `unique`, `limit` map to their structural node kinds.
 *   - Everything else (reduce, foreach, def, label/break, complex paths) becomes
 *     a `custom` node holding its raw text. Never reject valid jq (invariant 5).
 */
export function project(_tree: unknown, _source: string): GraphModel {
  throw new Error('project(): jq grammar wasm not yet wired — see TODO(wasm)')
}
