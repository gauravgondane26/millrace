import type { EditorView } from '@codemirror/view'
import { useState, type RefObject } from 'react'
import { shareFragment } from '../core/persist/share.ts'
import { useAppStore } from './store.ts'

const COPIED = 'Link copied. It holds the jq and the input, and nothing is uploaded.'
const COPIED_JQ_ONLY = 'Link copied with the jq only: the input is too big for a link.'

/**
 * Share: copies a link to this document. The link's fragment holds the jq
 * and, when it fits, the input (core/persist/share); fragments never reach a
 * server. Where the clipboard is off limits, the link is shown to copy by
 * hand instead.
 */
export function ShareButton({ editor }: { editor: RefObject<EditorView | null> }) {
  const setNotice = useAppStore((s) => s.setNotice)
  const [manual, setManual] = useState<string | null>(null)

  const share = async () => {
    // the editor's live text: the store lags typing by the reparse debounce
    const source = editor.current?.state.doc.toString() ?? useAppStore.getState().source
    const { fragment, droppedInput } = shareFragment(source, useAppStore.getState().inputText)
    const url = `${location.origin}${location.pathname}${location.search}#${fragment}`
    try {
      await navigator.clipboard.writeText(url)
      setManual(null)
      setNotice(droppedInput ? COPIED_JQ_ONLY : COPIED)
    } catch {
      setManual(url)
      setNotice(droppedInput ? `Copy this link (jq only: the input is too big for a link):` : 'Copy this link:')
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {manual !== null && (
        <>
          <input
            aria-label="Share link"
            readOnly
            autoFocus
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
            className="w-56 rounded border border-neutral-600 bg-neutral-900 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={() => {
              setManual(null)
              setNotice(null)
            }}
            className={button}
          >
            Done
          </button>
        </>
      )}
      <button type="button" onClick={() => void share()} className={button}>
        Share
      </button>
    </div>
  )
}

const button =
  'rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400'
