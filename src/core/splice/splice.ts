import type { ByteRange } from '../parse/model.ts'

/**
 * Invariant 2: graph edits are text splices, never regeneration.
 *
 * tree-sitter reports UTF-8 *byte* offsets, while JS strings are indexed by
 * UTF-16 code units. For any source containing multi-byte characters those two
 * disagree, so we splice in the byte domain and decode back. A pure ASCII
 * source makes this a no-op, but getting it right here is what keeps the
 * round-trip test byte-identical on real-world input.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Replace the bytes in `range` of `source` with `replacement`. */
export function splice(source: string, range: ByteRange, replacement: string): string {
  const bytes = encoder.encode(source)
  if (range.start < 0 || range.end > bytes.length || range.start > range.end) {
    throw new RangeError(
      `splice range [${range.start}, ${range.end}) out of bounds for ${bytes.length} bytes`,
    )
  }
  const head = bytes.subarray(0, range.start)
  const tail = bytes.subarray(range.end)
  const mid = encoder.encode(replacement)

  const out = new Uint8Array(head.length + mid.length + tail.length)
  out.set(head, 0)
  out.set(mid, head.length)
  out.set(tail, head.length + mid.length)
  return decoder.decode(out)
}

/** The text currently occupying `range`. Round-trips with {@link splice}. */
export function sliceByteRange(source: string, range: ByteRange): string {
  const bytes = encoder.encode(source)
  return decoder.decode(bytes.subarray(range.start, range.end))
}
