import type { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { locate } from '../core/parse/graph.ts'
import type { GraphNode } from '../core/parse/model.ts'
import { GuideButton, GuidePanel, GuideRoot } from './Guide.tsx'
import { InputPane } from './InputPane.tsx'
import { JqEditor } from './JqEditor.tsx'
import { OutputPane } from './OutputPane.tsx'
import { restorePrevious, saveHere } from './persist.ts'
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
  const noticeAction = useAppStore((s) => s.noticeAction)
  const savingElsewhere = useAppStore((s) => s.savingElsewhere)
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
    <GuideRoot>
      <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
        <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
          <h1 className="text-sm font-semibold tracking-tight">millrace</h1>
          <span className="shrink-0 text-xs text-neutral-400">jq scratchpad</span>
          {/* Always rendered: a live region must exist before its text changes.
              The dismiss button sits outside it, so it isn't read out with the message. */}
          <div role="status" className="min-w-0 flex-1 truncate text-right text-xs text-amber-300" title={notice ?? undefined}>
            {notice}
          </div>
          {noticeAction === 'restorePrevious' && (
            <button
              type="button"
              onClick={() => restorePrevious(editorView.current)}
              className="shrink-0 rounded border border-neutral-500 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              Undo
            </button>
          )}
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
          {/* Its own live region, always there, apart from the notice: it lasts
              as long as another tab saves, whatever notices come and go. */}
          <div aria-live="polite" className="flex shrink-0 items-center gap-2 text-xs text-amber-300">
            {savingElsewhere && (
              <>
                <span>Open in another tab: changes here aren’t saved.</span>
                <button
                  type="button"
                  onClick={saveHere}
                  className="rounded border border-neutral-500 px-2 py-0.5 text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  Save here instead
                </button>
              </>
            )}
          </div>
          <GuideButton />
          {/* written by the build (scripts/license-notices.ts) */}
          <a
            href="licenses.txt"
            target="_blank"
            rel="noopener"
            className="shrink-0 rounded px-1 text-xs text-neutral-400 underline-offset-2 hover:text-neutral-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            Licenses
          </a>
          <ShareButton editor={editorView} />
        </header>

        {/* The guide's drawer lies over the panes, inside this box: opening it
            moves no pane, and on narrow screens it stays put while they scroll. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Two columns from md up. Narrower, one column of fixed-height panes
              that scrolls as a page, so no pane is squeezed to a sliver. */}
          <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:overflow-hidden">
            <div className="flex flex-col border-neutral-800 max-md:border-b md:min-h-0 md:border-r">
              <Pane label="Input JSON" className="h-40 border-b border-neutral-800 max-md:shrink-0 md:h-auto md:flex-1">
                <InputPane />
              </Pane>
              <Pane label="jq filter" className="h-40 max-md:shrink-0 md:h-auto md:flex-1">
                <JqEditor viewRef={editorView} />
              </Pane>
            </div>

            <div className="flex flex-col md:min-h-0">
              <Pane label="Pipeline" className="h-80 border-b border-neutral-800 max-md:shrink-0 md:h-auto md:flex-1">
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

              {/* One height for every kind (the add form for a custom stage is
                  the tallest), and there before the parser loads, so selecting a
                  node never moves the panes around it; at larger text sizes the
                  pane scrolls instead. */}
              <Pane label="Stage" className="h-[9.25rem] shrink-0 border-b border-neutral-800">
                <div className="h-full overflow-y-auto">
                  <StagePane
                    selected={selected}
                    edits={edits}
                    adding={adding}
                    onCancelAdd={onCancelAdd}
                    onAdded={onAdded}
                  />
                </div>
              </Pane>

              <Pane label="Output" className="h-96 max-md:shrink-0 md:h-auto md:flex-1">
                <OutputPane source={source} input={input} model={model} previews={previews} selected={selected} />
              </Pane>
            </div>
          </main>
          <GuidePanel editor={editorView} />
        </div>
      </div>
    </GuideRoot>
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
