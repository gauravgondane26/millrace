import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { initSync, run } from './jqpkg/jq_wasm.js'

/**
 * Integration test for the jaq WASM engine (crates/jq-wasm). Loads the committed
 * wasm synchronously from bytes — no browser, no worker — so the engine is
 * guarded in CI. Exercises the stream convention: input and output are both JSON
 * arrays of values (see jq.worker.ts).
 */
beforeAll(() => {
  const wasmPath = fileURLToPath(new URL('./jqpkg/jq_wasm_bg.wasm', import.meta.url))
  initSync({ module: readFileSync(wasmPath) })
})

describe('jaq wasm engine', () => {
  it.each([
    ['.[]', '[[1,2,3]]', '[1,2,3]'], // one input value fans out to a stream
    ['. + 1', '[1]', '[2]'], // scalar arithmetic
    ['map(.*2)', '[[1,2,3]]', '[[2,4,6]]'], // std: map
    ['.foo', '[{"foo":42}]', '[42]'], // field access
    ['group_by(.k) | length', '[[{"k":1},{"k":1},{"k":2}]]', '[2]'], // std: group_by
    ['select(. > 2)', '[1,2,3,4]', '[3,4]'], // std: select, empty outputs dropped
  ])('run(%s) over %s -> %s', (filter, input, expected) => {
    expect(run(filter, input)).toBe(expected)
  })

  it('throws a readable error on a malformed filter', () => {
    expect(() => run('.[', '[1]')).toThrow(/parse error/)
  })

  it('throws on a runtime type error', () => {
    expect(() => run('.foo', '[1]')).toThrow()
  })
})
