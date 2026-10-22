import { history, undo } from '@codemirror/commands'
import { EditorState, type Transaction } from '@codemirror/state'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadJqParser, type ParseJq } from '../parse/parser.ts'
import { deleteNode, insertAfter, replaceNode, type TextChange } from './edits.ts'
import { graphEditSpec } from './transaction.ts'

let parse: ParseJq

beforeAll(async () => {
  const grammar = fileURLToPath(new URL('../../../public/tree-sitter-jq.wasm', import.meta.url))
  parse = await loadJqParser(readFileSync(grammar))
})

/** The id and text of the node with this text, as the canvas would pass them. */
function target(source: string, text: string): [string, string] {
  const node = parse(source).nodes.find((n) => n.text === text)
  if (!node) throw new Error(`no node "${text}" in ${source}`)
  return [node.id, node.text]
}

const apply = (source: string, change: TextChange | null) => {
  if (!change) throw new Error('expected a change')
  return source.slice(0, change.from) + change.insert + source.slice(change.to)
}

describe('replaceNode', () => {
  it('replaces only that stage', () => {
    const source = '.users | map(.name) | unique'
    const change = replaceNode(parse(source), ...target(source, 'map(.name)'), 'map(.age)')
    expect(apply(source, change)).toBe('.users | map(.age) | unique')
  })

  it('keeps line breaks and comments around it', () => {
    const source = '.users\n| map(.name) # names\n| unique'
    const change = replaceNode(parse(source), ...target(source, 'map(.name)'), 'map(.age)')
    expect(apply(source, change)).toBe('.users\n| map(.age) # names\n| unique')
  })

  it('refuses a node whose text has changed since the user saw it', () => {
    const source = '.users | map(.name)'
    const [id] = target(source, 'map(.name)')
    expect(replaceNode(parse(source), id, 'map(.nam)', 'map(.age)')).toBeNull()
  })

  it('refuses the source node', () => {
    expect(replaceNode(parse('. | .a'), 'n0', '.', '.b')).toBeNull()
  })
})

describe('deleteNode', () => {
  it.each([
    ['a middle stage', '.users | map(.name) | unique', 'map(.name)', '.users | unique'],
    ['the last stage', '.users | map(.name) | unique', 'unique', '.users | map(.name)'],
    ['the first stage', '.users | map(.name) | unique', '.users', 'map(.name) | unique'],
    ['a stage after a leading `.`', '. | map(.x)', 'map(.x)', '.'],
    ['the only stage, leaving the identity filter', 'map(.x)', 'map(.x)', '.'],
    ['a stage of a multi-line pipeline', '.users\n| map(.name)\n| unique', 'map(.name)', '.users\n| unique'],
    // the comment stays: deleting a stage never silently deletes the user's notes
    ['a stage with a comment after it', '.users\n| map(.name) # names\n| unique', 'map(.name)', '.users # names\n| unique'],
  ])('removes %s', (_, source, text, expected) => {
    expect(apply(source, deleteNode(parse(source), ...target(source, text)))).toBe(expected)
  })

  it('refuses the source node', () => {
    expect(deleteNode(parse('.users'), 'n0', '')).toBeNull()
  })
})

describe('insertAfter', () => {
  it.each([
    ['a middle stage', '.users | unique', '.users', 'map(.name)', '.users | map(.name) | unique'],
    ['the last stage', '.users', '.users', 'length', '.users | length'],
    ['the input, before the first stage', 'map(.x)', '', '.[]', '.[] | map(.x)'],
    ['a leading `.`', '. | map(.x)', '.', '.[]', '. | .[] | map(.x)'],
    ['the input of an empty program', '', '', '.users', '.users'],
    ['the input of a program that is only a comment', '# hi', '', '.users', '# hi\n.users'],
    ['a stage of a multi-line pipeline, in its style', '.users\n  | map(.name)', 'map(.name)', 'unique', '.users\n  | map(.name)\n  | unique'],
    ['a stage whose only neighbouring gap has a comment', '.users # c\n| map(.x)', 'map(.x)', 'unique', '.users # c\n| map(.x) | unique'],
  ])('adds a stage after %s', (_, source, text, insert, expected) => {
    expect(apply(source, insertAfter(parse(source), source, ...target(source, text), insert))).toBe(expected)
  })

  it('re-projects to the new pipeline', () => {
    const source = '.users | unique'
    const next = apply(source, insertAfter(parse(source), source, ...target(source, '.users'), 'map(.name)'))
    expect(parse(next).nodes.map((n) => n.kind)).toEqual(['source', 'pick', 'map', 'unique'])
  })
})

describe('edge cases', () => {
  it('keeps UTF-16 offsets right around non-ASCII text', () => {
    const source = '"é😀" | .x | .y'
    expect(apply(source, deleteNode(parse(source), ...target(source, '.x')))).toBe('"é😀" | .y')
    expect(apply(source, replaceNode(parse(source), ...target(source, '.y'), '.z'))).toBe('"é😀" | .x | .z')
    expect(apply(source, insertAfter(parse(source), source, ...target(source, '.x'), '.w'))).toBe('"é😀" | .x | .w | .y')
  })

  it('edits a stage the grammar could not parse (@format), as one custom node', () => {
    const source = '.[] | @csv | length'
    expect(apply(source, replaceNode(parse(source), ...target(source, '@csv'), '@tsv'))).toBe('.[] | @tsv | length')
    expect(apply(source, deleteNode(parse(source), ...target(source, '@csv')))).toBe('.[] | length')
  })

  it('completes a half-typed stage', () => {
    const source = '.users | map(.name'
    const next = apply(source, replaceNode(parse(source), ...target(source, 'map(.name'), 'map(.name)'))
    expect(next).toBe('.users | map(.name)')
    expect(parse(next).nodes.map((n) => n.kind)).toEqual(['source', 'pick', 'map'])
  })

  it('splits a node in two when its new text holds a pipe', () => {
    const source = '.users | unique'
    const next = apply(source, replaceNode(parse(source), ...target(source, 'unique'), 'map(.name) | unique'))
    expect(parse(next).nodes.map((n) => n.text)).toEqual(['', '.users', 'map(.name)', 'unique'])
  })

  it('treats a parenthesised pipe as one stage', () => {
    const source = '(.a | .b) | .c'
    expect(apply(source, deleteNode(parse(source), ...target(source, '.c')))).toBe('(.a | .b)')
    expect(apply(source, deleteNode(parse(source), ...target(source, '(.a | .b)')))).toBe('.c')
  })

  it('copies a Windows line ending into the separator', () => {
    const source = '.users\r\n| map(.name)'
    const change = insertAfter(parse(source), source, ...target(source, 'map(.name)'), 'unique')
    expect(apply(source, change)).toBe('.users\r\n| map(.name)\r\n| unique')
  })

  it('adds the first stage below a leading comment', () => {
    const source = '# note\n.users | map(.x)'
    const change = insertAfter(parse(source), source, ...target(source, ''), '.[0]')
    expect(apply(source, change)).toBe('# note\n.[0] | .users | map(.x)')
  })
})

describe('as editor transactions (invariants 6 and 7)', () => {
  it('a graph delete is one undo step that restores the text exactly', () => {
    const source = '.users\n| map(.name) # names\n| unique'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    const change = deleteNode(parse(source), ...target(source, 'map(.name)'))
    if (!change) throw new Error('expected a change')
    state = state.update(graphEditSpec(change)).state
    expect(state.doc.toString()).toBe('.users # names\n| unique')

    let undone: Transaction | undefined
    undo({ state, dispatch: (tr) => (undone = tr) })
    expect(undone?.state.doc.toString()).toBe(source)
  })

  it('two graph edits in quick succession are two undo steps, not one', () => {
    // CodeMirror merges adjacent changes made within 500 ms into one history
    // event; two deletes at the same spot, back to back, are exactly that.
    const source = '.users | map(.name) | unique | length'
    let state = EditorState.create({ doc: source, extensions: [history()] })
    for (const text of ['map(.name)', 'unique']) {
      const doc = state.doc.toString()
      const change = deleteNode(parse(doc), ...target(doc, text))
      if (!change) throw new Error('expected a change')
      state = state.update(graphEditSpec(change)).state
    }
    expect(state.doc.toString()).toBe('.users | length')

    let undone: Transaction | undefined
    undo({ state, dispatch: (tr) => (undone = tr) })
    expect(undone?.state.doc.toString()).toBe('.users | unique | length')
  })
})
