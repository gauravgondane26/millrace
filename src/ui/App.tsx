import { useAppStore } from './store.ts'

/**
 * App shell: the two views of the one source string sit side by side — the
 * canvas (graph projection) and the jq text. Both are placeholders here; the
 * CodeMirror editor and React Flow canvas get wired in as the parse/splice
 * pipeline comes online. The point of this shell is the layout seam and the
 * single-source-of-truth wiring, not the widgets.
 */
export function App() {
  const source = useAppStore((s) => s.source)
  const setSource = useAppStore((s) => s.setSource)

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">millrace</h1>
        <span className="text-xs text-neutral-500">jq scratchpad</span>
      </header>

      <main className="grid flex-1 grid-cols-2 overflow-hidden">
        <section
          aria-label="Graph canvas"
          className="flex items-center justify-center border-r border-neutral-800 text-neutral-600"
        >
          {/* TODO: React Flow canvas rendering the projected graph model */}
          <p className="text-sm">canvas — graph projection goes here</p>
        </section>

        <section aria-label="jq source" className="flex flex-col">
          {/* TODO: swap this textarea for the CodeMirror 6 editor (invariant 6:
              graph-origin transactions must be annotated to avoid update loops) */}
          <textarea
            aria-label="jq source text"
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-full w-full resize-none bg-neutral-900 p-4 font-mono text-sm text-neutral-100 outline-none"
          />
        </section>
      </main>
    </div>
  )
}
