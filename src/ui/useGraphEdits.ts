import { redo, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { useMemo, type RefObject } from 'react'
import type { GraphModel } from '../core/parse/model.ts'
import type { ParseJq } from '../core/parse/parser.ts'
import { deleteNode, insertAfter, replaceNode, type TextChange } from '../core/splice/edits.ts'
import { graphEditSpec } from '../core/splice/transaction.ts'

/** Edits made on the canvas. Each returns false if nothing was applied. */
export interface GraphEdits {
  replace(id: string, expected: string, text: string): boolean
  remove(id: string, expected: string): boolean
  insertAfter(id: string, expected: string, text: string): boolean
  undo(): void
  redo(): void
}

/**
 * Graph edits go through the editor as tagged transactions (invariants 2, 6
 * and 7): CodeMirror's history then covers them, and its update listener
 * commits them at once.
 *
 * Ranges come from the editor's live text, re-projected at the moment of the
 * edit: the canvas draws from the committed source, which can lag typing by
 * the 200 ms debounce. Each edit also names the text the node is expected to
 * hold, so a node that changed underneath is refused rather than spliced.
 */
export function useGraphEdits(editor: RefObject<EditorView | null>, parse: ParseJq | null): GraphEdits {
  return useMemo(() => {
    const apply = (build: (model: GraphModel, source: string) => TextChange | null): boolean => {
      const view = editor.current
      if (!view || !parse) return false
      const source = view.state.doc.toString()
      const change = build(parse(source), source)
      if (!change) return false
      view.dispatch(graphEditSpec(change))
      return true
    }
    const history = (command: typeof undo) => () => {
      if (editor.current) command(editor.current)
    }
    return {
      replace: (id, expected, text) => apply((model) => replaceNode(model, id, expected, text)),
      remove: (id, expected) => apply((model) => deleteNode(model, id, expected)),
      insertAfter: (id, expected, text) =>
        apply((model, source) => insertAfter(model, source, id, expected, text)),
      undo: history(undo),
      redo: history(redo),
    }
  }, [editor, parse])
}
