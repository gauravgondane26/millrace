import type { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { locate } from '../core/parse/graph.ts'
import type { GraphNode } from '../core/parse/model.ts'
import { JqEditor } from './JqEditor.tsx'
import { OutputPane } from './OutputPane.tsx'
import { PipelineCanvas } from './PipelineCanvas.tsx'
import { ShareButton } from './Share.tsx'
import { StagePane, type Adding } from './StagePane.tsx'
import { useAppStore } from './store.ts'
import { useEditorDiagnostics } from './useEditorDiagnostics.ts'
import { useGraphEdits } from './useGraphEdits.ts'
import { useJqParser } from './useJqParser.ts'
import { useSharedLinks } from './useSharedLinks.ts'
import { usePreviews } from './usePreviews.ts'

/**
 * Two views of one source string: the jq text (left) and the pipeline graph
 * projected from it (right), each node previewing its own output on a sample
 * of the input. The Stage pane edits the selected node as fields; the Output
 * pane shows its preview.
 */
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

  // The graph model is derived from the source, never stored (invariant 1).
  const parser = useJqParser()
  const model = useMemo(
    () => (parser.status === 'ready' ? parser.parse(source) : null),
    [parser, source],
  )
  const previews = usePreviews(model, input)

  // Canvas edits dispatch through the editor, so its history covers them.
  const editorView = useRef<EditorView | null>(null)
  const edits = useGraphEdits(editorView, parser.status === 'ready' ? parser.parse : null)
  // a share link pasted into this tab opens through the editor too
  useSharedLinks(editorView)
  // failed stages are marked in the editor too, where they can be fixed
  useEditorDiagnostics(editorView, source, model, previews.results)
  const notice = useAppStore((s) => s.notice)
  const setNotice = useAppStore((s) => s.setNotice)

  // The selected node, or the last one: the program's result.
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const selectNode = useAppStore((s) => s.selectNode)
  const selected =
    (model && selectedNodeId !== null ? locate(model, selectedNodeId)?.node : undefined) ?? model?.nodes.at(-1) ?? null

  // A stage being added (the Stage pane's form), and where keyboard focus
  // should land on the canvas afterwards.
  const [adding, setAdding] = useState<Adding | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null)
  const focusNode = useCallback((id: string) => setFocusRequest((r) => ({ id, seq: (r?.seq ?? 0) + 1 })), [])

  const onSelect = useCallback(
    (id: string) => {
      selectNode(id)
      // selecting another node ends an add in progress
      setAdding((a) => (a && a.after.id !== id ? null : a))
    },
    [selectNode],
  )
  const onAddAfter = useCallback((after: GraphNode, index: number) => setAdding({ after, index }), [])
  const onAdded = useCallback(
    (id: string) => {
      setAdding(null)
      selectNode(id)
      focusNode(id)
    },
    [selectNode, focusNode],
  )
  const onCancelAdd = useCallback(() => {
    if (adding) focusNode(adding.after.id)
    setAdding(null)
  }, [adding, focusNode])

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">millrace</h1>
        <span className="shrink-0 text-xs text-neutral-400">jq scratchpad</span>
        {/* Always rendered: a live region must exist before its text changes.
            The dismiss button sits outside it, so it isn't read out with the message. */}
        <div role="status" className="min-w-0 flex-1 truncate text-right text-xs text-amber-300" title={notice ?? undefined}>
          {notice}
        </div>
        {notice !== null && (
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded px-1 text-xs text-neutral-400 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            ×
          </button>
        )}
        <ShareButton editor={editorView} />
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-h-0 flex-col border-r border-neutral-800">
          <Pane label="Input JSON" className="flex-1 border-b border-neutral-800">
            <textarea
              aria-label="Input JSON"
              spellCheck={false}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder='{"users": [{"name": "ada"}]}'
              className="h-full w-full resize-none bg-neutral-900 p-3 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
            />
          </Pane>
          <Pane label="jq filter" className="flex-1">
            <JqEditor viewRef={editorView} />
          </Pane>
        </div>

        <div className="flex min-h-0 flex-col">
          <Pane label="Pipeline" className="flex-1 border-b border-neutral-800">
            {model ? (
              <PipelineCanvas
                model={model}
                results={previews.results}
                running={previews.running}
                selectedId={selected?.id ?? null}
                onSelect={onSelect}
                edits={edits}
                onAddAfter={onAddAfter}
                focusRequest={focusRequest}
              />
            ) : parser.status === 'error' ? (
              <p className="p-3 font-mono text-sm text-red-400">Parser failed to load: {parser.message}</p>
            ) : (
              <p className="p-3 font-mono text-sm text-neutral-400">Loading parser…</p>
            )}
          </Pane>

          {model && (
            <Pane label="Stage" className="shrink-0 border-b border-neutral-800">
              <StagePane
                selected={selected}
                edits={edits}
                adding={adding}
                onCancelAdd={onCancelAdd}
                onAdded={onAdded}
              />
            </Pane>
          )}

          <Pane label="Output" className="flex-1">
            <OutputPane source={source} input={input} model={model} previews={previews} selected={selected} />
          </Pane>
        </div>
      </main>
    </div>
  )
}

function Pane(props: { label: string; className?: string; children: ReactNode }) {
  // Named by its heading, so each pane is a landmark region for screen readers.
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={`flex min-h-0 min-w-0 flex-col ${props.className ?? ''}`}>
      <div
        id={headingId}
        className="shrink-0 border-b border-neutral-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400"
      >
        {props.label}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}
