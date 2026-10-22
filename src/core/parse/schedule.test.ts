import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { graphEditSpec } from '../splice/transaction.ts'
import { reparseFor } from './schedule.ts'

const state = EditorState.create({ doc: '.a | .b' })

describe('reparseFor — origin tags (invariant 6)', () => {
  it('debounces user typing', () => {
    const tr = state.update({
      changes: { from: 7, insert: ' | .c' },
      annotations: Transaction.userEvent.of('input.type'),
    })
    expect(reparseFor([tr])).toBe('debounce')
  })

  it('commits graph edits immediately', () => {
    const tr = state.update(graphEditSpec({ from: 5, to: 7, insert: '.c' }))
    expect(reparseFor([tr])).toBe('immediate')
  })

  it('ignores transactions that do not change the document', () => {
    const tr = state.update({ selection: EditorSelection.cursor(3) })
    expect(reparseFor([tr])).toBe('none')
  })

  it('lets a graph edit win over typing in the same batch', () => {
    const typed = state.update({ changes: { from: 0, insert: ' ' } })
    const graph = typed.state.update(graphEditSpec({ from: 6, to: 8, insert: '.c' }))
    expect(reparseFor([typed, graph])).toBe('immediate')
  })
})
