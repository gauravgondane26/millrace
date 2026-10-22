import { useEffect, useState } from 'react'
import runtimeUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import { loadJqParser, type ParseJq } from '../core/parse/parser.ts'

export type ParserState =
  | { status: 'loading' }
  | { status: 'ready'; parse: ParseJq }
  | { status: 'error'; message: string }

// One parser for the whole app, loaded on first use.
let shared: Promise<ParseJq> | null = null

function load(): Promise<ParseJq> {
  shared ??= loadJqParser(`${import.meta.env.BASE_URL}tree-sitter-jq.wasm`, {
    locateFile: () => runtimeUrl,
  })
  return shared
}

export function useJqParser(): ParserState {
  const [state, setState] = useState<ParserState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    load().then(
      (parse) => !cancelled && setState({ status: 'ready', parse }),
      (e: unknown) =>
        !cancelled && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
