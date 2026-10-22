import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { splice } from '../splice/splice.ts'
import type { GraphModel } from './model.ts'
import { loadJqParser, type ParseJq } from './parser.ts'

/**
 * Projection suite (CLAUDE.md > Testing): node shapes for given jq text,
 * including the cases that must degrade to a custom node, plus the round-trip
 * suite run through the real parser.
 */
let parse: ParseJq

beforeAll(async () => {
  const grammar = fileURLToPath(new URL('../../../public/tree-sitter-jq.wasm', import.meta.url))
  parse = await loadJqParser(readFileSync(grammar))
})

const kinds = (m: GraphModel) => m.nodes.map((n) => n.kind)
const texts = (m: GraphModel) => m.nodes.map((n) => n.text)

describe('project: CST to graph model', () => {
  it('splits a top-level pipe chain into one node per stage', () => {
    const m = parse('.users | map(.name) | sort_by(.age)')
    expect(kinds(m)).toEqual(['source', 'pick', 'map', 'sort_by'])
    expect(texts(m)).toEqual(['', '.users', 'map(.name)', 'sort_by(.age)'])
  })

  it('maps all structural kinds', () => {
    const m = parse(
      '.items | select(.ok) | map(.v) | pick(.a) | sort_by(.k) | group_by(.g) | unique | limit(3; .[])',
    )
    expect(kinds(m)).toEqual([
      'source', 'pick', 'select', 'map', 'pick', 'sort_by', 'group_by', 'unique', 'limit',
    ])
  })

  it('records call arguments with their ranges', () => {
    const source = '.[] | select(.age > 30) | limit(3; .[])'
    const [, , select, limit] = parse(source).nodes
    expect(select?.args.map((a) => a.text)).toEqual(['.age > 30'])
    expect(limit?.args.map((a) => a.text)).toEqual(['3', '.[]'])
    for (const arg of [...(select?.args ?? []), ...(limit?.args ?? [])]) {
      expect(source.slice(arg.range.start, arg.range.end)).toBe(arg.text)
    }
  })

  it('gives a leading bare `.` to the source node', () => {
    const m = parse('. | select(.a)')
    expect(kinds(m)).toEqual(['source', 'select'])
    expect(m.nodes[0]?.range).toEqual({ start: 0, end: 1 })
  })

  it('projects an empty program to just the source node', () => {
    expect(kinds(parse(''))).toEqual(['source'])
    expect(kinds(parse('.'))).toEqual(['source'])
  })

  it.each([
    ['reduce .[] as $x (0; . + $x)'],
    ['foreach .[] as $x (0; . + $x)'],
    ['def f(x): x * 2; f(.n)'],
    ['label $out | .[] | if . > 2 then break $out else . end'],
    ['.a as $v | {v: $v}'],
    ['import "m" as m; .'],
  ])('falls back to a custom node for %s', (source) => {
    const m = parse(source)
    expect(kinds(m).slice(1)).toEqual(['custom'])
    expect(m.nodes[1]?.text).toBe(source)
  })

  it('keeps the chain but marks non-structural stages custom', () => {
    // .[] and sort are valid jq outside the eight kinds; map() has the wrong arity
    expect(kinds(parse('.[] | sort | map | {name}'))).toEqual([
      'source', 'custom', 'custom', 'custom', 'custom',
    ])
  })

  it('degrades only the stage the grammar cannot parse (@format strings)', () => {
    const m = parse('.[] | @csv | length')
    expect(kinds(m)).toEqual(['source', 'custom', 'custom', 'custom'])
    expect(texts(m)).toEqual(['', '.[]', '@csv', 'length'])
  })

  it('recovers from a syntax error mid-edit', () => {
    const m = parse('.users | map(.name')
    expect(kinds(m)).toEqual(['source', 'pick', 'custom'])
    expect(texts(m)).toEqual(['', '.users', 'map(.name'])
  })

  it('keeps comments outside node ranges', () => {
    const m = parse('.users\n  | map(.name) # keep\n  | unique')
    expect(texts(m)).toEqual(['', '.users', 'map(.name)', 'unique'])
  })

  it('reports UTF-16 offsets', () => {
    const source = '"é😀" | .x'
    const x = parse(source).nodes.at(-1)
    expect(x?.range).toEqual({ start: 8, end: 10 })
  })
})

describe('round trip (invariant 2)', () => {
  const corpus = [
    '.users | map(.name) | sort_by(.age)',
    '.users\n  | map(.name)   # keep this comment\n  |   unique',
    '. | select(.a) | limit(3; .[])',
    '.café | map(.naïve) | select(.π > 3) | "😀"',
    'reduce .[] as $x (0; . + $x)',
    '.[] | @csv | length',
    '.users | map(.name',
    '',
  ]

  it.each(corpus)('re-splicing every node with its own text is identity: %j', (source) => {
    const m = parse(source)
    for (const node of m.nodes) {
      expect(source.slice(node.range.start, node.range.end)).toBe(node.text)
      expect(splice(source, node.range, node.text)).toBe(source)
    }
  })

  it('never throws, even on garbage (invariant 5)', () => {
    for (const source of ['|||', '(((', '.a |', '}{', '@', '"unterminated', 'map(']) {
      expect(() => parse(source)).not.toThrow()
    }
  })
})
