import { loadJq } from 'jq-wasm'
import { describe, expect, it } from 'vitest'
import { GUIDE_SECTIONS } from '../core/guide/sections.ts'
import { createEngine } from './engine.ts'

/**
 * Every example in the guide does what the guide says it does, under the
 * real jq 1.8.2: a reader pressing Try it sees the output (or the error)
 * the section promises.
 */
const engine = createEngine(() => loadJq())
const NO_LIMIT = Number.MAX_SAFE_INTEGER

const examples = GUIDE_SECTIONS.flatMap((s) => (s.example ? [[s.title, s.example] as const] : []))

describe('guide examples', () => {
  it('has examples to test', () => {
    expect(examples.length).toBeGreaterThan(0)
  })

  it.each(examples)('%s', async (_, example) => {
    const run = engine.run(example.jq, example.input, NO_LIMIT)
    if ('output' in example.expect) {
      expect((await run).text).toBe(`${example.expect.output}\n`)
    } else {
      await expect(run).rejects.toThrow(example.expect.compileError)
      await expect(run).rejects.toHaveProperty('name', 'JqCompileError')
    }
  })
})
