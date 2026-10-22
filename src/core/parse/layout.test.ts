import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { chainIndex, flatten, locate, siblingId } from './graph.ts'
import { layout } from './layout.ts'
import { loadJqParser, type ParseJq } from './parser.ts'

let parse: ParseJq

beforeAll(async () => {
  const grammar = fileURLToPath(new URL('../../../public/tree-sitter-jq.wasm', import.meta.url))
  parse = await loadJqParser(readFileSync(grammar))
})

/** Each node's text (or "input") at its cell, and the links by text. */
function draw(source: string) {
  const model = parse(source)
  const { cells, links } = layout(model)
  const text = new Map(flatten(model).map((n) => [n.id, n.kind === 'source' ? 'input' : n.text]))
  return {
    cells: [...cells].map(([id, c]) => `${text.get(id)} @${c.col},${c.row}`),
    links: links.map((l) => `${text.get(l.source)} -${l.role}-> ${text.get(l.target)}`),
  }
}

describe('layout: derived positions for the DAG', () => {
  it('lays a linear chain along one row', () => {
    expect(draw('.a | select(.b) | unique')).toEqual({
      cells: ['input @0,0', '.a @1,0', 'select(.b) @2,0', 'unique @3,0'],
      links: ['input -next-> .a', '.a -next-> select(.b)', 'select(.b) -next-> unique'],
    })
  })

  it('stacks lanes before their construction, the first on its row', () => {
    expect(draw('.u | {a: .x | map(.y), b: .z} | length')).toEqual({
      cells: [
        'input @0,0',
        '.u @1,0',
        '.x @2,0',
        'map(.y) @3,0',
        '.z @2,1',
        '{a: .x | map(.y), b: .z} @4,0',
        'length @5,0',
      ],
      links: [
        'input -next-> .u',
        '.u -fan-out-> .x',
        '.x -next-> map(.y)',
        'map(.y) -fan-in-> {a: .x | map(.y), b: .z}',
        '.u -fan-out-> .z',
        '.z -fan-in-> {a: .x | map(.y), b: .z}',
        '{a: .x | map(.y), b: .z} -next-> length',
      ],
    })
  })

  it('keeps an array construction a straight line', () => {
    expect(draw('[.[] | .a]').cells).toEqual(['input @0,0', '.[] @1,0', '.a @2,0', '[.[] | .a] @3,0'])
  })

  it('gives a nested construction the rows it needs, pushing later lanes down', () => {
    const { cells } = draw('{a: {b: .x, c: .y}, d: .z}')
    expect(cells).toEqual([
      'input @0,0',
      '.x @1,0',
      '.y @1,1',
      '{b: .x, c: .y} @2,0',
      '.z @1,2',
      '{a: {b: .x, c: .y}, d: .z} @3,0',
    ])
  })

  it('draws no lane for a shorthand entry, linking the construction straight on if it has no other', () => {
    expect(draw('.u | {name, age}')).toEqual({
      cells: ['input @0,0', '.u @1,0', '{name, age} @2,0'],
      links: ['input -next-> .u', '.u -next-> {name, age}'],
    })
    expect(draw('{name, a: .b}').links).toEqual(['input -fan-out-> .b', '.b -fan-in-> {name, a: .b}'])
  })
})

describe('graph helpers', () => {
  it('flattens lanes before their construction', () => {
    expect(flatten(parse('{a: .x, b: .y} | .a')).map((n) => n.id)).toEqual(['n0', 'n1.0.0', 'n1.1.0', 'n1', 'n2'])
  })

  it('locates a node in its own chain', () => {
    const model = parse('{a: .x | .y, b: .z}')
    const found = locate(model, 'n1.0.1')
    expect(found?.node.text).toBe('.y')
    expect(found?.index).toBe(1)
    expect(found?.chain.map((n) => n.text)).toEqual(['.x', '.y'])
    expect(found?.lane?.key?.text).toBe('a')
    expect(locate(model, 'n1')?.lane).toBeNull()
    expect(locate(model, 'n9')).toBeNull()
  })

  it('names a sibling by its place in the chain', () => {
    expect(siblingId('n3', 2)).toBe('n2')
    expect(siblingId('n1.0.4', 5)).toBe('n1.0.5')
    expect(siblingId('n12.10.11', 0)).toBe('n12.10.0')
    expect(chainIndex('n12.10.11')).toBe(11)
    expect(chainIndex('n0')).toBe(0)
  })
})
