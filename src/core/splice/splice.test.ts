import { describe, expect, it } from 'vitest'
import type { ByteRange } from '../parse/model.ts'
import { sliceByteRange, splice } from './splice.ts'

/** Byte range of `needle` within `source` (UTF-8). */
function rangeOf(source: string, needle: string): ByteRange {
  const start = new TextEncoder().encode(source.slice(0, source.indexOf(needle))).length
  return { start, end: start + new TextEncoder().encode(needle).length }
}

describe('splice — round trip (invariant 2)', () => {
  const sources = [
    '.users | map(.name) | sort',
    '.a\n  | .b   # keep this comment\n  | .c',
    // multi-byte: byte offsets must not drift against UTF-16 indices
    '.café | map(.naïve) | select(.π > 3)',
  ]

  it.each(sources)('re-splicing a node with its own text is identity: %s', (source) => {
    const needle = source.split('|')[1]!.trim()
    const range = rangeOf(source, needle)
    const current = sliceByteRange(source, range)
    expect(splice(source, range, current)).toBe(source)
  })

  it('replaces only the targeted range', () => {
    const source = '.users | map(.name) | sort'
    const range = rangeOf(source, 'map(.name)')
    expect(splice(source, range, 'map(.email)')).toBe('.users | map(.email) | sort')
  })

  it('rejects out-of-bounds ranges rather than corrupting source', () => {
    expect(() => splice('.a', { start: 0, end: 99 }, 'x')).toThrow(RangeError)
  })
})
