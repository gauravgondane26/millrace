/**
 * The graph model is a *projection* of the CST, which is itself derived from
 * the source string. It is never edited directly and never serialized back to
 * jq by regeneration — see invariants 1 and 2 in CLAUDE.md.
 *
 * Each node carries the range it occupies in the source so that a graph edit
 * can be applied as a text splice (src/core/splice).
 */

/** The eight structural node kinds, plus the opaque fallback. Hard cap. */
export type NodeKind =
  | 'source'
  | 'select'
  | 'map'
  | 'pick'
  | 'sort_by'
  | 'group_by'
  | 'unique'
  | 'limit'
  | 'custom'

/**
 * Half-open [start, end) offsets in UTF-16 code units. This is the unit JS
 * strings, CodeMirror and web-tree-sitter all use: web-tree-sitter reports
 * UTF-16 indices when parsing a JS string, unlike native tree-sitter, which
 * reports UTF-8 bytes. One unit everywhere means no conversion between the
 * parser, the splice and the editor.
 */
export interface TextRange {
  start: number
  end: number
}

export interface GraphNode {
  id: string
  kind: NodeKind
  /** The exact source text this node was projected from. */
  text: string
  /** Where `text` sits in the source string. */
  range: TextRange
}

/**
 * A linear pipe chain. Object/array construction fans this out into a DAG;
 * that is deferred until the projection grows beyond linear chains.
 */
export interface GraphModel {
  nodes: GraphNode[]
}
