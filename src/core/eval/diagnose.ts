import type { TextRange } from '../parse/model.ts'

/**
 * jq compile errors, mapped from the stage they came from to the program.
 *
 * Each stage is compiled on its own (invariant 3), so jq's line and column
 * count from the start of the stage's text, not the editor's. jq also counts
 * columns in UTF-8 bytes, while ranges here are UTF-16 (core/parse/model), and
 * its caret diagram lines up only for ASCII. So the location is parsed out of
 * jq's message, converted, shifted by the stage's offset, and the diagram is
 * drawn again from the program's own line.
 */

/** One error jq reported, located in the text it compiled. */
export interface CompileError {
  /** jq's message without its location: `syntax error, unexpected ')'`. */
  message: string
  /** Where it points, in the compiled text; null when jq named no place. */
  range: TextRange | null
}

/** "<message> at <top-level>, line L, column C:" (engine.ts drops "jq: error: "). */
const HEADER = /^(.*) at <top-level>, line (\d+), column (\d+):$/

/**
 * jq adds this to any unexpected character, guessing the filter came through
 * a shell. Here it never does.
 */
const SHELL_HINT = ' (Unix shell quoting issues?)'

/**
 * Parse a compile error message (as engine.ts names it, JqCompileError) for
 * the filter it came from. Each error's header is followed by the line it
 * points into and a caret line, whose carets give the length.
 */
export function compileErrors(message: string, filter: string): CompileError[] {
  const errors: CompileError[] = []
  const lines = message.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i] ?? '')
    if (!header) {
      // text outside any located error (jq names no place for a few)
      const text = (lines[i] ?? '').trim()
      if (text !== '' && !isDiagram(lines, i)) errors.push({ message: clean(text), range: null })
      continue
    }
    const carets = /\^+/.exec(lines[i + 2] ?? '')
    const line = Number(header[2])
    const column = Number(header[3])
    errors.push({
      message: clean(header[1] ?? ''),
      range: locate(filter, line, column, carets?.[0].length ?? 1),
    })
  }
  return errors
}

/** The excerpt and caret lines under a header. */
function isDiagram(lines: readonly string[], i: number): boolean {
  return HEADER.test(lines[i - 1] ?? '') || HEADER.test(lines[i - 2] ?? '')
}

const clean = (message: string) => message.replace(SHELL_HINT, '')

/**
 * jq's 1-based line and byte column, and the caret count (bytes), as a
 * UTF-16 range in `text`. Clamped to the line: an error at the end of the
 * input can point past it.
 */
function locate(text: string, line: number, column: number, bytes: number): TextRange {
  let lineStart = 0
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', lineStart)
    if (next === -1) return { start: text.length, end: text.length }
    lineStart = next + 1
  }
  const newline = text.indexOf('\n', lineStart)
  const lineEnd = newline === -1 ? text.length : newline
  const start = advance(text, lineStart, lineEnd, column - 1)
  const end = advance(text, start, lineEnd, bytes)
  return { start, end }
}

/** The UTF-16 index `bytes` UTF-8 bytes after `from`, stopping at `limit`. */
function advance(text: string, from: number, limit: number, bytes: number): number {
  let i = from
  let left = bytes
  while (left > 0 && i < limit) {
    const code = text.codePointAt(i) ?? 0
    left -= code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    i += code > 0xffff ? 2 : 1
  }
  return i
}

/** Shift a range found in a stage's text to where the stage sits. */
export const shift = (range: TextRange, by: number): TextRange => ({ start: range.start + by, end: range.end + by })

/** 1-based line and column of `offset`, counting characters, as a reader would. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    lineStart = i + 1
  }
  return { line, column: [...text.slice(lineStart, offset)].length + 1 }
}

/**
 * Compile errors as jq would print them, but placed in the program: each
 * message with the editor's line and column, the program's line, and carets
 * under the range (to the end of the line, if it runs on). `offset` is where
 * the compiled text starts in `source`.
 */
export function describeCompileErrors(errors: readonly CompileError[], source: string, offset: number): string {
  return errors
    .map(({ message, range }) => {
      if (!range) return message
      const { start, end } = shift(range, offset)
      const { line, column } = lineColumn(source, start)
      const lineStart = source.lastIndexOf('\n', start - 1) + 1
      const newline = source.indexOf('\n', start)
      const lineEnd = newline === -1 ? source.length : newline
      // tabs as one space each, so the carets stay under the text
      const excerpt = source.slice(lineStart, lineEnd).replace(/\r$/, '').replace(/\t/g, ' ')
      const width = Math.max(1, [...source.slice(start, Math.min(end, lineEnd))].length)
      return `${message} at line ${line}, column ${column}:\n    ${excerpt}\n    ${' '.repeat(column - 1)}${'^'.repeat(width)}`
    })
    .join('\n\n')
}
