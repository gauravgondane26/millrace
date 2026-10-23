/**
 * Invariant 3: node k's preview is `filter_k` applied to node k-1's cached
 * output — one filter invocation per node, never the re-run prefix
 * `f1 | f2 | ... | fk`.
 *
 * Dirtiness falls out of the cache key rather than being tracked by hand: a
 * node recomputes iff its filter text changed OR the output of the node above
 * it changed. Editing node k therefore recomputes k and everything downstream,
 * while the untouched upstream entries are served straight from cache.
 *
 * Cache key = hash(filter text) + hash(input) (CLAUDE.md invariant 3).
 *
 * A construction fans out: each of its lanes runs on the construction's own
 * input (the output of the stage before it), stage by stage like any chain,
 * and the construction then runs once on that same input. Its filter is the
 * whole construction text, so its cache key covers every lane: editing a lane
 * stage recomputes that stage, the rest of its lane, the construction and
 * everything after it, and nothing in the other lanes.
 */

export interface PipelineNode {
  id: string
  /** The single jq filter for this stage (not the accumulated prefix). */
  filter: string
  /**
   * A construction's lanes: pipe chains that each run on this node's own
   * input, before this node does. The node's filter is the whole
   * construction, so it computes the constructed value itself, in one call.
   */
  lanes?: readonly (readonly PipelineNode[])[]
}

/** What one filter produced. */
export interface StageOutput {
  /** JSON text, one compact value per line (see worker/engine.ts). */
  text: string
  /** The engine kept only part of the output. */
  truncated: boolean
}

/**
 * Runs one filter over an input stream. The real impl is the workered jq RPC.
 * A node's output text is the next node's input as is. Aborting `signal`
 * abandons the call.
 */
export type RunFilter = (filter: string, input: string, signal?: AbortSignal) => Promise<StageOutput>

/** One node's preview: its output, its own error, or blocked by another's. */
export type NodeResult =
  | {
      status: 'ok'
      output: StageOutput
      /** Computed from input that was cut upstream, so it may be incomplete. */
      partial: boolean
    }
  /** `filter` is the text that failed, which locates a compile error in it. */
  | { status: 'error'; error: unknown; filter: string }
  /** `by` is the id of the node whose error stopped this one. */
  | { status: 'blocked'; by: string }

/** A computed result; blocked nodes are never computed, so never cached. */
type Computed = Exclude<NodeResult, { status: 'blocked' }>

interface CacheEntry {
  filterHash: number
  inputHash: number
  result: Computed
}

export type PipelineCache = Map<string, CacheEntry>

export function createCache(): PipelineCache {
  return new Map()
}

/** FNV-1a, 32-bit. Cheap and stable; not cryptographic. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface RunResult {
  /** One result per node, by id, in the order they ran (`flatten` order). */
  results: Map<string, NodeResult>
  /** Ids of nodes that were actually recomputed this run (cache misses). */
  ran: string[]
}

/** What flows down a chain: a node's output, or the id of the node that failed. */
type Flow = { text: string; partial: boolean } | { failed: string }

/**
 * Evaluate the pipeline, reusing cached node results where neither the node's
 * filter nor its input changed. Mutates `cache` in place with fresh entries.
 *
 * A failing node keeps its error and blocks everything after it, and a
 * construction any of whose lanes failed is blocked by that failure: the
 * error shows where it happened. Errors are cached like outputs, so a stage
 * that times out isn't re-run on every edit elsewhere. If `signal` aborts,
 * this rejects with the abort reason and caches nothing from the abandoned
 * call.
 *
 * `onResult` hears each node's result as it is settled, in the order of
 * `results`, so a caller can show the fast stages before a slow one ends.
 */
export async function runPipeline(
  nodes: readonly PipelineNode[],
  input: string,
  runFilter: RunFilter,
  cache: PipelineCache,
  signal?: AbortSignal,
  onResult?: (id: string, result: NodeResult) => void,
): Promise<RunResult> {
  const results = new Map<string, NodeResult>()
  const ran: string[] = []
  const settle = (id: string, result: NodeResult) => {
    results.set(id, result)
    onResult?.(id, result)
  }

  const runChain = async (chain: readonly PipelineNode[], from: Flow): Promise<Flow> => {
    let flow = from
    for (const node of chain) {
      let laneFailure: string | null = null
      for (const lane of node.lanes ?? []) {
        const out = await runChain(lane, flow)
        if ('failed' in out) laneFailure ??= out.failed
      }
      if ('failed' in flow) {
        settle(node.id, { status: 'blocked', by: flow.failed })
        continue
      }
      if (laneFailure !== null) {
        settle(node.id, { status: 'blocked', by: laneFailure })
        flow = { failed: laneFailure }
        continue
      }
      signal?.throwIfAborted()

      const filterHash = hashString(node.filter)
      const inputHash = hashString(flow.text)
      const prev = cache.get(node.id)

      let result: Computed
      if (prev && prev.filterHash === filterHash && prev.inputHash === inputHash) {
        result = prev.result
      } else {
        try {
          result = { status: 'ok', output: await runFilter(node.filter, flow.text, signal), partial: false }
        } catch (error) {
          signal?.throwIfAborted()
          result = { status: 'error', error, filter: node.filter }
        }
        cache.set(node.id, { filterHash, inputHash, result })
        ran.push(node.id)
      }

      if (result.status === 'ok') {
        settle(node.id, { ...result, partial: flow.partial })
        flow = { text: result.output.text, partial: flow.partial || result.output.truncated }
      } else {
        settle(node.id, result)
        flow = { failed: node.id }
      }
    }
    return flow
  }

  await runChain(nodes, { text: input, partial: false })
  return { results, ran }
}
