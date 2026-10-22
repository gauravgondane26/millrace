import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { splice } from '../splice/splice.ts'
import { flatten } from './graph.ts'
import type { GraphModel, GraphNode } from './model.ts'
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

describe('project: constructions fan out', () => {
  const lanes = (node: GraphNode | undefined) =>
    node?.construct?.lanes.map((l) => ({ key: l.key?.text ?? null, nodes: l.nodes.map((n) => `${n.kind} ${n.text}`) }))

  it('gives an object a lane per entry, each its own pipe chain', () => {
    const m = parse('.users | {name: .name, n: .a | map(.b) | sort_by(.c)}')
    expect(kinds(m)).toEqual(['source', 'pick', 'custom'])
    const object = m.nodes[2]
    expect(object?.construct?.shape).toBe('object')
    expect(lanes(object)).toEqual([
      { key: 'name', nodes: ['pick .name'] },
      { key: 'n', nodes: ['pick .a', 'map map(.b)', 'sort_by sort_by(.c)'] },
    ])
    const n = object?.construct?.lanes[1]?.nodes
    expect(n?.map((x) => x.id)).toEqual(['n2.1.0', 'n2.1.1', 'n2.1.2'])
    expect(n?.[1]?.args.map((a) => a.text)).toEqual(['.b'])
    expect(object?.construct?.lanes.every((l) => l.objectValue)).toBe(true)
  })

  it('gives an array one lane, its contents', () => {
    const m = parse('[.[] | select(.a)]')
    const array = m.nodes[1]
    expect(array?.construct?.shape).toBe('array')
    expect(lanes(array)).toEqual([{ key: null, nodes: ['custom .[]', 'select select(.a)'] }])
    expect(array?.construct?.lanes[0]?.objectValue).toBe(false)
  })

  it('nests constructions, with ids that say where each node sits', () => {
    const m = parse('{a: [.b[] | {c: .d}]}')
    const inner = m.nodes[1]?.construct?.lanes[0]?.nodes[0]
    expect(inner?.construct?.shape).toBe('array')
    const leaf = inner?.construct?.lanes[0]?.nodes[1]
    expect(leaf?.id).toBe('n1.0.0.0.1')
    expect(lanes(leaf)).toEqual([{ key: 'c', nodes: ['pick .d'] }])
  })

  it('keeps keys as written: strings, keywords, computed keys and shorthands', () => {
    const m = parse('{"a b": .x, if: 1, (.k): .v, name, $v, "c"}')
    expect(lanes(m.nodes[1])).toEqual([
      { key: '"a b"', nodes: ['pick .x'] },
      { key: 'if', nodes: ['custom 1'] },
      { key: '(.k)', nodes: ['pick .v'] },
      // a shorthand's value has no text of its own: no stages to draw
      { key: 'name', nodes: [] },
      { key: '$v', nodes: [] },
      { key: '"c"', nodes: [] },
    ])
  })

  it('accepts a trailing comma and keeps comments out of ranges', () => {
    const m = parse('{a: .b # note\n , d: .e,}')
    expect(lanes(m.nodes[1])).toEqual([
      { key: 'a', nodes: ['pick .b'] },
      { key: 'd', nodes: ['pick .e'] },
    ])
  })

  it('makes a value the grammar cannot read one custom stage, keeping the other lanes', () => {
    // valid jq 1.8 that tree-sitter-jq rejects inside an object
    const m = parse('{a: .b, total: .x + .y, c: try .d catch 0}')
    expect(m.clean).toBe(false)
    expect(lanes(m.nodes[1])).toEqual([
      { key: 'a', nodes: ['pick .b'] },
      { key: 'total', nodes: ['custom .x + .y'] },
      { key: 'c', nodes: ['custom try .d catch 0'] },
    ])
  })

  it.each([
    ['an error between entries', '{a: if .x then 1 else 2 end, b: .c}'],
    ['an @format key', '{@base64: 2}'],
    ['an empty object', '{}'],
    ['an empty array', '[]'],
    ['a half-typed object', '{a: .b'],
  ])('leaves the whole construction custom for %s', (_, source) => {
    const m = parse(source)
    expect(kinds(m)).toEqual(['source', 'custom'])
    expect(m.nodes[1]?.construct).toBeUndefined()
  })

  it("degrades only the stage of an array's contents the grammar cannot parse", () => {
    const m = parse('[.[] | @csv | length]')
    expect(lanes(m.nodes[1])).toEqual([{ key: null, nodes: ['custom .[]', 'custom @csv', 'custom length'] }])
  })

  it('does not fan out a construction inside a call argument', () => {
    const m = parse('map({name})')
    expect(kinds(m)).toEqual(['source', 'map'])
    expect(m.nodes[1]?.construct).toBeUndefined()
  })

  it('marks the model clean only when the grammar read all of it', () => {
    expect(parse('{a: .b}').clean).toBe(true)
    expect(parse('.[] | @csv').clean).toBe(false)
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
    '{name: .name, ages: [.users[].age]}',
    '.users | {n: .a | map(.b) # why\n  | sort_by(.c), "k": [.[] | select(.x)], $v, total: .x + .y,}',
    '',
  ]

  it.each(corpus)('re-splicing every node with its own text is identity: %j', (source) => {
    const m = parse(source)
    for (const node of flatten(m)) {
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
