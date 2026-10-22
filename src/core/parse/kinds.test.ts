import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ADDABLE_KINDS, fieldsOf, newFieldsOf, stageText, type AddableKind } from './kinds.ts'
import { loadJqParser, type ParseJq } from './parser.ts'

let parse: ParseJq

beforeAll(async () => {
  const grammar = fileURLToPath(new URL('../../../public/tree-sitter-jq.wasm', import.meta.url))
  parse = await loadJqParser(readFileSync(grammar))
})

/** Sample field values per kind, as a user might type them. */
const SAMPLES: Record<AddableKind, string[]> = {
  select: ['.age > 30'],
  map: ['.name'],
  pick: ['.users'],
  sort_by: ['.age'],
  group_by: ['.team'],
  unique: [],
  limit: ['3', '.[]'],
  custom: ['reduce .[] as $x (0; . + $x)'],
}

/** The one stage a program of a single stage projects to. */
const onlyStage = (text: string) => {
  const nodes = parse(text).nodes
  expect(nodes).toHaveLength(2)
  return nodes[1]!
}

describe('stageText', () => {
  it.each(ADDABLE_KINDS)('builds a %s stage that projects back as one', (kind) => {
    const text = stageText(kind, SAMPLES[kind])
    expect(text).not.toBeNull()
    expect(onlyStage(text!).kind).toBe(kind)
  })

  it('gives each field value back as that field', () => {
    for (const kind of ADDABLE_KINDS) {
      const node = onlyStage(stageText(kind, SAMPLES[kind])!)
      const values = fieldsOf(node).map((f) => (f.target === 'whole' ? node.text : node.args[f.target]?.text))
      expect(values, kind).toEqual(SAMPLES[kind])
    }
  })

  it('waits for the fields a kind needs', () => {
    expect(stageText('select', [''])).toBeNull()
    expect(stageText('limit', ['3', ' '])).toBeNull()
    expect(stageText('pick', [])).toBeNull()
    expect(stageText('unique', [])).toBe('unique')
  })

  it('uses the values as typed, trimmed', () => {
    expect(stageText('map', ['  .name '])).toBe('map(.name)')
  })
})

describe('fieldsOf', () => {
  it('points every field at an argument the node has', () => {
    for (const text of ['select(.a)', 'map(.a)', 'sort_by(.a)', 'group_by(.a)', 'limit(1; .[])', 'pick(.a)']) {
      const node = onlyStage(text)
      for (const field of fieldsOf(node)) {
        if (field.target !== 'whole') expect(node.args[field.target], text).toBeDefined()
      }
    }
  })

  it('edits a plain path, and a custom stage, as their whole text', () => {
    expect(fieldsOf(onlyStage('.a.b')).map((f) => f.target)).toEqual(['whole'])
    expect(fieldsOf(onlyStage('reduce .[] as $x (0; .)'))).toEqual(newFieldsOf('custom'))
  })

  it('has no fields for unique, or for the input', () => {
    expect(fieldsOf(onlyStage('unique'))).toEqual([])
    expect(fieldsOf(parse('.').nodes[0]!)).toEqual([])
  })
})
