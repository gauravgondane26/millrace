import type { TextRange } from '../parse/model.ts'

/**
 * Invariant 2: graph edits are text splices, never regeneration.
 *
 * Ranges are UTF-16 offsets, the same unit the parser reports and CodeMirror
 * dispatches in (see TextRange), so this is plain string slicing.
 */

/** Replace the text in `range` of `source` with `replacement`. */
export function splice(source: string, range: TextRange, replacement: string): string {
  if (range.start < 0 || range.end > source.length || range.start > range.end) {
    throw new RangeError(
      `splice range [${range.start}, ${range.end}) out of bounds for length ${source.length}`,
    )
  }
  return source.slice(0, range.start) + replacement + source.slice(range.end)
}

/** The text currently occupying `range`. Round-trips with {@link splice}. */
export function sliceRange(source: string, range: TextRange): string {
  return source.slice(range.start, range.end)
}
