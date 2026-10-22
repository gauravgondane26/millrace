import type { Jq } from 'jq-wasm'

/**
 * The jq engine: jq 1.8.2 itself, compiled to WASM (the jq-wasm package), so
 * previews are what jq produces, not an approximation of it.
 *
 * Invariant 4: this runs inside the Web Worker (jq.worker.ts), never on the
 * main thread. Kept separate from the worker so tests can drive it in Node.
 *
 * JSON crosses the boundary as text both ways and is never parsed into JS
 * values: JSON.parse would move integer-like keys first and round big numbers.
 * Input is jq's input format, zero or more JSON values; output is one compact
 * value per line, which is valid input again, so a node's output feeds the next.
 */
export interface RunOutput {
  /** Compact JSON, one value per line, each followed by a newline. */
  text: string
  /** Output was cut at the limit; the filter produced more. */
  truncated: boolean
}

export interface JqApi {
  /**
   * Apply one jq filter to `input`, keeping at most about `maxOutput`
   * characters of output (cut at a value boundary). Rejects with an Error
   * named JqInputError, JqCompileError or JqRuntimeError.
   */
  run(filter: string, input: string, maxOutput: number): Promise<RunOutput>
  /** Pretty-print JSON text for display, as jq prints it. */
  format(text: string, indent: number): Promise<string>
}

export function createEngine(load: () => Promise<Jq>): JqApi {
  let jq: Promise<Jq> | null = null
  const engine = () => (jq ??= load())

  return {
    async run(filter, input, maxOutput) {
      const result = (await engine()).raw(input, filter, ['-c'])
      if (result.exitCode !== 0) throw toError(result.stderr, result.exitCode)
      // jq-wasm trims the final newline; every value ends with one here.
      const text = result.stdout === '' ? '' : `${result.stdout}\n`
      return truncate(text, maxOutput)
    },
    async format(text, indent) {
      const result = (await engine()).raw(text, '.', ['--indent', String(indent)])
      if (result.exitCode !== 0) throw toError(result.stderr, result.exitCode)
      return result.stdout
    },
  }
}

/**
 * jq buffers its whole output, so a long stream can't be stopped early; the
 * limit only bounds what a preview keeps. Cuts after the value that reaches it.
 */
function truncate(text: string, maxOutput: number): RunOutput {
  if (text.length <= maxOutput) return { text, truncated: false }
  const end = text.indexOf('\n', Math.max(0, maxOutput - 1))
  if (end === -1 || end === text.length - 1) return { text, truncated: false }
  return { text: text.slice(0, end + 1), truncated: true }
}

type EngineErrorName = 'JqInputError' | 'JqCompileError' | 'JqRuntimeError'

function named(name: EngineErrorName, message: string): Error {
  return Object.assign(new Error(message), { name })
}

/**
 * Exit codes don't say what went wrong (a compile error and `halt_error(3)`
 * both exit 3; bad input and a runtime error both exit 5), so read jq's
 * stderr. Debug output can precede the error, hence searching, not prefixes.
 */
export function toError(stderr: string, exitCode: number): Error {
  const text = stderr.trim()
  const countLine = /\n?jq: \d+ compile errors?$/
  if (countLine.test(text)) {
    return named('JqCompileError', text.replace(countLine, '').replace(/^jq: error: /gm, ''))
  }
  const parse = text.match(/jq: parse error: (.*)$/s)
  if (parse) return named('JqInputError', `input is not valid JSON: ${parse[1]}`)
  // "(at /dev/stdin:0)" says nothing to someone who pasted the input
  const runtime = text.match(/jq: error \(at [^)]*\):? ?(.*)$/s)
  if (runtime) return named('JqRuntimeError', runtime[1] ?? text)
  // halt_error writes its message raw
  return named('JqRuntimeError', text || `halted with exit code ${exitCode}`)
}
