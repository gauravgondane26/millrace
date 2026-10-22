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
  /**
   * Unique in the model, and positional: `n3` is stage 3 of the top-level
   * chain, `n3.1.0` the first stage of lane 1 of the construction `n3`.
   */
  id: string
  kind: NodeKind
  /**
   * The call's arguments, in order (`select`'s predicate, `limit`'s count and
   * filter, ...). Empty for paths, `unique`, `source` and custom nodes.
   */
  args: Span[]
  /**
   * Set on an object or array construction (`{name: .n, ages: [.a[]]}`),
   * which fans out into one lane per value. The node itself is a custom node:
   * its text is the whole construction, and it outputs the constructed value.
   */
  construct?: Construction
}

/**
 * The lanes of a construction. Each lane is a pipe chain that runs on the
 * construction's own input, the output of the stage before it; the
 * construction then combines what they produce.
 */
export interface Construction {
  shape: 'object' | 'array'
  lanes: Lane[]
}

export interface Lane {
  /** The key as written (`name`, `"a b"`, `(.k)`, `$v`); null in an array. */
  key: Span | null
  /**
   * The value's pipe chain. Empty for a shorthand entry (`{name}`, `{$v}`),
   * whose value has no text of its own. Ids continue the construction's:
   * `${construction.id}.${lane}.${stage}`.
   */
  nodes: GraphNode[]
  /**
   * The value sits in an object, where jq takes a value only up to the next
   * `,` or `}`: a new stage that isn't a plain term needs parentheses there.
   */
  objectValue: boolean
}

/**
 * The top-level pipe chain, `nodes[0]` always being the `source` node: the
 * input data. When the program starts with a bare `.`, the source node owns
 * that `.`; otherwise its range is empty, marking where the first stage
 * begins. Constructions fan the chain out into a DAG through their lanes.
 */
export interface GraphModel {
  nodes: GraphNode[]
  /** The grammar read the whole program without an error. */
  clean: boolean
}
