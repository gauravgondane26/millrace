import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SAMPLE_ITEMS } from '../core/eval/sample.ts'
import { locate } from '../core/parse/graph.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { compileErrors, describeCompileErrors } from '../core/eval/diagnose.ts'
import { EngineError, formatInWorker, PREVIEW_OUTPUT_LIMIT, runInWorker, type RunOutput } from '../worker/client.ts'
import { errorText, messageOf } from './errors.ts'
import { kindLabel, nodeLabel, summarize } from './summary.ts'
import type { Previews } from './usePreviews.ts'

interface Props {
  source: string
  input: string
  model: GraphModel | null
  previews: Previews
  /** The node whose preview is shown. */
  selected: GraphNode | null
}

type Shown =
  | { kind: 'hint'; text: string }
  | { kind: 'output'; text: string; truncated: boolean; partial: boolean }
  | { kind: 'error'; message: string }

/**
 * The selected node's preview, or the result of an explicit "run full": the
 * whole program on the whole input (invariant 4). That is the exact jq answer;
 * previews are stage by stage on a sample, which differs only for filters
 * where a later stage reads `input` or `$__loc__`. Any edit returns to previews.
 */
export function OutputPane({ source, input, model, previews, selected: node }: Props) {
  const full = useFullRun(source, input)
  const results = previews.results

  let shown: Shown
  let caption = ''
  if (input.trim() === '') {
    shown = { kind: 'hint', text: 'Paste JSON on the left to see output.' }
  } else if (full.state.status !== 'idle') {
    caption = 'Whole program on the whole input'
    shown =
      full.state.status === 'running'
        ? { kind: 'hint', text: 'Running the whole program…' }
        : full.state.status === 'error'
          ? { kind: 'error', message: full.state.message }
          : { kind: 'output', text: full.state.output.text, truncated: full.state.output.truncated, partial: false }
  } else {
    const result = node ? results?.get(node.id) : undefined
    // the canvas shows the node's kind; the caption names which node this is
    if (node) caption = nodeLabel(node)
    if (!result || !node) {
      shown = { kind: 'hint', text: 'Running…' }
    } else if (result.status === 'ok') {
      shown = { kind: 'output', text: result.output.text, truncated: result.output.truncated, partial: result.partial }
      caption += ` · ${summarize(result, false).text.split(' · ')[0]}`
    } else if (result.status === 'error') {
      shown = { kind: 'error', message: errorText(result, node, source) }
    } else {
      const culprit = model && locate(model, result.by)?.node
      const error = results?.get(result.by)
      shown = {
        kind: 'error',
        message: `Blocked by an error in ${culprit ? `${kindLabel(culprit)} ${nodeLabel(culprit)}` : 'an earlier step'}:\n\n${
          error?.status === 'error' && culprit ? errorText(error, culprit, source) : ''
        }`,
      }
    }
  }

  const pretty = useFormatted(shown.kind === 'output' ? shown.text : '')
  const sampled = full.state.status === 'idle' && previews.sample?.sampled

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400">{caption}</span>
        <button
          type="button"
          onClick={full.run}
          disabled={input.trim() === '' || full.state.status === 'running'}
          className="shrink-0 rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"
        >
          Run full
        </button>
      </div>
      {/* Always rendered, even empty: a live region must exist before its
          content changes, or screen readers may not announce it. */}
      <div role="status" className="shrink-0 text-xs text-amber-300">
        {sampled && <Notice>Previewing a sample: arrays cut to {SAMPLE_ITEMS} items. Run full for the complete result.</Notice>}
        {shown.kind === 'output' && shown.truncated && (
          <Notice>Output cut at {PREVIEW_OUTPUT_LIMIT / 1_000_000} MB; the filter produces more.</Notice>
        )}
        {shown.kind === 'output' && shown.partial && <Notice>Computed from output that was cut further up.</Notice>}
      </div>
      <div className="min-h-0 flex-1">
        {shown.kind === 'hint' && <Hint>{shown.text}</Hint>}
        {shown.kind === 'error' && (
          // whitespace-pre: compile errors are caret diagrams that must not wrap
          <pre className="h-full w-full overflow-auto whitespace-pre p-3 font-mono text-sm text-red-400">
            {shown.message}
          </pre>
        )}
        {shown.kind === 'output' &&
          (shown.text === '' ? (
            <Hint>No output (the filter produced an empty stream).</Hint>
          ) : (
            <pre className="h-full w-full overflow-auto p-3 font-mono text-sm text-neutral-100">
              {pretty}
            </pre>
          ))}
      </div>
    </div>
  )
}

type FullRun =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; output: RunOutput }
  | { status: 'error'; message: string }

function useFullRun(source: string, input: string) {
  const [state, setState] = useState<FullRun>({ status: 'idle' })
  const inFlight = useRef<AbortController | null>(null)

  // an edit returns to previews, abandoning a full run in flight
  useEffect(() => {
    setState({ status: 'idle' })
    return () => inFlight.current?.abort()
  }, [source, input])

  const run = () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ status: 'running' })
    runInWorker(source, input, PREVIEW_OUTPUT_LIMIT, controller.signal).then(
      (output) => !controller.signal.aborted && setState({ status: 'done', output }),
      (e: unknown) => !controller.signal.aborted && setState({ status: 'error', message: fullRunError(e, source) }),
    )
  }
  return { state, run }
}

/**
 * Pretty-prints in the worker (jq's own formatting). Until that lands, the
 * compact text shows: never empty, and never another node's output.
 */
function useFormatted(text: string): string {
  const [formatted, setFormatted] = useState<{ raw: string; pretty: string } | null>(null)
  useEffect(() => {
    if (text === '') return
    const controller = new AbortController()
    formatInWorker(text, 2, controller.signal).then(
      (pretty) => setFormatted({ raw: text, pretty }),
      () => {}, // abandoned, or failed: the compact text is still correct
    )
    return () => controller.abort()
  }, [text])
  return formatted?.raw === text ? formatted.pretty : text
}

/** The whole program was compiled, so its errors are placed as they are. */
function fullRunError(e: unknown, source: string): string {
  if (!(e instanceof EngineError) || e.kind !== 'compile') return messageOf(e)
  return describeCompileErrors(compileErrors(e.message, source), source, 0)
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="border-b border-neutral-800 px-3 py-1.5">{children}</p>
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="p-3 font-mono text-sm text-neutral-400">{children}</div>
}
