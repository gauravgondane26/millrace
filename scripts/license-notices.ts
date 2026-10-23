import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OutputBundle } from 'rollup'
import type { Plugin } from 'vite'

/**
 * Third-party notices, written to `licenses.txt` beside the built app.
 *
 * Lists every npm package with code in the built bundles (the app's chunks
 * and the jq worker's, which Vite builds separately), each with the license
 * text it ships, then the software compiled into the two wasm modules, which
 * no package.json describes: jq and what it links (decNumber, Oniguruma), and
 * Emscripten's runtime. Those texts live in `licenses/`, taken from each
 * project's repository at the version used.
 */

/** Package name -> its directory, from both builds (the worker's runs first). */
const packages = new Map<string, string>()

/** Software in the wasm modules: a title and a file in licenses/ or public/. */
const COMPILED_IN = [
  { title: 'jq 1.8.2 (MIT), with decNumber (ICU license), compiled to WASM in jq-wasm', file: 'licenses/jq.txt' },
  { title: 'Oniguruma, the regex library jq links (BSD-2-Clause)', file: 'licenses/oniguruma.txt' },
  {
    title: 'Emscripten (MIT / University of Illinois NCSA), whose runtime is compiled into jq-wasm and web-tree-sitter',
    file: 'licenses/emscripten.txt',
  },
  { title: 'tree-sitter-jq, the jq grammar (BSD-3-Clause)', file: 'public/tree-sitter-jq.LICENSE.txt' },
]

function record(bundle: OutputBundle): void {
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue
    for (const [id, module] of Object.entries(output.modules)) {
      if (module.renderedLength === 0) continue // tree-shaken away
      const path = id.replace(/\\/g, '/')
      const match = /^(?:\0)?(.*\/node_modules\/((?:@[^/]+\/)?[^/?]+))\//.exec(path)
      if (match?.[1] && match[2]) packages.set(match[2], match[1])
    }
  }
}

function notice(name: string, dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string; license?: string }
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f))
  const texts = files.map((f) => readFileSync(join(dir, f), 'utf8').trim())
  const body = texts.length > 0 ? texts.join('\n\n') : `(No license file in the package; its package.json says ${pkg.license ?? 'nothing'}.)`
  return `${name} ${pkg.version ?? ''} (${pkg.license ?? 'license not stated'})\n\n${body}`
}

function render(root: string): string {
  const rule = `\n\n${'-'.repeat(78)}\n\n`
  const npm = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => notice(name, dir))
  const compiled = COMPILED_IN.map(({ title, file }) => `${title}\n\n${readFileSync(join(root, file), 'utf8').trim()}`)
  return [
    'millrace: third-party notices\n\nmillrace includes the following software, under the licenses below.',
    ...npm,
    ...compiled,
  ].join(rule).concat('\n')
}

/** Collects the packages in the jq worker's bundle; goes in `worker.plugins`. */
export function workerLicenses(): Plugin {
  return { name: 'millrace:worker-licenses', apply: 'build', generateBundle: (_, bundle) => record(bundle) }
}

/** Collects the app's packages and emits licenses.txt with every notice. */
export function licenseNotices(): Plugin {
  let root = process.cwd()
  return {
    name: 'millrace:license-notices',
    apply: 'build',
    configResolved: (config) => void (root = config.root),
    generateBundle(_, bundle) {
      record(bundle)
      // not a module in any chunk, but its base styles ship in the CSS
      packages.set('tailwindcss', join(root, 'node_modules', 'tailwindcss'))
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: render(root) })
    },
  }
}
