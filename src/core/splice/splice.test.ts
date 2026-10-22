import { describe, expect, it } from 'vitest'
import type { TextRange } from '../parse/model.ts'
import { sliceRange, splice } from './splice.ts'

/** Range of `needle` within `source`, in UTF-16 offsets like the parser's. */
function rangeOf(source: string, needle: string): TextRange {
  const start = source.indexOf(needle)
  return { start, end: start + needle.length }
}

describe('splice — round trip (invariant 2)', () => {
  const sources = [
    '.users | map(.name) | sort',
    '.a\n  | .b   # keep this comment\n  | .c',
    // non-ASCII, incl. a surrogate pair: offsets must stay in UTF-16 units
    '.café | map(.naïve) | select(.π > 3) | "😀"',
  ]

  it.each(sources)('re-splicing a node with its own text is identity: %s', (source) => {
    const needle = source.split('|')[1]!.trim()
    const range = rangeOf(source, needle)
    const current = sliceRange(source, range)
    expect(splice(source, range, current)).toBe(source)
  })

  it('replaces only the targeted range', () => {
    const source = '.users | map(.name) | sort'
    const range = rangeOf(source, 'map(.name)')
    expect(splice(source, range, 'map(.email)')).toBe('.users | map(.email) | sort')
  })

  it('splices correctly after multi-byte characters', () => {
    // UTF-8 byte offsets would land 3 units late here (é: 2 bytes vs 1 unit,
    // 😀: 4 bytes vs 2 units)
    const source = '"é😀" | .x | .y'
    expect(splice(source, rangeOf(source, '.x'), '.z')).toBe('"é😀" | .z | .y')
  })

  it('rejects out-of-bounds ranges rather than corrupting source', () => {
    expect(() => splice('.a', { start: 0, end: 99 }, 'x')).toThrow(RangeError)
  })
})
