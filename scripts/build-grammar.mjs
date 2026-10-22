// Rebuilds public/tree-sitter-jq.wasm from flurie/tree-sitter-jq at a pinned
// commit. Run with `npm run build:grammar`; needs git and network access. The
// tree-sitter CLI downloads its own wasm toolchain (wasi-sdk) on first use.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = 'https://github.com/flurie/tree-sitter-jq.git'
const COMMIT = 'c204e36d2c3c6fce1f57950b12cabcc24e5cc4d9'

const cli = createRequire(import.meta.url).resolve('tree-sitter-cli/cli.js')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const dir = mkdtempSync(join(tmpdir(), 'tree-sitter-jq-'))
try {
  run('git', ['init', '-q', dir])
  run('git', ['-C', dir, 'fetch', '-q', '--depth', '1', REPO, COMMIT])
  run('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD'])
  // Compile the committed src/parser.c. Regenerating it (`tree-sitter generate`)
  // would execute the grammar's JavaScript, which this build never needs.
  run(process.execPath, [cli, 'build', '--wasm', dir, '-o', 'public/tree-sitter-jq.wasm'])
  // BSD-3-Clause: binary redistribution must carry the notice.
  copyFileSync(join(dir, 'LICENSE'), 'public/tree-sitter-jq.LICENSE.txt')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
