import type { IsTerm } from '../splice/edits.ts'
import type { ParseJq } from './parser.ts'

/**
 * Asks the grammar whether text can stand as an object value as is: put it
 * after a key and see if it reads back cleanly as that one value. The grammar
 * is stricter than jq here (it rejects `.a + 1`, which jq 1.8 takes), so the
 * answer errs towards parentheses, which are always valid.
 */
export function termCheck(parse: ParseJq): IsTerm {
  return (text) => {
    const model = parse(`{k: ${text}\n}`)
    const lanes = model.nodes[1]?.construct?.lanes
    return model.clean && model.nodes.length === 2 && lanes?.length === 1 && lanes[0]?.key?.text === 'k'
  }
}
