import { describe, expect, it } from 'vitest'
import { compileErrors, describeCompileErrors, lineColumn } from './diagnose.ts'

// Messages as jq 1.8.2 prints them, after engine.ts drops "jq: error: " and
// the "N compile errors" line (captured from jq-wasm, which is pinned).
const at = (text: string, range: { start: number; end: number } | null) => (range ? text.slice(range.start, range.end) : null)

describe('compileErrors', () => {
  it('locates a syntax error in the stage text', () => {
    const filter = 'select(.x ==)'
    const [error, ...rest] = compileErrors(
      "syntax error, unexpected ')' at <top-level>, line 1, column 13:\n    select(.x ==)\n                ^",
      filter,
    )
    expect(rest).toEqual([])
    expect(error?.message).toBe("syntax error, unexpected ')'")
    expect(error?.range).toEqual({ start: 12, end: 13 })
  })

  it('takes the length from the carets', () => {
    const filter = '.a | error("x"; 1)'
    const [error] = compileErrors(
      'error/2 is not defined at <top-level>, line 1, column 6:\n    .a | error("x"; 1)\n         ^^^^^',
      filter,
    )
    expect(at(filter, error?.range ?? null)).toBe('error')
  })

  it('counts lines and UTF-8 byte columns', () => {
    const filter = '. as $x | \n\n  "é😀" + nosuch'
    // jq: line 3, byte column 14 (2 spaces, '"' 1, é 2, 😀 4, '"' 1, " + " 3, then 1-based)
    const [error] = compileErrors(
      'nosuch/0 is not defined at <top-level>, line 3, column 14:\n      "é😀" + nosuch\n                 ^^^^^^',
      filter,
    )
    expect(at(filter, error?.range ?? null)).toBe('nosuch')
  })

  it('reads every error, and drops the shell quoting hint', () => {
    const filter = 'if .\nthen 1\nelse 2'
    const errors = compileErrors(
      [
        "syntax error, unexpected end of file, expecting end or '|' or ',' at <top-level>, line 3, column 6:",
        '    else 2',
        '         ^',
        "Possibly unterminated 'if' statement at <top-level>, line 1, column 1:",
        '    if .',
        '    ^^^^',
      ].join('\n'),
      filter,
    )
    expect(errors.map((e) => [e.message, at(filter, e.range)])).toEqual([
      ["syntax error, unexpected end of file, expecting end or '|' or ','", '2'],
      ["Possibly unterminated 'if' statement", 'if .'],
    ])
    const [hint] = compileErrors(
      'syntax error, unexpected INVALID_CHARACTER (Unix shell quoting issues?) at <top-level>, line 1, column 6:\n    .a | `\n         ^',
      '.a | `',
    )
    expect(hint?.message).toBe('syntax error, unexpected INVALID_CHARACTER')
  })

  it('clamps a location past the end of the text', () => {
    const [error] = compileErrors(
      "syntax error, unexpected end of file, expecting '}' at <top-level>, line 4, column 9:\n    \n    ^",
      '{a: 1',
    )
    expect(error?.range).toEqual({ start: 5, end: 5 })
  })

  it('keeps errors jq names no place for', () => {
    expect(compileErrors('Top-level program not given (try ".")', '')).toEqual([
      { message: 'Top-level program not given (try ".")', range: null },
    ])
    expect(compileErrors('module not found: foo\n', 'import "foo" as f; .')).toEqual([
      { message: 'module not found: foo', range: null },
    ])
  })
})

describe('lineColumn', () => {
  it('is 1-based and counts characters, not code units', () => {
    expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 })
    expect(lineColumn('a\nbc', 3)).toEqual({ line: 2, column: 2 })
    expect(lineColumn('😀x', 2)).toEqual({ line: 1, column: 2 })
  })
})

describe('describeCompileErrors', () => {
  it('places a stage error at its line and column in the program', () => {
    const source = '.users\n  | select(.age ==)\n  | length'
    const stage = 'select(.age ==)'
    const offset = source.indexOf(stage)
    const errors = compileErrors(
      "syntax error, unexpected ')' at <top-level>, line 1, column 15:\n    select(.age ==)\n                  ^",
      stage,
    )
    expect(describeCompileErrors(errors, source, offset)).toBe(
      ["syntax error, unexpected ')' at line 2, column 19:", '      | select(.age ==)', '                      ^'].join('\n'),
    )
  })

  it('keeps carets under non-ASCII text and tabs', () => {
    const source = '\t"é😀" | nosuch'
    const errors = compileErrors(
      'nosuch/0 is not defined at <top-level>, line 1, column 13:\n    \t"é😀" | nosuch\n                ^^^^^^',
      source,
    )
    expect(describeCompileErrors(errors, source, 0)).toBe(
      ['nosuch/0 is not defined at line 1, column 9:', '     "é😀" | nosuch', '            ^^^^^^'].join('\n'),
    )
  })

  it('separates several errors, and keeps unlocated ones as they are', () => {
    const errors = [
      { message: 'module not found: foo', range: null },
      { message: '$y is not defined', range: { start: 0, end: 2 } },
    ]
    expect(describeCompileErrors(errors, '$y', 0)).toBe(
      'module not found: foo\n\n$y is not defined at line 1, column 1:\n    $y\n    ^^',
    )
  })
})
