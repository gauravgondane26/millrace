// Raises jq-wasm's memory cap from 256 MB to 1 GB. Runs on `npm install`
// (postinstall), so the dev server, the build and the Node tests all run
// the same jq.
//
// jq-wasm is jq 1.8.2 compiled with Emscripten, and the cap is two numbers:
// the maximum pages of the wasm module's memory, and `getHeapMax()` in its
// JavaScript glue. 256 MB holds inputs up to about 20 MB; 1 GB runs a 50 MB
// input (the quality bar) with room to spare. Nothing else in jq changes.
//
// jq-wasm is pinned exactly. If the version, or either number, isn't what
// this expects, it stops with an error rather than guess: check the new
// release's cap before changing EXPECTED_VERSION. Running it twice is fine.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const EXPECTED_VERSION = '3.0.0-jq-1.8.2'
const PAGE = 65536
const FROM_PAGES = 4096 // 256 MB
const TO_PAGES = 16384 // 1 GB

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('jq-wasm/package.json'))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (version !== EXPECTED_VERSION) fail(`jq-wasm is ${version}, this patch is for ${EXPECTED_VERSION}`)

const wasm = patchWasm(join(root, 'dist/build/jq.wasm'))
const glue = patchGlue(join(root, 'dist'))
console.log(`jq-wasm memory cap: ${wasm}; glue: ${glue}`)

function fail(message) {
  console.error(`patch-jq-wasm: ${message}`)
  process.exit(1)
}

/** Unsigned LEB128, as wasm writes integers. */
function leb(n) {
  const out = []
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n) byte |= 0x80
    out.push(byte)
  } while (n)
  return out
}

/** Rewrites the memory section's maximum. Returns what it did. */
function patchWasm(file) {
  const bytes = readFileSync(file)
  let p = 8 // magic and version
  const read = () => {
    let result = 0
    let shift = 0
    let byte
    do {
      byte = bytes[p++]
      result |= (byte & 0x7f) << shift
      shift += 7
    } while (byte & 0x80)
    return result >>> 0
  }
  const parts = [bytes.subarray(0, 8)]
  let outcome = null
  while (p < bytes.length) {
    const start = p
    const id = bytes[p++]
    const size = read()
    const end = p + size
    if (id === 5) {
      const count = read()
      const flags = read()
      const min = read()
      if (count !== 1 || !(flags & 1)) fail('expected one memory with a maximum')
      const max = read()
      if (max === TO_PAGES) return 'already 1 GB'
      if (max !== FROM_PAGES) fail(`expected a ${FROM_PAGES}-page maximum, found ${max}`)
      const section = Buffer.from([...leb(1), flags, ...leb(min), ...leb(TO_PAGES)])
      parts.push(Buffer.from([5, ...leb(section.length)]), section)
      outcome = `${(FROM_PAGES * PAGE) / 2 ** 20} MB -> ${(TO_PAGES * PAGE) / 2 ** 20} MB`
    } else {
      parts.push(bytes.subarray(start, end))
    }
    p = end
  }
  if (!outcome) fail('no memory section in jq.wasm')
  writeFileSync(file, Buffer.concat(parts))
  return outcome
}

/** Rewrites getHeapMax() in every glue file that has it. Returns what it did. */
function patchGlue(dir) {
  const from = `getHeapMax = () => ${FROM_PAGES * PAGE}`
  const to = `getHeapMax = () => ${TO_PAGES * PAGE}`
  let patched = 0
  let already = 0
  for (const name of readdirSync(dir).filter((f) => /\.(m?js|cjs)$/.test(f))) {
    const file = join(dir, name)
    const text = readFileSync(file, 'utf8')
    if (text.includes(to)) already++
    if (!text.includes(from)) continue
    writeFileSync(file, text.split(from).join(to))
    patched++
  }
  if (patched + already === 0) fail('no getHeapMax() in the jq-wasm glue')
  return patched > 0 ? `${patched} files patched` : 'already patched'
}
