import { setDiagnostics } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { useEffect, type RefObject } from 'react'
import type { NodeResult } from '../core/eval/cache.ts'
import type { GraphModel } from '../core/parse/model.ts'
import { diagnostics } from './errors.ts'

/**
 * Marks failed stages in the editor: jq's compile errors where they point,
 * other errors over the whole stage, with the message on hover.
 *
 * Diagnostics carry no document change, so they never reparse or enter the
 * undo history (invariants 6 and 7). Ranges come from the committed source;
 * while the editor holds newer text (typing, inside the reparse debounce),
 * the marks already shown follow the edits and are replaced once that text
 * is committed and previewed.
 */
export function useEditorDiagnostics(
  editor: RefObject<EditorView | null>,
  source: string,
  model: GraphModel | null,
  results: ReadonlyMap<string, NodeResult> | null,
): void {
  useEffect(() => {
    const view = editor.current
    if (!view || view.state.doc.toString() !== source) return
    const found = model && results ? diagnostics(model, results) : []
    view.dispatch(setDiagnostics(view.state, found))
  }, [editor, source, model, results])
}
