import { useEffect, useRef, type MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { reparseFor, TEXT_REPARSE_DEBOUNCE_MS } from '../core/parse/schedule.ts'
import { useAppStore } from './store.ts'

/**
 * The jq source editor. CodeMirror holds the live text and its history (so
 * undo covers graph edits too, invariant 7); its update listener is the only
 * writer of `source` in the store. Typing is debounced before committing,
 * graph edits and undo/redo commit at once (invariant 6, core/parse/schedule).
 *
 * Tab is deliberately not bound to indent: it would trap keyboard focus.
 *
 * `viewRef` hands the view to graph edits, which must dispatch through it.
 */
export function JqEditor({ viewRef }: { viewRef?: MutableRefObject<EditorView | null> }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const commit = (view: EditorView) => {
      clearTimeout(timer)
      timer = undefined
      useAppStore.getState().setSource(view.state.doc.toString())
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: useAppStore.getState().source,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // jq is often one long line: wrapped, the whole program stays in view
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'jq filter source' }),
          editorTheme,
          EditorView.updateListener.of((update) => {
            const kind = reparseFor(update.transactions)
            if (kind === 'immediate') {
              commit(update.view)
            } else if (kind === 'debounce') {
              clearTimeout(timer)
              timer = setTimeout(() => commit(update.view), TEXT_REPARSE_DEBOUNCE_MS)
            }
          }),
        ],
      }),
    })
    if (viewRef) viewRef.current = view

    return () => {
      if (timer !== undefined) commit(view)
      if (viewRef?.current === view) viewRef.current = null
      view.destroy()
    }
  }, [viewRef])

  // The focus ring is an overlay rather than an outline on the editor: CM's
  // sticky gutter paints over anything drawn inside the editor's own box.
  return (
    <div className="group relative h-full">
      <div ref={hostRef} className="isolate h-full" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 hidden ring-2 ring-inset ring-blue-400 group-focus-within:block"
      />
    </div>
  )
}

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#171717', color: '#f5f5f5', fontSize: '14px' },
    // focus ring is drawn by the wrapper overlay in JqEditor
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.5',
    },
    '.cm-content': { caretColor: '#f5f5f5', padding: '12px 0' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#f5f5f5' },
    '.cm-gutters': { backgroundColor: '#171717', color: '#8a8a8a', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#ffffff0a' },
    '.cm-activeLineGutter': { backgroundColor: '#ffffff0a', color: '#d4d4d4' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      { backgroundColor: '#3b82f655' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: '#3b82f633', outline: '1px solid #3b82f6' },
  },
  { dark: true },
)
