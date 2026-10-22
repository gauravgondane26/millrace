import type { Node, Tree } from 'web-tree-sitter'
import type { GraphModel, GraphNode, NodeKind, Span, TextRange } from './model.ts'

/**
 * Projects a parsed jq tree (tree-sitter-jq grammar) into the graph model.
 *
 * - A top-level pipe chain becomes one node per stage. The grammar nests pipes
 *   to the right (`a | (b | c)`), both sides under the `chained_query` field.
 * - Calls with the right arity map to structural kinds (CALLS), and a plain
 *   field path (`.a.b`) is a `pick`. Everything else, including whatever the
 *   grammar can't parse, is a `custom` node holding its raw text. Valid jq is
 *   never rejected (invariant 5): jaq still runs the text, the graph just
 *   can't draw that part structurally.
 * - Comments between stages fall outside every node's range, so splicing a
 *   node never touches them (invariant 2).
 */
export function project(tree: Tree, source: string): GraphModel {
  const root = tree.rootNode
  const segments: Segment[] = []

  for (const child of root.namedChildren) {
    if (child.type === 'programbody') segments.push(...bodySegments(child))
    else if (child.type !== 'comment') segments.push(errorSegment(child))
  }

  const stages = mergeErrors(segments.sort((a, b) => a.range.start - b.range.start))

  // A leading bare `.` is the input itself: give it to the source node.
  const first = stages[0]
  const ownsIdentity = first?.node !== undefined && !first.custom && isIdentity(first.node)
  const sourceRange: TextRange = ownsIdentity
    ? first.range
    : { start: first?.range.start ?? 0, end: first?.range.start ?? 0 }

  const nodes: GraphNode[] = [
    { id: 'n0', kind: 'source', ...span(source, sourceRange), args: [] },
  ]
  for (const stage of ownsIdentity ? stages.slice(1) : stages) {
    const shape = stage.custom || !stage.node ? CUSTOM : classify(stage.node)
    nodes.push({
      id: `n${nodes.length}`,
      kind: shape.kind,
      ...span(source, stage.range),
      args: shape.args.map((arg) => span(source, range(arg))),
    })
  }
  return { nodes }
}

/** Structural calls and the number of `;`-separated arguments they take. */
const CALLS = new Map<string, { kind: NodeKind; arity: number }>([
  ['select', { kind: 'select', arity: 1 }],
  ['map', { kind: 'map', arity: 1 }],
  ['pick', { kind: 'pick', arity: 1 }],
  ['sort_by', { kind: 'sort_by', arity: 1 }],
  ['group_by', { kind: 'group_by', arity: 1 }],
  ['unique', { kind: 'unique', arity: 0 }],
  ['limit', { kind: 'limit', arity: 2 }],
])

interface Shape {
  kind: NodeKind
  args: Node[]
}

const CUSTOM: Shape = { kind: 'custom', args: [] }

/**
 * A stretch of source that becomes one node. `node` is unset for parse
 * errors, which carry no structure; `custom` forces the opaque fallback.
 */
interface Segment {
  range: TextRange
  node?: Node
  custom: boolean
  error: boolean
}

function bodySegments(body: Node): Segment[] {
  const parts = body.namedChildren.filter((c) => c.type !== 'comment')
  const only = parts[0]
  if (parts.length === 1 && only?.type === 'query') return pipeStages(only)
  // imports, several statements, ...: draw the whole program as one node
  return parts.length === 0 ? [] : [{ range: range(body), custom: true, error: false }]
}

function pipeStages(query: Node): Segment[] {
  const stages: Segment[] = []
  let chained = false
  for (let i = 0; i < query.childCount; i++) {
    const child = query.child(i)
    if (!child || !child.isNamed || child.type === 'comment') continue
    if (query.fieldNameForChild(i) === 'chained_query' && child.type === 'query') {
      chained = true
      stages.push(...pipeStages(child))
    } else if (child.isError || child.isMissing) {
      stages.push(errorSegment(child))
    }
  }
  if (!chained) return [{ range: range(query), node: query, custom: query.hasError, error: false }]
  return stages
}

function errorSegment(node: Node): Segment {
  return { range: range(node), custom: true, error: true }
}

/**
 * Folds each parse error into the stage after it (or, at the end, the stage
 * before it), so `.[] | @csv` keeps `.[]` and degrades only `@csv`.
 */
function mergeErrors(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  let pending: TextRange | null = null
  for (const seg of segments) {
    if (seg.error) {
      pending = pending ? { start: pending.start, end: seg.range.end } : seg.range
      continue
    }
    if (pending) {
      out.push({ range: { start: pending.start, end: seg.range.end }, custom: true, error: false })
      pending = null
    } else {
      out.push(seg)
    }
  }
  if (pending) {
    const last = out.pop()
    out.push(
      last
        ? { range: { start: last.range.start, end: pending.end }, custom: true, error: false }
        : { range: pending, custom: true, error: false },
    )
  }
  return out
}

function classify(query: Node): Shape {
  const named = query.namedChildren.filter((c) => c.type !== 'comment')
  const [head, rest] = named

  if (head?.type === 'funcname' && named.length <= 2 && (!rest || rest.type === 'args')) {
    const call = CALLS.get(head.text)
    const args = rest ? callArgs(rest) : []
    if (call && args.length === call.arity) return { kind: call.kind, args }
    return CUSTOM
  }

  // `.a`, `.a.b.c`: a plain field path
  if (named.length > 0 && named.every((c) => c.type === 'index')) return { kind: 'pick', args: [] }

  return CUSTOM
}

/** `limit(3; .[])` parses as (args (args 3) .[]): flatten to [3, .[]]. */
function callArgs(args: Node): Node[] {
  return args.namedChildren.flatMap((c) =>
    c.type === 'args' ? callArgs(c) : c.type === 'query' ? [c] : [],
  )
}

function isIdentity(query: Node): boolean {
  return query.namedChildCount === 0 && query.text === '.'
}

function range(node: Node): TextRange {
  return { start: node.startIndex, end: node.endIndex }
}

function span(source: string, r: TextRange): Span {
  return { text: source.slice(r.start, r.end), range: r }
}
