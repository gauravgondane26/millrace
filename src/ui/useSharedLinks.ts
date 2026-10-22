import type { EditorView } from '@codemirror/view'
import { useEffect, type RefObject } from 'react'
import { decodeShare } from '../core/persist/share.ts'
import { openSpec } from '../core/splice/transaction.ts'
import { clearShareHash } from './persist.ts'
import { useAppStore } from './store.ts'

const OPENED = 'Opened the shared link, replacing the jq and the input. Ctrl+Z in the jq editor brings your jq back.'
const OPENED_JQ_ONLY = 'Opened the shared link’s jq, keeping your input. Ctrl+Z in the jq editor brings your jq back.'
const UNREADABLE = 'That link could not be read (it may have been cut short). Your document is unchanged.'

/**
 * A share link pasted into a tab already running the app only changes the
 * hash, so it is opened here rather than at startup (ui/persist): the jq
 * through the editor, as one undoable step (openSpec), and the input, if the
 * link has one, into the input pane.
 */
export function useSharedLinks(editor: RefObject<EditorView | null>) {
  useEffect(() => {
    const onHashChange = () => {
      const shared = decodeShare(location.hash)
      if (shared.status === 'none') return
      clearShareHash()
      const { setNotice, setInputText, selectNode } = useAppStore.getState()
      const view = editor.current
      if (shared.status === 'invalid' || !view) return setNotice(UNREADABLE)
      view.dispatch(openSpec(view.state.doc, shared.doc.source))
      if (shared.doc.input !== undefined) setInputText(shared.doc.input)
      selectNode(null)
      setNotice(shared.doc.input === undefined ? OPENED_JQ_ONLY : OPENED)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [editor])
}
