import { describe, expect, it, vi } from 'vitest'
import { createCache, runPipeline, type PipelineNode, type StageOutput } from './cache.ts'

/** A deterministic stand-in for jq: output depends on both filter and input. */
const runFilter = vi.fn(
  async (filter: string, input: string): Promise<StageOutput> => ({ text: `${input} | ${filter}`, truncated: false }),
)

function sixNodes(): PipelineNode[] {
  return Array.from({ length: 6 }, (_, i) => ({ id: `n${i + 1}`, filter: `f${i + 1}` }))
}

const outputs = (r: Awaited<ReturnType<typeof runPipeline>>) =>
  r.results.map((x) => (x.status === 'ok' ? x.output.text : x.status))

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
    expect(outputs(result)).toEqual(['in | f1', 'in | f1 | f2'])
  })
})

describe('runPipeline — failures', () => {
  const failingAt = (bad: string) =>
    vi.fn(async (filter: string, input: string): Promise<StageOutput> => {
      if (filter === bad) throw new Error(`${filter} failed`)
      return { text: `${input} | ${filter}`, truncated: false }
    })

  it('keeps upstream results, reports the error, blocks downstream', async () => {
    const result = await runPipeline(sixNodes(), 'in', failingAt('f3'), createCache())
    expect(outputs(result)).toEqual(['in | f1', 'in | f1 | f2', 'error', 'blocked', 'blocked', 'blocked'])
    expect(result.ran).toEqual(['n1', 'n2', 'n3'])
  })

  it('caches errors, so editing downstream does not re-run a failing stage', async () => {
    const cache = createCache()
    const run = failingAt('f3')
    const nodes = sixNodes()
    await runPipeline(nodes, 'in', run, cache)
    run.mockClear()

    nodes[4] = { id: 'n5', filter: 'f5-edited' }
    const again = await runPipeline(nodes, 'in', run, cache)
    expect(run).not.toHaveBeenCalled()
    expect(outputs(again)[2]).toBe('error')
  })

  it('marks nodes computed from cut output as partial', async () => {
    const run = vi.fn(
      async (filter: string, input: string): Promise<StageOutput> => ({ text: `${input} | ${filter}`, truncated: filter === 'f2' }),
    )
    const result = await runPipeline(sixNodes().slice(0, 4), 'in', run, createCache())
    expect(result.results.map((r) => r.status === 'ok' && [r.output.truncated, r.partial])).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [false, true],
    ])
  })

  it('rejects when aborted mid-call, caching nothing from the abandoned call', async () => {
    const cache = createCache()
    const controller = new AbortController()
    const run = vi.fn(async (filter: string, input: string, signal?: AbortSignal): Promise<StageOutput> => {
      if (filter === 'f2') {
        controller.abort(new Error('superseded'))
        signal?.throwIfAborted()
      }
      return { text: `${input} | ${filter}`, truncated: false }
    })

    await expect(runPipeline(sixNodes(), 'in', run, cache, controller.signal)).rejects.toThrow('superseded')
    expect([...cache.keys()]).toEqual(['n1'])
  })
})
