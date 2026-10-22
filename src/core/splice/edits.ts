import { locate, type Located } from '../parse/graph.ts'
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
 *
 * A node can sit in the top-level chain or in a lane of a construction. In
 * an object value, jq reads a value only up to the next `,` or `}`, so text
 * that isn't a plain term goes in parentheses there (`isTerm` says which; the
 * default, with no parser to ask, parenthesizes everything, which is always
 * valid).
 */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/** Whether text can stand as one `|`-joined stage of an object value. */
export type IsTerm = (text: string) => boolean

function find(model: GraphModel, id: string, expected: string): Located | null {
  const found = locate(model, id)
  return found && found.node.text === expected ? found : null
}

const isEmpty = (node: GraphNode) => node.range.start === node.range.end

/** The text as it can stand in this chain. */
function fit(at: Located, text: string, isTerm: IsTerm): string {
  return at.lane?.objectValue && !isTerm(text) ? `(${text})` : text
}

/** Replace a stage's text. The source node (the input) has none to replace. */
export function replaceNode(
  model: GraphModel,
  id: string,
  expected: string,
  text: string,
  isTerm: IsTerm = () => false,
): TextChange | null {
  const found = find(model, id, expected)
  if (!found || found.node.kind === 'source') return null
  return { from: found.node.range.start, to: found.node.range.end, insert: fit(found, text, isTerm) }
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
  if (!found || found.node.kind === 'source') return null
  const arg = found.node.args[argIndex]
  if (!arg || arg.text !== expectedArg) return null
  return { from: arg.range.start, to: arg.range.end, insert: text }
}

/** Remove a stage and the `|` joining it to its chain. */
export function deleteNode(model: GraphModel, id: string, expected: string): TextChange | null {
  const found = find(model, id, expected)
  if (!found || found.node.kind === 'source') return null
  const { node, chain, index } = found
  const prev = chain[index - 1]
  const next = chain[index + 1]
  if (!prev || isEmpty(prev)) {
    // the first stage (in a lane, or with no `.` before it)
    if (next) return { from: node.range.start, to: next.range.start, insert: '' }
    // the only stage: leave the identity filter rather than an empty program
    // or a key with no value
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
  isTerm: IsTerm = () => false,
): TextChange | null {
  const found = find(model, id, expected)
  if (!found) return null
  const { node, chain, index } = found
  const sep = separator(chain, source, index)
  if (node.kind === 'source' && isEmpty(node)) {
    const first = chain[1]
    if (first) return { from: first.range.start, to: first.range.start, insert: `${text}${sep}` }
    // no stages yet: the program is empty, or only comments
    return source.trim() === ''
      ? { from: 0, to: source.length, insert: text }
      : { from: source.length, to: source.length, insert: `\n${text}` }
  }
  return { from: node.range.end, to: node.range.end, insert: `${sep}${fit(found, text, isTerm)}` }
}

/**
 * The `|` between two stages, in the user's own style ("\n  | " in a
 * multi-line pipeline), taken from a neighbouring gap that holds nothing but a
 * pipe and whitespace; " | " if there is none.
 */
function separator(chain: readonly GraphNode[], source: string, index: number): string {
  for (const k of [index, index - 1]) {
    const a = chain[k]
    const b = chain[k + 1]
    if (!a || !b || isEmpty(a)) continue
    const gap = source.slice(a.range.end, b.range.start)
    if (/^\s*\|\s*$/.test(gap)) return gap
  }
  return ' | '
}
