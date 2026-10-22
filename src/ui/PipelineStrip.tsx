import type { ReactNode } from 'react'
import type { GraphModel } from '../core/parse/model.ts'
import type { ParserState } from './useJqParser.ts'

/**
 * A read-only list of the projected stages, so the parse is visible before
 * the canvas exists. The React Flow canvas replaces this in the next phase.
 * Single row, scrolls sideways: its height never changes, so updates cause no
 * layout shift.
 */
export function PipelineStrip({ parser, model }: { parser: ParserState; model: GraphModel | null }) {
  return (
    <section aria-label="Pipeline" className="shrink-0 border-t border-neutral-800">
      <div className="border-b border-neutral-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Pipeline
      </div>
      <div className="h-16 overflow-x-auto px-3 py-2">
        {parser.status === 'loading' && <Note>Loading parser…</Note>}
        {parser.status === 'error' && (
          <Note className="text-red-400">Parser failed to load: {parser.message}</Note>
        )}
        {model && (
          <ol className="flex h-full items-center gap-2">
            {model.nodes.map((node) => (
              <li
                key={node.id}
                title={node.text}
                className={`flex h-full max-w-56 shrink-0 flex-col justify-center rounded border px-2 ${
                  node.kind === 'custom'
                    ? 'border-dashed border-neutral-600 bg-neutral-900'
                    : 'border-neutral-700 bg-neutral-800'
                }`}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  {node.kind}
                </span>
                <span className="truncate font-mono text-xs text-neutral-100">
                  {node.kind === 'source' ? 'input' : node.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function Note({ children, className = 'text-neutral-500' }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-xs ${className}`}>{children}</p>
}
