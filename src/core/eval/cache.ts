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
 */

export interface PipelineNode {
  id: string
  /** The single jq filter for this stage (not the accumulated prefix). */
  filter: string
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

/** One node's preview: its output, its own error, or blocked by an earlier one. */
export type NodeResult =
  | {
      status: 'ok'
      output: StageOutput
      /** Computed from input that was cut upstream, so it may be incomplete. */
      partial: boolean
    }
  | { status: 'error'; error: unknown }
  | { status: 'blocked' }

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
  /** One result per node, in order. */
  results: NodeResult[]
  /** Ids of nodes that were actually recomputed this run (cache misses). */
  ran: string[]
}

/**
 * Evaluate the pipeline, reusing cached node results where neither the node's
 * filter nor its input changed. Mutates `cache` in place with fresh entries.
 *
 * A failing node keeps its error and blocks everything after it. Errors are
 * cached like outputs, so a stage that times out isn't re-run on every edit
 * elsewhere. If `signal` aborts, this rejects with the abort reason and
 * caches nothing from the abandoned call.
 */
export async function runPipeline(
  nodes: readonly PipelineNode[],
  input: string,
  runFilter: RunFilter,
  cache: PipelineCache,
  signal?: AbortSignal,
): Promise<RunResult> {
  const results: NodeResult[] = []
  const ran: string[] = []
  let current: string | null = input
  let partial = false

  for (const node of nodes) {
    if (current === null) {
      results.push({ status: 'blocked' })
      continue
    }
    signal?.throwIfAborted()

    const filterHash = hashString(node.filter)
    const inputHash = hashString(current)
    const prev = cache.get(node.id)

    let result: Computed
    if (prev && prev.filterHash === filterHash && prev.inputHash === inputHash) {
      result = prev.result
    } else {
      try {
        result = { status: 'ok', output: await runFilter(node.filter, current, signal), partial: false }
      } catch (error) {
        signal?.throwIfAborted()
        result = { status: 'error', error }
      }
      cache.set(node.id, { filterHash, inputHash, result })
      ran.push(node.id)
    }

    if (result.status === 'ok') {
      results.push({ ...result, partial })
      partial ||= result.output.truncated
      current = result.output.text
    } else {
      results.push(result)
      current = null
    }
  }

  return { results, ran }
}
