/**
 * Invariant 4: previews run against a sample of the input. Every array keeps
 * its first `limit` elements, at any depth (an API response is typically an
 * object wrapping one big array), and a multi-document input keeps its first
 * `limit` documents.
 *
 * Works on the text in one pass: it tracks only nesting, strings and escapes,
 * and copies what it keeps verbatim, so key order, number literals and
 * formatting stay as written and nothing is ever parsed into values. That
 * keeps it linear in the input and lets jq see only the sample. Text that
 * isn't well-formed comes back whole, for jq to report.
 */
export const SAMPLE_ITEMS = 200

export interface Sample {
  text: string
  /** Anything was cut. */
  sampled: boolean
}

interface Frame {
  array: boolean
  /** Elements seen so far (arrays only). */
  count: number
  /** Index of the latest comma at this level. */
  lastComma: number
  /** Where the cut begins once this array passes the limit; -1 until then. */
  cutFrom: number
}

const QUOTE = 0x22
const BACKSLASH = 0x5c
const COMMA = 0x2c
const COLON = 0x3a
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const BOM = 0xfeff

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
const endsScalar = (c: number) =>
  isSpace(c) || c === COMMA || c === COLON || c === OPEN_BRACKET || c === CLOSE_BRACKET ||
  c === OPEN_BRACE || c === CLOSE_BRACE || c === QUOTE

/** `limit` must be at least 1. */
export function sampleJson(text: string, limit = SAMPLE_ITEMS): Sample {
  const whole: Sample = { text, sampled: false }
  const stack: Frame[] = []
  const kept: string[] = []
  let copyFrom = 0
  /** Depth of the array being cut (its frame index + 1), 0 when none is. */
  let cutting = 0
  let documents = 0
  /** Just past the last complete top-level value. */
  let documentEnd = 0
  let i = text.charCodeAt(0) === BOM ? 1 : 0

  /** Count a value starting here; false means the document limit is hit. */
  const startValue = (): boolean => {
    const top = stack[stack.length - 1]
    if (!top) return ++documents <= limit
    if (top.array && cutting === 0 && ++top.count > limit) {
      cutting = stack.length
      top.cutFrom = top.lastComma // limit >= 1, so a comma precedes the first extra element
    }
    return true
  }
  const cutDocuments = (): Sample => {
    kept.push(text.slice(copyFrom, documentEnd))
    return { text: kept.join(''), sampled: true }
  }

  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (isSpace(c) || c === COLON) {
      i++
    } else if (c === QUOTE) {
      if (!startValue()) return cutDocuments()
      let j = i + 1
      while (j < text.length) {
        const d = text.charCodeAt(j)
        if (d === BACKSLASH) j += 2
        else if (d === QUOTE) break
        else j++
      }
      if (j >= text.length) return whole // unterminated string
      i = j + 1
      if (stack.length === 0) documentEnd = i
    } else if (c === OPEN_BRACKET || c === OPEN_BRACE) {
      if (!startValue()) return cutDocuments()
      stack.push({ array: c === OPEN_BRACKET, count: 0, lastComma: -1, cutFrom: -1 })
      i++
    } else if (c === CLOSE_BRACKET || c === CLOSE_BRACE) {
      const frame = stack.pop()
      if (!frame || frame.array !== (c === CLOSE_BRACKET)) return whole
      if (cutting === stack.length + 1) {
        // drop from the comma before the first extra element up to this bracket
        kept.push(text.slice(copyFrom, frame.cutFrom))
        copyFrom = i
        cutting = 0
      }
      i++
      if (stack.length === 0) documentEnd = i
    } else if (c === COMMA) {
      const top = stack[stack.length - 1]
      if (!top) return whole
      top.lastComma = i
      i++
    } else {
      // a scalar: number, true, false, null (or whatever jq makes of it)
      if (!startValue()) return cutDocuments()
      let j = i + 1
      while (j < text.length && !endsScalar(text.charCodeAt(j))) j++
      i = j
      if (stack.length === 0) documentEnd = i
    }
  }

  if (stack.length > 0) return whole // unterminated container
  if (kept.length === 0) return whole
  kept.push(text.slice(copyFrom))
  return { text: kept.join(''), sampled: true }
}
