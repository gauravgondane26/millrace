import { Language, Parser } from 'web-tree-sitter'
import type { GraphModel } from './model.ts'
import { project } from './project.ts'

export type ParseJq = (source: string) => GraphModel

type RuntimeOptions = Parameters<typeof Parser.init>[0]

let runtime: Promise<void> | null = null

/**
 * Loads the tree-sitter runtime and the jq grammar, returning a function from
 * source text to graph model. The caller supplies the grammar (a URL in the
 * browser, bytes in tests) and, in the browser, where the runtime's own wasm
 * lives, which keeps this module free of DOM or bundler assumptions.
 */
export async function loadJqParser(
  grammar: string | URL | Uint8Array,
  runtimeOptions?: RuntimeOptions,
): Promise<ParseJq> {
  runtime ??= Parser.init(runtimeOptions)
  await runtime
  const parser = new Parser()
  parser.setLanguage(await Language.load(grammar))

  return (source) => {
    const tree = parser.parse(source)
    if (!tree) throw new Error('tree-sitter produced no tree')
    // The tree lives in wasm memory; project() copies out everything it keeps.
    try {
      return project(tree, source)
    } finally {
      tree.delete()
    }
  }
}
