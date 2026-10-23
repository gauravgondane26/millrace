import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadJqParser, type ParseJq } from '../parse/parser.ts'
import { GUIDE_SECTIONS, type GuideExample } from './sections.ts'

/**
 * The guide's examples draw what their sections describe: a plain chain, an
 * object fanning out into lanes, a custom card. What jq makes of them is
 * tested in worker/guide.test.ts.
 */
let parse: ParseJq

beforeAll(async () => {
  const grammar = fileURLToPath(new URL('../../../public/tree-sitter-jq.wasm', import.meta.url))
  parse = await loadJqParser(readFileSync(grammar))
})

const example = (id: string): GuideExample => {
  const found = GUIDE_SECTIONS.find((s) => s.id === id)?.example
  if (!found) throw new Error(`no example in section ${id}`)
  return found
}

describe('guide sections', () => {
  it('have unique ids', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('name each example uniquely, for the notice after loading it', () => {
    const names = GUIDE_SECTIONS.flatMap((s) => (s.example ? [s.example.name] : []))
    expect(new Set(names).size).toBe(names.length)
  })

  it('close every code span they open', () => {
    for (const s of GUIDE_SECTIONS) {
      for (const p of s.paragraphs) expect(p.split('`').length % 2, `${s.id}: ${p}`).toBe(1)
    }
  })

  it('previews: a plain chain of structural stages', () => {
    expect(parse(example('previews').jq).nodes.map((n) => n.kind)).toEqual(['source', 'pick', 'map', 'map'])
  })

  it('fan-out: an object with one lane per key', () => {
    const nodes = parse(example('fan-out').jq).nodes
    const object = nodes.at(-1)
    expect(object?.construct?.shape).toBe('object')
    expect(object?.construct?.lanes.map((l) => l.key?.text)).toEqual(['count', 'names'])
    expect(object?.construct?.lanes.map((l) => l.nodes.map((n) => n.kind))).toEqual([['custom'], ['map']])
  })

  it('errors: reduce is a custom card, and the misspelt stage has a card of its own', () => {
    const nodes = parse(example('errors').jq).nodes
    expect(nodes.map((n) => n.kind)).toEqual(['source', 'pick', 'custom', 'custom', 'custom'])
    expect(nodes[2]?.text).toBe('reduce .[] as $u (0; . + $u.age)')
    expect(nodes[3]?.text).toBe('lenght')
  })
})
