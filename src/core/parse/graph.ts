import type { GraphModel, GraphNode, Lane } from './model.ts'

/**
 * Walking the graph model: it is a tree of pipe chains (the top-level chain,
 * and each construction's lanes), drawn as a DAG.
 */

/**
 * Every node, depth first, each construction after its lanes: the order
 * previews run in, every node after the nodes it depends on.
 */
export function flatten(model: GraphModel): GraphNode[] {
  const out: GraphNode[] = []
  const walk = (chain: readonly GraphNode[]) => {
    for (const node of chain) {
      for (const lane of node.construct?.lanes ?? []) walk(lane.nodes)
      out.push(node)
    }
  }
  walk(model.nodes)
  return out
}

/** Where a node sits: its chain, its place in it, and the lane (if any). */
export interface Located {
  node: GraphNode
  chain: readonly GraphNode[]
  index: number
  /** The lane the chain is; null for the top-level chain. */
  lane: Lane | null
}

export function locate(model: GraphModel, id: string): Located | null {
  const search = (chain: readonly GraphNode[], lane: Lane | null): Located | null => {
    for (const [index, node] of chain.entries()) {
      if (node.id === id) return { node, chain, index, lane }
      for (const inner of node.construct?.lanes ?? []) {
        const found = search(inner.nodes, inner)
        if (found) return found
      }
    }
    return null
  }
  return search(model.nodes, null)
}

/** The id of the stage at `index` in the same chain as `id` (ids are positional). */
export const siblingId = (id: string, index: number): string => id.replace(/\d+$/, String(index))

/** A node's place in its chain, read from its id. */
export const chainIndex = (id: string): number => Number(/\d+$/.exec(id)?.[0] ?? 0)

/**
 * The lanes a construction draws: a shorthand entry (`{name}`) has no stages
 * to draw, so its value shows only in the construction's own preview.
 */
export const drawnLanes = (node: GraphNode): Lane[] => node.construct?.lanes.filter((l) => l.nodes.length > 0) ?? []
