import { useEffect, useRef, useState } from 'react'
import { createCache, runPipeline, type NodeResult, type PipelineNode } from '../core/eval/cache.ts'
import { SAMPLE_ITEMS, type Sample } from '../core/eval/sample.ts'
import type { GraphModel, GraphNode } from '../core/parse/model.ts'
import { runFilterInWorker, sampleInWorker } from '../worker/client.ts'

export interface Previews {
  /** The sample previews run on; null while there is no input. */
  sample: Sample | null
  /** One result per graph node, by id; null until a run completes. */
  results: ReadonlyMap<string, NodeResult> | null
  /** A run is in flight; `results` may still be the previous run's. */
  running: boolean
}

/**
 * Per-node previews (invariant 3) on a sample of the input (invariant 4).
 *
 * The input is sampled in the worker once per input change, so the main thread
 * never scans it and jq never sees more than the sample. The source node runs
 * as identity, which makes the input itself node 0's preview and puts invalid
 * input on the node it belongs to. A newer edit abandons the run in flight.
 */
export function usePreviews(model: GraphModel | null, input: string): Previews {
  const [sample, setSample] = useState<Sample | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, NodeResult> | null>(null)
  const [running, setRunning] = useState(false)
  const cache = useRef(createCache())

  useEffect(() => {
    if (input.trim() === '') {
      setSample(null)
      return
    }
    const controller = new AbortController()
    sampleInWorker(input, SAMPLE_ITEMS, controller.signal).then(setSample, () => {
      // the sampler itself never fails; if the engine did, preview the whole input
      if (!controller.signal.aborted) setSample({ text: input, sampled: false })
    })
    return () => controller.abort()
  }, [input])

  useEffect(() => {
    if (!model || !sample) {
      setResults(null)
      setRunning(false)
      return
    }
    const controller = new AbortController()
    const stages = model.nodes.map(toStage)
    setRunning(true)
    runPipeline(stages, sample.text, runFilterInWorker, cache.current, controller.signal).then(
      (run) => {
        setResults(run.results)
        setRunning(false)
      },
      () => {}, // abandoned for a newer run
    )
    return () => controller.abort()
  }, [model, sample])

  return { sample, results, running }
}

/** A node as the runner sees it; the source node runs as identity. */
function toStage(node: GraphNode): PipelineNode {
  const filter = node.kind === 'source' ? '.' : node.text
  const lanes = node.construct?.lanes.map((lane) => lane.nodes.map(toStage))
  return lanes ? { id: node.id, filter, lanes } : { id: node.id, filter }
}
