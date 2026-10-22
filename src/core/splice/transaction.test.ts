import { history, redo, undo } from '@codemirror/commands'
import { EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { reparseFor } from '../parse/schedule.ts'
import { graphEdit, graphEditSpec, openSpec } from './transaction.ts'

/** Run a CodeMirror state command headlessly, returning the dispatched tx. */
function runCommand(
  state: EditorState,
  command: (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean,
): Transaction {
  let dispatched: Transaction | undefined
  command({ state, dispatch: (tr) => (dispatched = tr) })
  if (!dispatched) throw new Error('command dispatched nothing')
  return dispatched
}

describe('graphEditSpec', () => {
  it('splices the change and carries the graph-origin annotation', () => {
    const state = EditorState.create({ doc: '.a | .b' })
    const tr = state.update(graphEditSpec({ from: 5, to: 7, insert: '.c' }))
    expect(tr.state.doc.toString()).toBe('.a | .c')
    expect(tr.annotation(graphEdit)).toBe(true)
  })
})

describe('openSpec', () => {
  it('replaces the whole text as one undo step, committed at once', () => {
    let state = EditorState.create({ doc: '.a | .b # mine', extensions: [history()] })
    const opened = state.update(openSpec(state.doc, '.shared'))
    expect(opened.state.doc.toString()).toBe('.shared')
    expect(opened.annotation(graphEdit)).toBeUndefined()
    expect(reparseFor([opened])).toBe('immediate')

    state = opened.state
    expect(runCommand(state, undo).state.doc.toString()).toBe('.a | .b # mine')
  })
})

describe('undo is text history (invariant 7)', () => {
  it('undoes and redoes a graph edit through the editor history', () => {
    let state = EditorState.create({ doc: '.a | .b', extensions: [history()] })
    state = state.update(graphEditSpec({ from: 5, to: 7, insert: '.c' })).state

    const undone = runCommand(state, undo)
    expect(undone.state.doc.toString()).toBe('.a | .b')
    // undo is not graph-origin: the graph re-derives from the restored text
    expect(undone.annotation(graphEdit)).toBeUndefined()
    expect(reparseFor([undone])).toBe('immediate')

    const redone = runCommand(undone.state, redo)
    expect(redone.state.doc.toString()).toBe('.a | .c')
  })
})
