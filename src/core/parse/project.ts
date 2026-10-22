import type { Node, Tree } from 'web-tree-sitter'
import type { Construction, GraphModel, GraphNode, NodeKind, Span, TextRange } from './model.ts'

/**
 * Projects a parsed jq tree (tree-sitter-jq grammar) into the graph model.
 *
 * - A top-level pipe chain becomes one node per stage. The grammar nests pipes
 *   to the right (`a | (b | c)`), both sides under the `chained_query` field.
 * - Calls with the right arity map to structural kinds (CALLS), and a plain
 *   field path (`.a.b`) is a `pick`. Everything else, including whatever the
 *   grammar can't parse, is a `custom` node holding its raw text. Valid jq is
 *   never rejected (invariant 5): jq still runs the text, the graph just
 *   can't draw that part structurally.
 * - An object or array construction stage is a custom node that fans out
 *   (`construct`): each object value, or an array's contents, is a lane with
 *   its own pipe chain, projected by the same rules, constructions included.
 *   The grammar lays an object value's pipes out flat (`.a | map(.b)` is
 *   index, "|", function), and it is stricter than jq 1.8 there: jq takes
 *   `{n: .a + 1}`, the grammar flags it. Its error recovery stays inside the
 *   key/value pair, so such a value is one custom stage in its lane; an error
 *   anywhere else in the construction leaves the whole of it custom.
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
  const ownsIdentity = first !== undefined && !first.custom && source.slice(first.range.start, first.range.end) === '.'
  const sourceRange: TextRange = ownsIdentity
    ? first.range
    : { start: first?.range.start ?? 0, end: first?.range.start ?? 0 }

  return {
    nodes: [
      { id: 'n0', kind: 'source', ...span(source, sourceRange), args: [] },
      ...chain(source, ownsIdentity ? stages.slice(1) : stages, 'n', 1),
    ],
    clean: !root.hasError,
  }
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

/** A child of a CST node, with the grammar field it sits under. */
interface Part {
  node: Node
  field: string | null
}

/**
 * A stretch of source that becomes one node. `parts` are the children that
 * make it up (a query's, or a run of an object value's); unset for parse
 * errors, which carry no structure. `custom` forces the opaque fallback.
 */
interface Segment {
  range: TextRange
  parts?: Part[]
  custom: boolean
  error: boolean
}

interface Shape {
  kind: NodeKind
  args: Node[]
  construct?: { shape: Construction['shape']; lanes: LaneShape[] }
}

interface LaneShape {
  key: TextRange | null
  stages: Segment[]
  objectValue: boolean
}

const CUSTOM: Shape = { kind: 'custom', args: [] }

/** Nodes for a pipe chain, numbered from `first` under `prefix`. */
function chain(source: string, stages: Segment[], prefix: string, first: number): GraphNode[] {
  return stages.map((stage, i) => toNode(source, stage, `${prefix}${first + i}`))
}

function toNode(source: string, stage: Segment, id: string): GraphNode {
  const shape = stage.custom || !stage.parts ? CUSTOM : classify(stage.parts)
  const node: GraphNode = {
    id,
    kind: shape.kind,
    ...span(source, stage.range),
    args: shape.args.map((arg) => span(source, range(arg))),
  }
  if (shape.construct) {
    node.construct = {
      shape: shape.construct.shape,
      lanes: shape.construct.lanes.map((lane, l) => ({
        key: lane.key && span(source, lane.key),
        nodes: chain(source, lane.stages, `${id}.${l}.`, 0),
        objectValue: lane.objectValue,
      })),
    }
  }
  return node
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
  if (!chained) return [{ range: range(query), parts: partsOf(query), custom: false, error: false }]
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

function classify(parts: Part[]): Shape {
  const field = parts[0]?.field
  if ((field === 'object' || field === 'object_2' || field === 'array') && parts.every((p) => p.field === field)) {
    return construction(parts, field === 'array' ? 'array' : 'object') ?? CUSTOM
  }

  if (parts.some((p) => broken(p.node))) return CUSTOM

  const named = parts.flatMap((p) => (p.node.isNamed ? [p.node] : []))
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

/**
 * `[...]` is one lane, its contents' pipe chain; `{...}` is a lane per entry.
 * Null when the grammar couldn't make out the entries, so the whole
 * construction stays custom.
 */
function construction(parts: Part[], shape: Construction['shape']): Shape | null {
  // the brackets, and a trailing comma, must be there as written
  if (parts.some((p, i) => i !== 1 && broken(p.node))) return null
  const inner = parts[1]?.node
  if (shape === 'array') {
    if (inner?.type !== 'query') return null
    return { ...CUSTOM, construct: { shape, lanes: [{ key: null, stages: mergeErrors(pipeStages(inner)), objectValue: false }] } }
  }
  const lanes = inner?.type === 'objectkeyvals' ? entries(inner) : null
  return lanes && { ...CUSTOM, construct: { shape, lanes } }
}

/** The grammar nests entries to the left: (objectkeyvals (objectkeyvals a) , b). */
function entries(keyvals: Node): LaneShape[] | null {
  const lanes: LaneShape[] = []
  for (const { node } of partsOf(keyvals)) {
    if (node.type === 'objectkeyvals') {
      const more = entries(node)
      if (!more) return null
      lanes.push(...more)
    } else if (node.type === 'objectkeyval') {
      const lane = entry(node)
      if (!lane) return null
      lanes.push(lane)
    } else if (node.type !== ',') {
      return null // an error between entries
    }
  }
  return lanes
}

function entry(keyval: Node): LaneShape | null {
  const parts = partsOf(keyval)
  const colon = parts.findIndex((p) => p.node.type === ':')
  // shorthand: `name`, `$v`, `"a b"`, `@base64`
  if (colon === -1) return broken(keyval) ? null : { key: range(keyval), stages: [], objectValue: true }

  const key = parts.slice(0, colon)
  const value = parts.slice(colon + 1)
  const [firstKey, firstValue] = [key[0], value[0]]
  const [lastKey, lastValue] = [key.at(-1), value.at(-1)]
  if (!firstKey || !lastKey || !firstValue || !lastValue) return null
  if (key.some((p) => broken(p.node))) return null
  const keyRange = { start: firstKey.node.startIndex, end: lastKey.node.endIndex }

  if (broken(keyval)) {
    // valid jq the grammar can't read here (`.a + 1`): one custom stage
    const valueRange = { start: firstValue.node.startIndex, end: lastValue.node.endIndex }
    return { key: keyRange, stages: [{ range: valueRange, custom: true, error: false }], objectValue: true }
  }
  if (value.length !== 1 || firstValue.node.type !== 'objectval') return null
  return { key: keyRange, stages: valueStages(firstValue.node), objectValue: true }
}

/** An object value's children, split at its top-level `|`s. */
function valueStages(objectval: Node): Segment[] {
  const stages: Segment[] = []
  let run: Part[] = []
  const flush = () => {
    const [first, last] = [run[0], run.at(-1)]
    if (first && last) {
      const r = { start: first.node.startIndex, end: last.node.endIndex }
      stages.push({ range: r, parts: run, custom: false, error: false })
    }
    run = []
  }
  for (const part of partsOf(objectval)) {
    if (!part.node.isNamed && part.node.type === '|') flush()
    else run.push(part)
  }
  flush()
  return stages
}

/** `limit(3; .[])` parses as (args (args 3) .[]): flatten to [3, .[]]. */
function callArgs(args: Node): Node[] {
  return args.namedChildren.flatMap((c) =>
    c.type === 'args' ? callArgs(c) : c.type === 'query' ? [c] : [],
  )
}

/** A node's children with their fields, comments left out. */
function partsOf(node: Node): Part[] {
  const parts: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type !== 'comment') parts.push({ node: child, field: node.fieldNameForChild(i) })
  }
  return parts
}

function range(node: Node): TextRange {
  return { start: node.startIndex, end: node.endIndex }
}

function span(source: string, r: TextRange): Span {
  return { text: source.slice(r.start, r.end), range: r }
}

/** The grammar flagged this node, or something in it, or made it up. */
const broken = (node: Node) => node.hasError || node.isMissing
