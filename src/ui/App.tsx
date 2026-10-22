import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { JqEditor } from './JqEditor.tsx'
import { OutputPane } from './OutputPane.tsx'
import { PipelineCanvas } from './PipelineCanvas.tsx'
import { useAppStore } from './store.ts'
import { useJqParser } from './useJqParser.ts'
import { usePreviews } from './usePreviews.ts'

/**
 * Two views of one source string: the jq text (bottom left) and the pipeline
 * graph projected from it (top right), each node previewing its own output on
 * a sample of the input. The Output pane shows the selected node's preview.
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

  // The selected node, or the last one: the program's result.
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const selectNode = useAppStore((s) => s.selectNode)
  const nodes = model?.nodes ?? []
  const picked = nodes.findIndex((n) => n.id === selectedNodeId)
  const selectedIndex = picked === -1 ? nodes.length - 1 : picked

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">millrace</h1>
        <span className="text-xs text-neutral-400">jq scratchpad</span>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] grid-rows-2">
        <Pane label="Input JSON" className="border-b border-r border-neutral-800">
          <textarea
            aria-label="Input JSON"
            spellCheck={false}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder='{"users": [{"name": "ada"}]}'
            className="h-full w-full resize-none bg-neutral-900 p-3 font-mono text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
          />
        </Pane>

        <Pane label="Pipeline" className="border-b border-neutral-800">
          {model ? (
            <PipelineCanvas
              model={model}
              results={previews.results}
              running={previews.running}
              selectedId={nodes[selectedIndex]?.id ?? null}
              onSelect={selectNode}
            />
          ) : parser.status === 'error' ? (
            <p className="p-3 font-mono text-sm text-red-400">Parser failed to load: {parser.message}</p>
          ) : (
            <p className="p-3 font-mono text-sm text-neutral-400">Loading parser…</p>
          )}
        </Pane>

        <Pane label="jq filter" className="border-r border-neutral-800">
          <JqEditor />
        </Pane>

        <Pane label="Output">
          <OutputPane source={source} input={input} model={model} previews={previews} selectedIndex={selectedIndex} />
        </Pane>
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
