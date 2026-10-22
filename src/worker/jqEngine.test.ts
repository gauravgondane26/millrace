import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { format, initSync, run } from './jqpkg/jq_wasm.js'

/**
 * Integration test for the jaq WASM engine (crates/jq-wasm). Loads the committed
 * wasm synchronously from bytes — no browser, no worker — so the engine is
 * guarded in CI. JSON goes in and out as text: input is zero or more JSON
 * values, output is one compact value per line.
 */
beforeAll(() => {
  const wasmPath = fileURLToPath(new URL('./jqpkg/jq_wasm_bg.wasm', import.meta.url))
  initSync({ module: readFileSync(wasmPath) })
})

/** The error a call throws, so its `name` and `message` can be asserted. */
function thrown(fn: () => unknown): Error {
  try {
    fn()
  } catch (e) {
    return e as Error
  }
  throw new Error('expected the call to throw')
}

describe('jaq wasm engine', () => {
  it.each([
    ['.[]', '[1,2,3]', '1\n2\n3\n'], // one input fans out to a stream
    ['. + 1', '1', '2\n'],
    ['map(.*2)', '[1,2,3]', '[2,4,6]\n'],
    ['.foo', '{"foo":42}', '42\n'],
    ['group_by(.k) | length', '[{"k":1},{"k":1},{"k":2}]', '2\n'],
    ['.[] | select(. > 2)', '[1,2,3,4]', '3\n4\n'],
    ['empty', '1', ''],
  ])('run(%s) over %s', (filter, input, expected) => {
    expect(run(filter, input)).toBe(expected)
  })

  it('treats each document in the input as a separate input, like jq', () => {
    expect(run('. * 10', '1 2\n3')).toBe('10\n20\n30\n')
    expect(run('[., input]', '1 2')).toBe('[1,2]\n')
    expect(run('[inputs]', '1 2 3')).toBe('[2,3]\n')
  })

  it('keeps object key order, including integer-like keys', () => {
    expect(run('.', '{"zeta":1,"alpha":2}')).toBe('{"zeta":1,"alpha":2}\n')
    expect(run('.', '{"b":1,"2":0,"1":0}')).toBe('{"b":1,"2":0,"1":0}\n')
  })

  it('keeps integers beyond double precision', () => {
    expect(run('.', '100000000000000000001')).toBe('100000000000000000001\n')
  })

  it('writes @csv and @tsv rows', () => {
    expect(run('@csv', '["a",1,null,true]')).toBe('"\\"a\\",1,,true"\n')
    expect(run('@tsv', '["a\\tb",1]')).toBe('"a\\\\tb\\t1"\n')
  })

  it('has no environment, and a clock that works', () => {
    expect(run('$ENV', 'null')).toBe('{}\n')
    expect(run('env', 'null')).toBe('{}\n')
    expect(run('now | type', 'null')).toBe('"number"\n')
  })

  it('stops at halt, keeping earlier output', () => {
    expect(run('1, halt, 2', 'null')).toBe('1\n')
  })

  it('reports halt_error with its message', () => {
    const e = thrown(() => run('"boom" | halt_error', 'null'))
    expect(e.name).toBe('JqRuntimeError')
    expect(e.message).toBe('boom')
  })

  it('reports compile errors readably', () => {
    const e = thrown(() => run('.[', 'null'))
    expect(e.name).toBe('JqCompileError')
    expect(e.message).not.toMatch(/File \{/) // not a Rust Debug dump

    const undefinedFilter = thrown(() => run('nope', 'null'))
    expect(undefinedFilter.name).toBe('JqCompileError')
    expect(undefinedFilter.message).toMatch(/undefined filter/)
  })

  it('reports runtime errors', () => {
    const e = thrown(() => run('.foo', '1'))
    expect(e.name).toBe('JqRuntimeError')
    expect(e.message).toMatch(/cannot index/)
  })

  it('reports invalid input', () => {
    expect(thrown(() => run('.', '{')).name).toBe('JqInputError')
  })

  it('pretty-prints output for display, keeping key order', () => {
    expect(format('{"b":[1,2],"a":{}}', 2)).toBe('{\n  "b": [\n    1,\n    2\n  ],\n  "a": {}\n}')
    expect(format('1\n2\n', 2)).toBe('1\n2')
  })
})
