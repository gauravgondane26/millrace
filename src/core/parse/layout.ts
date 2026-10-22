import { drawnLanes } from './graph.ts'
import type { GraphModel, GraphNode } from './model.ts'

/**
 * Where each node of the graph is drawn, as grid cells, and the links between
 * them. Derived from the model on every render and never stored (invariant 1),
 * so the canvas has no positions of its own to keep in sync.
 *
 * The top-level chain runs left to right along row 0. A construction's lanes
 * sit in the columns before it, one block of rows each, the first lane on the
 * construction's own row: so a pipeline with no constructions is one row, and
 * an array construction (a single lane) stays a straight line.
 */
export interface Cell {
  col: number
  row: number
}

export interface Link {
  source: string
  target: string
  /**
   * `fan-out` feeds a lane's first stage, `fan-in` carries a lane's result to
   * its construction, `next` joins two stages of one chain.
   */
  role: 'next' | 'fan-out' | 'fan-in'
}

export interface Layout {
  cells: Map<string, Cell>
  links: Link[]
}

export function layout(model: GraphModel): Layout {
  const cells = new Map<string, Cell>()
  const links: Link[] = []

  /** Lays out a chain fed by `from`; returns the columns and rows it spans. */
  const place = (chain: readonly GraphNode[], col: number, row: number, from: string | null, role: Link['role']) => {
    let c = col
    let height = 1
    let prev = from
    for (const node of chain) {
      const lanes = drawnLanes(node)
      if (lanes.length > 0) {
        let r = row
        let width = 0
        for (const lane of lanes) {
          const box = place(lane.nodes, c, r, prev, 'fan-out')
          if (box.last) links.push({ source: box.last, target: node.id, role: 'fan-in' })
          r += box.height
          width = Math.max(width, box.width)
        }
        height = Math.max(height, r - row)
        c += width
      } else if (prev !== null) {
        links.push({ source: prev, target: node.id, role })
      }
      cells.set(node.id, { col: c, row })
      c += 1
      prev = node.id
      role = 'next'
    }
    return { width: c - col, height, last: prev }
  }

  place(model.nodes, 0, 0, null, 'next')
  return { cells, links }
}
