import type { GraphModel, GraphNode } from '../parse/model.ts'

/**
 * Graph edits as text changes (invariant 2): each touches only the node it
 * edits, plus the `|` joining it to a neighbour when a stage comes or goes.
 * Everything else in the source, whitespace and comments included, stays as
 * written. Only a stage created from scratch gets generated text: its own,
 * and a separator copied from the user's own style.
 *
 * Each takes the text the node is expected to hold and returns null if the
 * node no longer holds it, so an edit is never spliced into a range that has
 * moved since the user saw it.
 */
export interface TextChange {
  from: number
  to: number
  insert: string
}

function find(model: GraphModel, id: string, expected: string): [GraphNode, number] | null {
  const index = model.nodes.findIndex((n) => n.id === id)
  const node = model.nodes[index]
  return node && node.text === expected ? [node, index] : null
}

const isEmpty = (node: GraphNode) => node.range.start === node.range.end

/** Replace a stage's text. The source node (the input) has none to replace. */
export function replaceNode(model: GraphModel, id: string, expected: string, text: string): TextChange | null {
  const found = find(model, id, expected)
  if (!found || found[1] === 0) return null
  const [node] = found
  return { from: node.range.start, to: node.range.end, insert: text }
}

/**
 * Replace one argument of a call, such as the predicate of `select(...)`,
 * leaving the rest of the stage, its spacing included, as written.
 */
export function replaceArg(
  model: GraphModel,
  id: string,
  expected: string,
  argIndex: number,
  expectedArg: string,
  text: string,
): TextChange | null {
  const found = find(model, id, expected)
  if (!found || found[1] === 0) return null
  const arg = found[0].args[argIndex]
  if (!arg || arg.text !== expectedArg) return null
  return { from: arg.range.start, to: arg.range.end, insert: text }
}

/** Remove a stage and the `|` joining it to the pipeline. */
export function deleteNode(model: GraphModel, id: string, expected: string): TextChange | null {
  const found = find(model, id, expected)
  if (!found || found[1] === 0) return null
  const [node, index] = found
  const prev = model.nodes[index - 1]
  const next = model.nodes[index + 1]
  if (!prev) return null
  if (isEmpty(prev)) {
    // the first stage, with no `.` before it
    if (next) return { from: node.range.start, to: next.range.start, insert: '' }
    // the only stage: leave the identity filter rather than an empty program
    return { from: node.range.start, to: node.range.end, insert: '.' }
  }
  return { from: prev.range.end, to: node.range.end, insert: '' }
}

/** Add a new stage right after a node (after the input: first in the chain). */
export function insertAfter(
  model: GraphModel,
  source: string,
  id: string,
  expected: string,
  text: string,
): TextChange | null {
  const found = find(model, id, expected)
  if (!found) return null
  const [node, index] = found
  const sep = separator(model, source, index)
  if (index === 0 && isEmpty(node)) {
    const first = model.nodes[1]
    if (first) return { from: first.range.start, to: first.range.start, insert: `${text}${sep}` }
    // no stages yet: the program is empty, or only comments
    return source.trim() === ''
      ? { from: 0, to: source.length, insert: text }
      : { from: source.length, to: source.length, insert: `\n${text}` }
  }
  return { from: node.range.end, to: node.range.end, insert: `${sep}${text}` }
}

/**
 * The `|` between two stages, in the user's own style ("\n  | " in a
 * multi-line pipeline), taken from a neighbouring gap that holds nothing but a
 * pipe and whitespace; " | " if there is none.
 */
function separator(model: GraphModel, source: string, index: number): string {
  for (const k of [index, index - 1]) {
    const a = model.nodes[k]
    const b = model.nodes[k + 1]
    if (!a || !b || isEmpty(a)) continue
    const gap = source.slice(a.range.end, b.range.start)
    if (/^\s*\|\s*$/.test(gap)) return gap
  }
  return ' | '
}
