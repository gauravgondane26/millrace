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

/**
 * Runs one filter over an input stream. The real impl is the workered jq RPC.
 * Streams are JSON text, one compact value per line (see worker/engine.ts), so a
 * node's output is the next node's input as is.
 */
export type RunFilter = (filter: string, input: string) => Promise<string>

interface CacheEntry {
  filterHash: number
  inputHash: number
  output: string
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
  /** Preview output for each node, in order. */
  outputs: string[]
  /** Ids of nodes that were actually recomputed this run (cache misses). */
  ran: string[]
}

/**
 * Evaluate the pipeline, reusing cached node outputs where neither the node's
 * filter nor its input changed. Mutates `cache` in place with fresh entries.
 */
export async function runPipeline(
  nodes: readonly PipelineNode[],
  input: string,
  runFilter: RunFilter,
  cache: PipelineCache,
): Promise<RunResult> {
  const outputs: string[] = []
  const ran: string[] = []
  let current = input

  for (const node of nodes) {
    const filterHash = hashString(node.filter)
    const inputHash = hashString(current)
    const prev = cache.get(node.id)

    let output: string
    if (prev && prev.filterHash === filterHash && prev.inputHash === inputHash) {
      output = prev.output
    } else {
      output = await runFilter(node.filter, current)
      cache.set(node.id, { filterHash, inputHash, output })
      ran.push(node.id)
    }

    outputs.push(output)
    current = output
  }

  return { outputs, ran }
}
