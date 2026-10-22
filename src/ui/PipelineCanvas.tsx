import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { NodeResult } from '../core/eval/cache.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { nodeLabel, summarize, type Summary } from './summary.ts'
import type { GraphEdits } from './useGraphEdits.ts'

interface StageData extends Record<string, unknown> {
  node: GraphNode
  index: number
  summary: Summary
}

type StageNode = Node<StageData, 'stage'>

interface Props {
  model: GraphModel
  results: NodeResult[] | null
  running: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  edits: GraphEdits
  /** "Add after" on a node: the Stage pane takes it from there. */
  onAddAfter: (node: GraphNode, index: number) => void
  /** Move keyboard focus to this node once it is drawn (seq makes repeats count). */
  focusRequest: { id: string; seq: number } | null
}

interface CanvasActions {
  /** The node whose raw jq is being edited in place. */
  editing: string | null
  startEditing: (id: string) => void
  commitEdit: (data: StageData, value: string | null) => void
  addAfter: (data: StageData) => void
  remove: (data: StageData) => void
}

const Actions = createContext<CanvasActions | null>(null)

/**
 * The pipeline as a graph: one node per stage, left to right, each with a
 * one-line preview. Selecting a node (click, or Enter when focused) shows its
 * full preview in the Output pane and reveals its actions: edit (also
 * double-click or F2), add a stage after it, delete it.
 *
 * Everything here is derived from the model and results on each render.
 * Positions come from the node index and are never stored, so the canvas holds
 * no second model of the pipeline (invariant 1). Edits go out as text changes
 * through the editor (useGraphEdits), and the canvas re-derives from the text.
 */
export function PipelineCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

const SPACING = 210
// readable beats complete: a long chain pans rather than shrinking to fit
const FIT = { padding: 0.15, minZoom: 0.7, maxZoom: 1 }

function Canvas({ model, results, running, selectedId, onSelect, edits, onAddAfter, focusRequest }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)

  // React Flow measures each node and expects controlled nodes to carry the
  // measurement back; without it, it hides nodes to re-measure them on every
  // render, which flickers and drops keyboard focus. This is view state read
  // from the DOM, not a model of the pipeline.
  const measured = useRef(new Map<string, { width: number; height: number }>())

  const nodes = useMemo<StageNode[]>(
    () =>
      model.nodes.map((node, index) => {
        const size = measured.current.get(node.id)
        return {
          id: node.id,
          type: 'stage',
          position: { x: index * SPACING, y: 0 },
          data: { node, index, summary: summarize(results?.[index], running) },
          selected: node.id === selectedId,
          ariaLabel: `${node.kind}: ${nodeLabel(node)}`,
          ...(size ? { measured: size } : {}),
        }
      }),
    [model, results, running, selectedId],
  )

  const edges = useMemo<Edge[]>(
    () =>
      model.nodes.slice(1).map((node, i) => ({
        id: `e${i}`,
        source: model.nodes[i]?.id ?? '',
        target: node.id,
        focusable: false,
      })),
    [model],
  )

  // Keyboard focus follows an edit to the node it lands on, once the canvas
  // has drawn it: a node an edit adds appears only after the canvas re-derives
  // from the new text, so a pending request is tried again on each new set of
  // nodes. A request for a node already drawn (cancelling an add) changes no
  // nodes, so it is tried as it arrives too. (The first effect runs before the
  // second, so both see the request in the same pass.)
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    if (focusRequest) focusNext.current = focusRequest.id
  }, [focusRequest])
  useEffect(() => {
    const id = focusNext.current
    if (!id) return
    const element = container.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
    if (element) {
      element.focus()
      focusNext.current = null
    }
  }, [nodes, focusRequest])
  const land = useCallback(
    (id: string) => {
      focusNext.current = id
      onSelect(id)
    },
    [onSelect],
  )

  const actions = useMemo<CanvasActions>(
    () => ({
      editing,
      startEditing: setEditing,
      commitEdit: ({ node, index }, value) => {
        setEditing(null)
        const text = value?.trim()
        if (text === undefined || text === node.text) return land(node.id)
        // clearing a stage's text removes the stage
        if (text === '') {
          if (edits.remove(node.id, node.text)) land(`n${index - 1}`)
        } else {
          edits.replace(node.id, node.text, text)
          land(node.id)
        }
      },
      addAfter: ({ node, index }) => onAddAfter(node, index),
      remove: ({ node, index }) => {
        if (edits.remove(node.id, node.text)) land(`n${index - 1}`)
      },
    }),
    [editing, edits, land, onAddAfter],
  )

  // React Flow reports clicks and Enter on a focused node as select changes,
  // and measurements as dimension changes. Deselecting (clicking the pane) is
  // ignored, so some node is always shown.
  const onNodesChange = useCallback(
    (changes: NodeChange<StageNode>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) onSelect(change.id)
        if (change.type === 'dimensions' && change.dimensions) measured.current.set(change.id, change.dimensions)
      }
    },
    [onSelect],
  )

  // Undo and redo are the editor's (invariant 7), wherever focus is.
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) edits.redo()
      else edits.undo()
    } else if (mod && key === 'y') {
      e.preventDefault()
      edits.redo()
    } else if (e.key === 'F2' && selectedId && selectedId !== 'n0') {
      e.preventDefault()
      setEditing(selectedId)
    }
  }

  const { fitView } = useReactFlow()
  const count = nodes.length
  useEffect(() => {
    // after React Flow has measured the new nodes
    const frame = requestAnimationFrame(() => void fitView(FIT))
    return () => cancelAnimationFrame(frame)
  }, [count, fitView])

  return (
    <Actions.Provider value={actions}>
      <div ref={container} className="h-full w-full" onKeyDown={onKeyDown}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDoubleClick={(_, node) => node.data.index > 0 && setEditing(node.id)}
          colorMode="dark"
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          maxZoom={1.5}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </Actions.Provider>
  )
}

const tone: Record<Summary['tone'], string> = {
  ok: 'text-neutral-400',
  error: 'text-red-400',
  muted: 'text-neutral-400 italic',
}

const StageCard = memo(function StageCard({ data, selected }: NodeProps<StageNode>) {
  const actions = useContext(Actions)
  const { node, index, summary } = data
  const label = nodeLabel(node)
  const editing = actions?.editing === node.id
  const border = selected ? 'border-blue-400 ring-1 ring-blue-400' : 'border-neutral-600'
  return (
    <div
      className={`w-[180px] rounded-md border bg-neutral-900 px-3 py-2 ${border} ${
        node.kind === 'custom' ? 'border-dashed' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{node.kind}</div>
      {editing ? (
        <InlineInput label={`Edit ${label}`} initial={node.text} onDone={(v) => actions?.commitEdit(data, v)} />
      ) : (
        <div className="truncate font-mono text-xs text-neutral-100" title={node.text}>
          {label}
        </div>
      )}
      <div className={`mt-1 truncate font-mono text-[11px] ${tone[summary.tone]}`}>{summary.text}</div>

      {/* The actions live inside the card, below its text: nothing can cover
          the node, and Tab moves from the node straight to them. */}
      {selected && !editing && (
        <div className="mt-2 flex gap-1">
          {index > 0 && (
            <ToolButton label={`Edit ${label}`} onClick={() => actions?.startEditing(node.id)}>
              Edit
            </ToolButton>
          )}
          <ToolButton label={`Add a stage after ${label}`} onClick={() => actions?.addAfter(data)}>
            Add after
          </ToolButton>
          {index > 0 && (
            <ToolButton label={`Delete ${label}`} onClick={() => actions?.remove(data)}>
              Delete
            </ToolButton>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </div>
  )
})

const nodeTypes = { stage: StageCard }

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      // keys stay on the button: React Flow would otherwise take Enter as "select"
      onKeyDown={(e) => e.stopPropagation()}
      className="nodrag rounded border border-neutral-600 bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-100 hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
    >
      {children}
    </button>
  )
}

/**
 * A one-line editor for a stage's jq. Enter or leaving the field commits,
 * Escape cancels; `onDone` gets the text, or null when cancelled. Keys stay
 * here: Ctrl+Z undoes the field, not the document.
 */
function InlineInput({
  label,
  initial,
  onDone,
}: {
  label: string
  initial: string
  onDone: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      aria-label={label}
      autoFocus
      spellCheck={false}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(draft)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(draft)}
      className="nodrag nopan nowheel w-full rounded border border-blue-400 bg-neutral-950 px-1 font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-500"
    />
  )
}
