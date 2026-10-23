import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SAMPLE_ITEMS } from '../core/eval/sample.ts'
import { locate } from '../core/parse/graph.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { compileErrors, describeCompileErrors } from '../core/eval/diagnose.ts'
import { EngineError, formatInWorker, FULL_RUN_TIMEOUT_MS, PREVIEW_OUTPUT_LIMIT, runInWorker, type RunOutput } from '../worker/client.ts'
import { errorText, messageOf } from './errors.ts'
import { TextView } from './TextView.tsx'
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
  const blank = !/\S/.test(input) // trim() would copy a 50 MB input on every render
  if (blank) {
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
  const notices: string[] = []
  if (sampled) notices.push(`Previewing a sample: arrays cut to ${SAMPLE_ITEMS} items. Run full for the complete result.`)
  if (shown.kind === 'output' && shown.truncated) {
    notices.push(`Output cut at ${PREVIEW_OUTPUT_LIMIT / 1_000_000} MB; the filter produces more.`)
  }
  if (shown.kind === 'output' && shown.partial) notices.push('Computed from output that was cut further up.')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-400">{caption}</span>
        <button
          type="button"
          onClick={full.state.status === 'running' ? full.stop : full.run}
          disabled={blank}
          // fixed width: switching to Stop doesn't move the buttons beside it
          className="w-20 shrink-0 rounded border border-neutral-500 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"
        >
          {full.state.status === 'running' ? 'Stop' : 'Run full'}
        </button>
        <CopyButton text={shown.kind === 'output' ? pretty : null} />
      </div>
      <div className="min-h-0 flex-1">
        {shown.kind === 'hint' && <Hint>{shown.text}</Hint>}
        {shown.kind === 'error' && (
          // whitespace-pre: compile errors are caret diagrams that must not wrap
          <pre tabIndex={0} className={`${scrollable} whitespace-pre text-red-400`}>
            {shown.message}
          </pre>
        )}
        {shown.kind === 'output' &&
          (shown.text === '' ? (
            <Hint>No output (the filter produced an empty stream).</Hint>
          ) : (
            <TextView text={pretty} className="text-neutral-100" />
          ))}
      </div>
      {/* Always rendered, even empty: a live region must exist before its
          content changes, or screen readers may not announce it. A status
          bar one line high whatever it says, so a preview that adds or drops
          a notice never moves the output (the full text is in its title). */}
      <div
        role="status"
        title={notices.join('\n')}
        className="h-7 shrink-0 truncate border-t border-neutral-800 px-3 text-xs leading-7 text-amber-300"
      >
        {notices.join(' · ')}
      </div>
    </div>
  )
}

/**
 * The output and error views scroll, so they take keyboard focus: arrow keys
 * and Page Up/Down then scroll them without a mouse.
 */
const scrollable =
  'h-full w-full overflow-auto p-3 font-mono text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400'

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
    runInWorker(source, input, PREVIEW_OUTPUT_LIMIT, controller.signal, FULL_RUN_TIMEOUT_MS).then(
      (output) => !controller.signal.aborted && setState({ status: 'done', output }),
      (e: unknown) => !controller.signal.aborted && setState({ status: 'error', message: fullRunError(e, source) }),
    )
  }
  // back to previews; the worker still busy with it is dropped (client.ts)
  const stop = () => {
    inFlight.current?.abort()
    setState({ status: 'idle' })
  }
  return { state, run, stop }
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

function Hint({ children }: { children: ReactNode }) {
  return <div className="p-3 font-mono text-sm text-neutral-400">{children}</div>
}

/**
 * Copies the output shown. The view draws only the lines on screen, so
 * selecting by hand can't take a long output whole; this can.
 */
function CopyButton({ text }: { text: string | null }) {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() => {
        if (!text) return
        navigator.clipboard.writeText(text).then(
          () => setCopied('Copied'),
          () => setCopied('Copy failed'),
        )
      }}
      className="w-20 shrink-0 rounded border border-neutral-500 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"
    >
      {/* fixed width: the label changing doesn't move the buttons beside it */}
      <span aria-live="polite">{copied ?? 'Copy'}</span>
    </button>
  )
}
