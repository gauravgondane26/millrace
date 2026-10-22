import type { NodeResult } from '../core/eval/cache.ts'
import type { GraphNode } from '../core/parse/model.ts'

/** How a node reads in one line, on its card and above its preview. */
export interface Summary {
  tone: 'ok' | 'error' | 'muted'
  text: string
}

/** The node's own text, or "input" for the source node. */
export const nodeLabel = (node: GraphNode) => (node.kind === 'source' ? 'input' : node.text)

const counted = new WeakMap<NodeResult, number>()

/** Outputs are one value per line, so values = newlines (memoized per result). */
function valueCount(result: Extract<NodeResult, { status: 'ok' }>): number {
  let count = counted.get(result)
  if (count === undefined) {
    count = 0
    const text = result.output.text
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count++
    counted.set(result, count)
  }
  return count
}

export function summarize(result: NodeResult | undefined, running: boolean): Summary {
  if (!result) return { tone: 'muted', text: running ? 'running…' : '' }
  if (result.status === 'blocked') return { tone: 'muted', text: 'blocked by an earlier error' }
  if (result.status === 'error') return { tone: 'error', text: 'error' }
  const count = valueCount(result)
  if (count === 0) return { tone: 'muted', text: 'no output' }
  // "+": cut here or upstream, so there are more values than counted
  const more = result.output.truncated || result.partial ? '+' : ''
  const first = result.output.text.slice(0, result.output.text.indexOf('\n'))
  return { tone: 'ok', text: `${count}${more} ${count === 1 ? 'value' : 'values'} · ${first}` }
}
