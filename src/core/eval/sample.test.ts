import { describe, expect, it } from 'vitest'
import { sampleJson } from './sample.ts'

describe('sampleJson (invariant 4)', () => {
  it('leaves input within the limit untouched', () => {
    const text = '{"users": [1, 2], "n": 1}'
    expect(sampleJson(text, 2)).toEqual({ text, sampled: false })
  })

  it.each([
    ['a top-level array', '[1,2,3,4]', '[1,2]'],
    ['an array inside an object', '{"users":[1,2,3],"n":1}', '{"users":[1,2],"n":1}'],
    ['arrays at every depth', '[[1,2,3],[4],[5]]', '[[1,2],[4]]'],
    ['objects as elements', '[{"a":[1,2,3]},{"b":1},{"c":2}]', '[{"a":[1,2]},{"b":1}]'],
  ])('cuts %s', (_, text, expected) => {
    expect(sampleJson(text, 2)).toEqual({ text: expected, sampled: true })
  })

  it('copies what it keeps verbatim: formatting, key order, number literals', () => {
    const text = '{ "b": 1.0,\n  "a": [100000000000000000001, 2, 3] }'
    expect(sampleJson(text, 2).text).toBe('{ "b": 1.0,\n  "a": [100000000000000000001, 2] }')
  })

  it('is not fooled by brackets, commas or escaped quotes inside strings', () => {
    const text = '["a,]", "b\\"]", "c", "d"]'
    expect(sampleJson(text, 2).text).toBe('["a,]", "b\\"]"]')
  })

  it('keeps the first documents of a multi-document input', () => {
    expect(sampleJson('1 2 3', 2)).toEqual({ text: '1 2', sampled: true })
    expect(sampleJson('{"a":1}\n{"a":2}\n{"a":3}\n', 2).text).toBe('{"a":1}\n{"a":2}')
  })

  it('returns malformed input whole, for jq to report', () => {
    for (const text of ['[1,2,3', '{"a":]', '"open', '[1,2,3]]', ']']) {
      expect(sampleJson(text, 2)).toEqual({ text, sampled: false })
    }
  })

  it('handles a byte order mark', () => {
    // limit 1: a BOM misread as a document would leave room for nothing else
    const bom = String.fromCharCode(0xfeff)
    expect(sampleJson(`${bom}[1,2,3]`, 1).text).toBe(`${bom}[1]`)
  })

  it('cuts a large array to the default 200 items', () => {
    const text = JSON.stringify({ items: Array.from({ length: 10_000 }, (_, i) => ({ id: i })) })
    const sample = sampleJson(text)
    expect(sample.sampled).toBe(true)
    expect((JSON.parse(sample.text) as { items: unknown[] }).items).toHaveLength(200)
  })
})

describe('sampleJson on random documents', () => {
  /** Deterministic PRNG, so a failure reproduces. */
  function prng(seed: number) {
    return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  }

  type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

  function randomJson(rnd: () => number, depth: number): Json {
    const pick = Math.floor(rnd() * (depth > 3 ? 4 : 6))
    if (pick === 0) return null
    if (pick === 1) return rnd() > 0.5
    if (pick === 2) return Math.round(rnd() * 1e6) / 100
    if (pick === 3) return ['plain', 'with "quotes"', 'brackets ][}{', 'comma, colon:', 'back\\slash', 'é😀'][Math.floor(rnd() * 6)] ?? ''
    if (pick === 4) return Array.from({ length: Math.floor(rnd() * 7) }, () => randomJson(rnd, depth + 1))
    const entries = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [`k${i}`, randomJson(rnd, depth + 1)])
    return Object.fromEntries(entries) as Json
  }

  /** What sampling should produce: every array cut to `limit`. */
  function cut(value: Json, limit: number): Json {
    if (Array.isArray(value)) return value.slice(0, limit).map((v) => cut(v, limit))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cut(v, limit)]))
    }
    return value
  }

  it('always yields valid JSON equal to the input with every array cut', () => {
    const rnd = prng(42)
    for (let n = 0; n < 300; n++) {
      const value = randomJson(rnd, 0)
      const limit = 1 + Math.floor(rnd() * 3)
      for (const indent of [undefined, 2, '\t']) {
        const sample = sampleJson(JSON.stringify(value, null, indent), limit)
        expect(JSON.parse(sample.text)).toEqual(cut(value, limit))
      }
    }
  })
})
