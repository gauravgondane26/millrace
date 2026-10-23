import type { EditorView } from '@codemirror/view'
import { useEffect, type RefObject } from 'react'
import { decodeShare } from '../core/persist/share.ts'
import { clearShareHash, openDocument, openedNotice } from './persist.ts'
import { useAppStore } from './store.ts'

const UNREADABLE = 'That link could not be read (it may have been cut short). Your document is unchanged.'

/**
 * A share link pasted into a tab already running the app only changes the
 * hash, so it is opened here rather than at startup (ui/persist), through
 * `openDocument`: one undoable step for the jq, and Undo in the notice for
 * the jq and the input.
 */
export function useSharedLinks(editor: RefObject<EditorView | null>) {
  useEffect(() => {
    const onHashChange = () => {
      const shared = decodeShare(location.hash)
      if (shared.status === 'none') return
      clearShareHash()
      const view = editor.current
      if (shared.status === 'invalid' || !view) return useAppStore.getState().setNotice(UNREADABLE)
      openDocument(view, shared.doc, (replaced) => openedNotice(shared.doc, replaced))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [editor])
}
