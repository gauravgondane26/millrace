import type { Diagnostic } from '@codemirror/lint'
import type { NodeResult } from '../core/eval/cache.ts'
import { compileErrors, describeCompileErrors, shift } from '../core/eval/diagnose.ts'
import { flatten } from '../core/parse/graph.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { EngineError } from '../worker/client.ts'

type Failed = Extract<NodeResult, { status: 'error' }>

/** An error's message, without the "Error: " a non-engine error may carry. */
export const messageOf = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, '')

/**
 * The compile errors in a failed stage, if that is what failed and the node
 * still holds the text that did: previews can lag the editor, and a range
 * found in other text would point at the wrong place.
 */
function compiled(result: Failed, node: GraphNode) {
  const { error, filter } = result
  if (!(error instanceof EngineError) || error.kind !== 'compile' || node.text !== filter) return null
  return compileErrors(error.message, filter)
}

/** The whole error, for the Output pane: compile errors placed in the program. */
export function errorText(result: Failed, node: GraphNode, source: string): string {
  const errors = compiled(result, node)
  return errors ? describeCompileErrors(errors, source, node.range.start) : messageOf(result.error)
}

/** One line, for the node's card. */
export function errorHeadline(result: Failed): string {
  const { error, filter } = result
  if (error instanceof EngineError && error.kind === 'compile') {
    const [first] = compileErrors(error.message, filter)
    if (first) return first.message
  }
  return messageOf(error).split('\n', 1)[0] ?? ''
}

/**
 * Every failed stage as editor diagnostics: a compile error marks what jq
 * pointed at, any other error marks the whole stage. A bad input belongs to
 * the input pane, not the program, so it marks nothing.
 */
export function diagnostics(model: GraphModel, results: ReadonlyMap<string, NodeResult>): Diagnostic[] {
  const found: Diagnostic[] = []
  for (const node of flatten(model)) {
    const result = results.get(node.id)
    if (result?.status !== 'error' || node.kind === 'source') continue
    if (result.error instanceof EngineError && result.error.kind === 'input') continue
    const errors = compiled(result, node)
    if (errors) {
      for (const { message, range } of errors) {
        const { start, end } = range ? shift(range, node.range.start) : node.range
        found.push({ from: start, to: end, severity: 'error', message })
      }
    } else if (node.text === result.filter) {
      found.push({ from: node.range.start, to: node.range.end, severity: 'error', message: messageOf(result.error) })
    }
  }
  return found
}
