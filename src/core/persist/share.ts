import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

/**
 * Sharing a document as a URL fragment: the jq, and the input when it fits,
 * LZ-compressed into `#v1=…`. Nothing leaves the browser: the fragment is
 * never sent to a server.
 *
 * Both are carried as text, exactly as typed. The input is never parsed as
 * JSON here (see CLAUDE.md: JSON crosses the JS boundary as text); it rides
 * inside a JSON string, which round-trips any text unchanged.
 */
export interface SharedDocument {
  source: string
  /** Absent when the link carries the jq only. */
  input?: string
}

const PREFIX = 'v1='

/**
 * The longest fragment a link gets before the input is left out. Browsers
 * take far longer URLs, but chat apps and address bars mangle them sooner.
 */
export const MAX_FRAGMENT_LENGTH = 32_000

/**
 * lz-string shrinks JSON to roughly a fifth of its length here, so input more
 * than this many times the limit can't fit; it isn't compressed just to find
 * that out (compressing megabytes would freeze the page).
 */
const MAX_RATIO = 10

export function encodeShare(doc: SharedDocument): string {
  const payload = doc.input === undefined ? { s: doc.source } : { s: doc.source, i: doc.input }
  return PREFIX + compressToEncodedURIComponent(JSON.stringify(payload))
}

export interface ShareFragment {
  fragment: string
  /** There was input, but it was too big for the link, so only the jq went. */
  droppedInput: boolean
}

/** The fragment for a link to this document, without the `#`. */
export function shareFragment(source: string, input: string, max = MAX_FRAGMENT_LENGTH): ShareFragment {
  if (input.trim() === '') return { fragment: encodeShare({ source }), droppedInput: false }
  if (input.length <= max * MAX_RATIO) {
    const fragment = encodeShare({ source, input })
    if (fragment.length <= max) return { fragment, droppedInput: false }
  }
  return { fragment: encodeShare({ source }), droppedInput: true }
}

export type DecodedShare =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; doc: SharedDocument }

/**
 * Reads a location hash (with or without its `#`). `none`: not a share link
 * at all; `invalid`: it looks like one but can't be read (cut short when
 * pasted, say).
 */
export function decodeShare(hash: string): DecodedShare {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (!fragment.startsWith(PREFIX)) return { status: 'none' }
  const json = decompressFromEncodedURIComponent(fragment.slice(PREFIX.length))
  if (!json) return { status: 'invalid' }
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return { status: 'invalid' }
  }
  if (typeof payload !== 'object' || payload === null) return { status: 'invalid' }
  const { s, i } = payload as Record<string, unknown>
  if (typeof s !== 'string' || (i !== undefined && typeof i !== 'string')) return { status: 'invalid' }
  return { status: 'ok', doc: i === undefined ? { source: s } : { source: s, input: i } }
}
