import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadJq } from 'jq-wasm'
import { describe, expect, it } from 'vitest'
import { createEngine } from './engine.ts'

/**
 * Every example in the jq 1.8.2 manual, run through the engine. Previews must
 * show what real jq does with the filter the user copies out, so this guards
 * that the engine (and how engine.ts drives it) stays jq. Outputs are compared
 * as values, by jq itself, as jq's own test harness does.
 */
const engine = createEngine(() => loadJq())
const run = async (filter: string, input: string) =>
  (await engine.run(filter, input, Number.MAX_SAFE_INTEGER)).text.split('\n').filter(Boolean)

/** These read $PAGER, which jq's own test run sets; a browser has no environment. */
const NEEDS_ENVIRONMENT = new Set(['$ENV.PAGER', 'env.PAGER'])

interface Example {
  line: number
  program: string
  input: string
  expected: string[]
}

/** man.test format: program, input, then expected outputs; blank-line separated. */
function parse(text: string): Example[] {
  const lines = text.split(/\r?\n/)
  const examples: Example[] = []
  let i = 0
  while (i < lines.length) {
    while (i < lines.length && (lines[i]?.trim() === '' || lines[i]?.startsWith('#'))) i++
    if (i >= lines.length) break
    const line = i + 1
    const program = lines[i++] ?? ''
    const input = lines[i++] ?? ''
    const expected: string[] = []
    while (i < lines.length && lines[i]?.trim() !== '') expected.push(lines[i++] ?? '')
    examples.push({ line, program, input, expected })
  }
  return examples
}

const examples = parse(
  readFileSync(fileURLToPath(new URL('./fixtures/jq-1.8.2-man.test', import.meta.url)), 'utf8'),
)

describe('jq 1.8.2 manual examples', () => {
  it('found the examples', () => {
    expect(examples.length).toBe(231)
  })

  const cases = (list: Example[]) => list.map((e) => [`L${e.line}: ${e.program}`, e] as const)
  const runnable = examples.filter((e) => !NEEDS_ENVIRONMENT.has(e.program))
  const environmental = examples.filter((e) => NEEDS_ENVIRONMENT.has(e.program))

  it.each(cases(runnable))('%s', async (_, example) => {
    const outputs = await run(example.program, example.input)
    expect(outputs).toHaveLength(example.expected.length)
    for (const [k, output] of outputs.entries()) {
      const [same] = await run('.[0] == .[1]', `[${output},${example.expected[k]}]`)
      expect(same, `output ${k}: got ${output}, expected ${example.expected[k]}`).toBe('true')
    }
  })

  it.skip.each(cases(environmental))('%s (needs $PAGER from jq\'s test environment)', () => {})
})
