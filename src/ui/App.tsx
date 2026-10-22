import { useEffect, useState, type ReactNode } from 'react'
import { JqEditor } from './JqEditor.tsx'
import { useAppStore } from './store.ts'
import { runFilterInWorker } from '../worker/client.ts'

/**
 * The end-to-end loop works before the graph exists. The user pastes JSON,
 * edits jq in CodeMirror (treated as one opaque filter for now), and sees live
 * output computed in the worker (invariant 4). The graph canvas joins once
 * parsing lands.
 */
type Preview =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ok'; values: unknown[] }
  | { status: 'error'; message: string }

function cleanMessage(e: unknown): string {
  return String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, '')
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function App() {
  // Already debounced by the editor (invariant 6); only the input needs it here.
  const source = useAppStore((s) => s.source)
  const inputText = useAppStore((s) => s.inputText)
  const setInputText = useAppStore((s) => s.setInputText)
  const input = useDebounced(inputText, 250)

  const [preview, setPreview] = useState<Preview>({ status: 'empty' })

  useEffect(() => {
    if (input.trim() === '') {
      setPreview({ status: 'empty' })
      return
    }
    let value: unknown
    try {
      value = JSON.parse(input)
    } catch {
      setPreview({ status: 'error', message: 'Input is not valid JSON.' })
      return
    }
    let cancelled = false
    setPreview({ status: 'loading' })
    // One filter against the one-value input stream (invariant 3 semantics).
    runFilterInWorker(source, [value])
      .then((out) => {
        if (!cancelled) setPreview({ status: 'ok', values: out as unknown[] })
      })
      .catch((e) => {
        if (!cancelled) setPreview({ status: 'error', message: cleanMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [source, input])

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">millrace</h1>
        <span className="text-xs text-neutral-500">jq scratchpad</span>
      </header>

      <main className="grid flex-1 grid-cols-2 overflow-hidden">
        <div className="flex min-h-0 flex-col border-r border-neutral-800">
          <Pane label="Input JSON">
            <textarea
              aria-label="Input JSON"
              spellCheck={false}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder='{"users": [{"name": "ada"}]}'
              className="h-full w-full resize-none bg-neutral-900 p-3 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
            />
          </Pane>
          <Pane label="Output" className="border-t border-neutral-800">
            <OutputView preview={preview} />
          </Pane>
        </div>

        <Pane label="jq filter">
          <JqEditor />
        </Pane>
      </main>
    </div>
  )
}

function Pane(props: { label: string; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-1 flex-col ${props.className ?? ''}`}>
      <div className="shrink-0 border-b border-neutral-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {props.label}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}

function OutputView({ preview }: { preview: Preview }) {
  if (preview.status === 'empty') {
    return <Hint>Paste JSON on the left to see output.</Hint>
  }
  if (preview.status === 'loading') {
    return <Hint>Running…</Hint>
  }
  if (preview.status === 'error') {
    return (
      <pre className="h-full w-full overflow-auto whitespace-pre-wrap p-3 font-mono text-sm text-red-400">
        {preview.message}
      </pre>
    )
  }
  if (preview.values.length === 0) {
    return <Hint>No output (filter produced an empty stream).</Hint>
  }
  const text = preview.values.map((v) => JSON.stringify(v, null, 2)).join('\n')
  return (
    <pre className="h-full w-full overflow-auto p-3 font-mono text-sm text-neutral-100">{text}</pre>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="p-3 font-mono text-sm text-neutral-600">{children}</div>
}
