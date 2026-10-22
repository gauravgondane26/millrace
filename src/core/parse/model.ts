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

/** A piece of source text and where it sits, e.g. one argument of a call. */
export interface Span {
  text: string
  range: TextRange
}

export interface GraphNode extends Span {
  id: string
  kind: NodeKind
  /**
   * The call's arguments, in order (`select`'s predicate, `limit`'s count and
   * filter, ...). Empty for paths, `unique`, `source` and custom nodes.
   */
  args: Span[]
}

/**
 * A linear pipe chain, `nodes[0]` always being the `source` node: the input
 * data. When the program starts with a bare `.`, the source node owns that
 * `.`; otherwise its range is empty, marking where the first stage begins.
 *
 * Object/array construction fans this out into a DAG; that is deferred until
 * the projection grows beyond linear chains (until then it is custom).
 */
export interface GraphModel {
  nodes: GraphNode[]
}
