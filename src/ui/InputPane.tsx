import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { useAppStore } from './store.ts'

/**
 * Input over this many characters isn't put in a textarea: the browser's own
 * text editing takes about 130 ms per MB to take it in (six seconds or more
 * for a 50 MB paste, with the page frozen), whatever the app does after.
 */
export const EDITABLE_INPUT_LIMIT = 1_000_000

/** How much of a large input is shown, as text. */
const HEAD = 64_000

const button =
  'rounded border border-neutral-500 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400'

/**
 * The input JSON. Up to 1 MB it is a plain text field. Past that it is shown,
 * not edited: its size and its first 64 KB, replaced by pasting, opening a
 * file or dropping one. A paste that would take the field past the limit is
 * caught before the browser inserts it and goes straight to the store.
 */
export function InputPane() {
  const inputText = useAppStore((s) => s.inputText)
  const setInputText = useAppStore((s) => s.setInputText)
  const [dropping, setDropping] = useState(false)
  const [reading, setReading] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const large = inputText.length > EDITABLE_INPUT_LIMIT

  const replace = (text: string) => {
    setFailed(null)
    setInputText(text)
  }

  const open = (file: File | undefined) => {
    if (!file) return
    setReading(file.name)
    setFailed(null)
    file.text().then(
      (text) => {
        setReading(null)
        replace(text)
      },
      () => {
        setReading(null)
        setFailed(`Couldn't read ${file.name}.`)
      },
    )
  }

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const pasted = e.clipboardData.getData('text/plain')
    const field = e.target instanceof HTMLTextAreaElement ? e.target : null
    if (field) {
      const { selectionStart: start, selectionEnd: end, value } = field
      if (value.length - (end - start) + pasted.length <= EDITABLE_INPUT_LIMIT) return // the field takes it
      e.preventDefault()
      replace(value.slice(0, start) + pasted + value.slice(end))
    } else {
      // the large view: a paste replaces the whole input
      e.preventDefault()
      replace(pasted)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropping(false)
    open(e.dataTransfer.files[0])
  }

  return (
    <div
      className={`flex h-full flex-col ${dropping ? 'outline outline-2 -outline-offset-2 outline-blue-400' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="min-h-0 flex-1">
        {large ? (
          <LargeInput text={inputText} onPaste={onPaste} />
        ) : (
          <textarea
            aria-label="Input JSON"
            spellCheck={false}
            value={inputText}
            onChange={(e) => replace(e.target.value)}
            onPaste={onPaste}
            placeholder='{"users": [{"name": "ada"}]}'
            className="h-full w-full resize-none bg-neutral-900 p-3 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400"
          />
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-neutral-800 px-3 text-xs text-neutral-400">
        <button type="button" className={button} onClick={() => fileInput.current?.click()}>
          Open file…
        </button>
        {large && (
          <button type="button" className={button} onClick={() => replace('')}>
            Clear
          </button>
        )}
        <span role="status" className="min-w-0 flex-1 truncate text-right">
          {failed ?? (reading ? `Reading ${reading}…` : inputText === '' ? 'or drop a file here' : formatSize(inputText.length))}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.jsonl,.ndjson,.txt,application/json,text/plain"
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            open(e.target.files?.[0])
            e.target.value = '' // so the same file can be opened again
          }}
        />
      </div>
    </div>
  )
}

/** A large input, shown but not edited. It takes focus, so it can be pasted over. */
function LargeInput({ text, onPaste }: { text: string; onPaste: (e: ClipboardEvent<HTMLElement>) => void }) {
  return (
    <div
      role="region"
      aria-label="Input JSON"
      aria-describedby="large-input-note"
      tabIndex={0}
      onPaste={onPaste}
      // the region scrolls, so it is what takes focus (keyboard scrolling)
      className="h-full overflow-auto bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400"
    >
      <p
        id="large-input-note"
        className="sticky top-0 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-amber-300"
      >
        {formatSize(text.length)}: too big to edit here, so it is shown, not edited. Paste, open or drop a file to
        replace it.
      </p>
      <pre className="whitespace-pre-wrap break-all p-3 font-mono text-sm text-neutral-100">
        {text.slice(0, HEAD)}
        {text.length > HEAD && <span className="text-neutral-400">{'\n'}… the first {formatSize(HEAD)} of {formatSize(text.length)}</span>}
      </pre>
    </div>
  )
}

/** Characters as a size, as people read one: "840 B", "12.5 KB", "50.4 MB". */
function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} B`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)} KB`
  return `${(chars / 1_000_000).toFixed(1)} MB`
}
