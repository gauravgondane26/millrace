/**
 * The graph model is a *projection* of the CST, which is itself derived from
 * the source string. It is never edited directly and never serialized back to
 * jq by regeneration — see invariants 1 and 2 in CLAUDE.md.
 *
 * Each node carries the byte range it occupies in the source so that a graph
 * edit can be applied as a text splice (src/core/splice).
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

/** UTF-8 byte offsets, as reported by tree-sitter. Half-open: [start, end). */
export interface ByteRange {
  start: number
  end: number
}

export interface GraphNode {
  id: string
  kind: NodeKind
  /** The exact source text this node was projected from. */
  text: string
  /** Byte range of `text` within the source string. */
  range: ByteRange
}

/**
 * A linear pipe chain. Object/array construction fans this out into a DAG;
 * that is deferred until the projection grows beyond linear chains.
 */
export interface GraphModel {
  nodes: GraphNode[]
}
