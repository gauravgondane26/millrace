import { describe, expect, it, vi } from 'vitest'
import { createCache, runPipeline, type PipelineNode } from './cache.ts'

/** A deterministic stand-in for jq: output depends on both filter and input. */
const runFilter = vi.fn(async (filter: string, input: string) => `${input} | ${filter}`)

function sixNodes(): PipelineNode[] {
  return Array.from({ length: 6 }, (_, i) => ({ id: `n${i + 1}`, filter: `f${i + 1}` }))
}

describe('runPipeline — cache invalidation (invariant 3)', () => {
  it('editing node 3 of 6 recomputes 3..6 and leaves 1,2 cached', async () => {
    const cache = createCache()
    const nodes = sixNodes()

    const first = await runPipeline(nodes, '{"seed":true}', runFilter, cache)
    expect(first.ran).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])

    runFilter.mockClear()

    // edit node 3's filter; everything downstream sees a changed input
    nodes[2] = { id: 'n3', filter: 'f3-edited' }
    const second = await runPipeline(nodes, '{"seed":true}', runFilter, cache)

    expect(second.ran).toEqual(['n3', 'n4', 'n5', 'n6'])
    expect(runFilter).toHaveBeenCalledTimes(4)
  })

  it('a no-op re-run recomputes nothing', async () => {
    const cache = createCache()
    const nodes = sixNodes()
    await runPipeline(nodes, '1', runFilter, cache)

    const again = await runPipeline(nodes, '1', runFilter, cache)
    expect(again.ran).toEqual([])
  })

  it('changing the input recomputes from the top', async () => {
    const cache = createCache()
    const nodes = sixNodes()
    await runPipeline(nodes, '1', runFilter, cache)

    const again = await runPipeline(nodes, '2', runFilter, cache)
    expect(again.ran).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
  })

  it("feeds each node's output to the next node as is", async () => {
    const result = await runPipeline(sixNodes().slice(0, 2), 'in', runFilter, createCache())
    expect(result.outputs).toEqual(['in | f1', 'in | f1 | f2'])
  })
})
