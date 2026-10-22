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
import { memo, useCallback, useEffect, useMemo } from 'react'
import type { NodeResult } from '../core/eval/cache.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { nodeLabel, summarize, type Summary } from './summary.ts'

interface StageData extends Record<string, unknown> {
  node: GraphNode
  summary: Summary
}

type StageNode = Node<StageData, 'stage'>

interface Props {
  model: GraphModel
  results: NodeResult[] | null
  running: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The pipeline as a graph: one node per stage, left to right, each with a
 * one-line preview. Read-only for now (graph editing is Phase 5); selecting a
 * node, by click or keyboard, shows its full preview in the Output pane.
 *
 * Everything here is derived from the model and results on each render.
 * Positions come from the node index and are never stored, so the canvas holds
 * no second model of the pipeline (invariant 1).
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

function Canvas({ model, results, running, selectedId, onSelect }: Props) {
  const nodes = useMemo<StageNode[]>(
    () =>
      model.nodes.map((node, i) => ({
        id: node.id,
        type: 'stage',
        position: { x: i * SPACING, y: 0 },
        data: { node, summary: summarize(results?.[i], running) },
        selected: node.id === selectedId,
        ariaLabel: `${node.kind}: ${nodeLabel(node)}`,
      })),
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

  // Selection is the one interaction: React Flow reports clicks and Enter/Space
  // on a focused node as select changes. Deselecting (clicking the pane) is
  // ignored, so some node is always shown.
  const onNodesChange = useCallback(
    (changes: NodeChange<StageNode>[]) => {
      for (const change of changes) if (change.type === 'select' && change.selected) onSelect(change.id)
    },
    [onSelect],
  )

  const { fitView } = useReactFlow()
  const count = nodes.length
  useEffect(() => {
    // after React Flow has measured the new nodes
    const frame = requestAnimationFrame(() => void fitView(FIT))
    return () => cancelAnimationFrame(frame)
  }, [count, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      colorMode="dark"
      fitView
      fitViewOptions={FIT}
      minZoom={0.2}
      maxZoom={1.5}
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
  )
}

const tone: Record<Summary['tone'], string> = {
  ok: 'text-neutral-400',
  error: 'text-red-400',
  muted: 'text-neutral-400 italic',
}

const StageCard = memo(function StageCard({ data, selected }: NodeProps<StageNode>) {
  const { node, summary } = data
  const border = selected ? 'border-blue-400 ring-1 ring-blue-400' : 'border-neutral-600'
  return (
    <div
      className={`w-[180px] rounded-md border bg-neutral-900 px-3 py-2 ${border} ${
        node.kind === 'custom' ? 'border-dashed' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{node.kind}</div>
      <div className="truncate font-mono text-xs text-neutral-100" title={node.text}>
        {nodeLabel(node)}
      </div>
      <div className={`mt-1 truncate font-mono text-[11px] ${tone[summary.tone]}`}>{summary.text}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </div>
  )
})

const nodeTypes = { stage: StageCard }
