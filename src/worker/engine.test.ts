import { loadJq } from 'jq-wasm'
import { describe, expect, it } from 'vitest'
import { createEngine, toError } from './engine.ts'

/**
 * The engine against the real jq 1.8.2 (jq-wasm's Node build reads the wasm
 * from disk), so what the worker does is guarded in CI without a browser.
 */
const engine = createEngine(() => loadJq())
const NO_LIMIT = Number.MAX_SAFE_INTEGER
const run = async (filter: string, input: string) => (await engine.run(filter, input, NO_LIMIT)).text

async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: Error) => e,
  )
}

describe('jq engine', () => {
  it('has 1 GB to work in (scripts/patch-jq-wasm.mjs; stock jq-wasm stops at 256 MB)', async () => {
    // a 320 MB string: stock jq-wasm aborts on it
    expect(await run('"abcdefgh" * 40000000 | length', 'null')).toBe('320000000\n')
  })

  it.each([
    ['.[]', '[1,2,3]', '1\n2\n3\n'],
    ['map(.*2)', '[1,2,3]', '[2,4,6]\n'],
    ['.[] | select(. > 2)', '[1,2,3,4]', '3\n4\n'],
    ['empty', '1', ''],
  ])('run(%s) over %s', async (filter, input, expected) => {
    expect(await run(filter, input)).toBe(expected)
  })

  it('treats each document in the input as a separate input', async () => {
    expect(await run('. * 10', '1 2\n3')).toBe('10\n20\n30\n')
    expect(await run('[., input]', '1 2')).toBe('[1,2]\n')
  })

  it('keeps key order, integer-like keys and big integers', async () => {
    expect(await run('.', '{"b":1,"2":0,"1":0}')).toBe('{"b":1,"2":0,"1":0}\n')
    expect(await run('.', '100000000000000000001')).toBe('100000000000000000001\n')
  })

  // Each of these differed under jaq, the engine this replaced.
  it.each([
    ['.a.b = 1', '{}', '{"a":{"b":1}}\n'],
    ['.[2] = 1', '[]', '[null,null,1]\n'],
    ['del(.a)', '{"a":1,"b":2,"c":3}', '{"b":2,"c":3}\n'],
    ['del(.[1,2])', '[1,2,3]', '[1]\n'],
    ['10 / 2, (add / length | tostring)', '[1,2,3]', '5\n"2"\n'],
    ['join(",")', '["a",null,1]', '"a,,1"\n'],
    ['[tostream] | length', '{"a":[1,2]}', '4\n'],
    ['@csv', '["a",1]', '"\\"a\\",1"\n'],
    ['$__loc__', 'null', '{"file":"<top-level>","line":1}\n'],
  ])('behaves like jq: %s', async (filter, input, expected) => {
    expect(await run(filter, input)).toBe(expected)
  })

  it('stops at halt, keeping earlier output', async () => {
    expect(await run('1, halt, 2', 'null')).toBe('1\n')
  })

  it('cuts output at the limit, at a value boundary', async () => {
    const out = await engine.run('limit(1000; repeat(1))', 'null', 100)
    expect(out).toEqual({ text: '1\n'.repeat(50), truncated: true })
    expect((await engine.run('1, 2', 'null', 100)).truncated).toBe(false)
  })

  it('pretty-prints like jq', async () => {
    expect(await engine.format('{"b":[1,2],"a":{}}\n3', 2)).toBe('{\n  "b": [\n    1,\n    2\n  ],\n  "a": {}\n}\n3')
  })
})

describe('engine errors', () => {
  it('reports compile errors with their caret, without the count line', async () => {
    const e = await rejection(engine.run('.[', 'null', NO_LIMIT))
    expect(e.name).toBe('JqCompileError')
    expect(e.message).toMatch(/^syntax error, .* line 1, column 2:\n {4}\.\[\n {5}\^$/)
  })

  it('reports runtime errors without the stdin location', async () => {
    const e = await rejection(engine.run('.foo', '1', NO_LIMIT))
    expect([e.name, e.message]).toEqual(['JqRuntimeError', 'Cannot index number with string ("foo")'])
  })

  it('reports invalid input', async () => {
    const e = await rejection(engine.run('.', '{"a":', NO_LIMIT))
    expect(e.name).toBe('JqInputError')
    expect(e.message).toMatch(/^input is not valid JSON: Unfinished JSON term/)
  })

  it('reports halt_error with its raw message', async () => {
    const e = await rejection(engine.run('"boom" | halt_error', 'null', NO_LIMIT))
    expect([e.name, e.message]).toEqual(['JqRuntimeError', 'boom'])
  })

  it('reads the error kind from stderr, not the exit code', () => {
    // halt_error(3) exits like a compile error; debug output can come first
    expect(toError('{"a":1}', 3).name).toBe('JqRuntimeError')
    expect(toError('["DEBUG:",1]\njq: error (at /dev/stdin:0): x', 5).message).toBe('x')
    expect(toError('', 7).message).toBe('halted with exit code 7')
  })
})
