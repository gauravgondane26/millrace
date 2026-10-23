import type { EditorView } from '@codemirror/view'
import { useEffect, type RefObject } from 'react'
import { decodeShare } from '../core/persist/share.ts'
import { openSpec } from '../core/splice/transaction.ts'
import { clearShareHash, keepPrevious, openedNotice } from './persist.ts'
import { useAppStore } from './store.ts'

const UNREADABLE = 'That link could not be read (it may have been cut short). Your document is unchanged.'

/**
 * A share link pasted into a tab already running the app only changes the
 * hash, so it is opened here rather than at startup (ui/persist): the jq
 * through the editor, as one undoable step (openSpec), and the input, if the
 * link has one, into the input pane. The document it replaces is kept, so
 * the notice can offer Undo for both.
 */
export function useSharedLinks(editor: RefObject<EditorView | null>) {
  useEffect(() => {
    const onHashChange = () => {
      const shared = decodeShare(location.hash)
      if (shared.status === 'none') return
      clearShareHash()
      const { setNotice, setInputText, selectNode, inputText } = useAppStore.getState()
      const view = editor.current
      if (shared.status === 'invalid' || !view) return setNotice(UNREADABLE)
      const kept = keepPrevious({ source: view.state.doc.toString(), input: inputText }, shared.doc)
      view.dispatch(openSpec(view.state.doc, shared.doc.source))
      if (shared.doc.input !== undefined) setInputText(shared.doc.input)
      selectNode(null)
      setNotice(openedNotice(shared.doc, kept), kept ? 'restorePrevious' : null)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [editor])
}
