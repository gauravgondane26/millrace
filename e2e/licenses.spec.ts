import { expect, test } from '@playwright/test'
import { openApp } from './app.ts'

/** Third-party notices: written by the build, linked from the header. */
openApp()

test('the header links to notices for everything the app ships', async ({ page, request }) => {
  const link = page.getByRole('banner').getByRole('link', { name: 'Licenses' })
  const href = await link.getAttribute('href')
  expect(href).toBe('licenses.txt')
  const response = await request.get(`/${href}`)
  expect(response.ok()).toBe(true)
  const text = await response.text()
  // npm packages from the app's chunks and the worker's, the CSS, and what
  // is compiled into the wasm modules
  for (const heading of [
    /^react 18\.\S+ \(MIT\)$/m,
    /^@xyflow\/react \S+ \(MIT\)$/m,
    /^@codemirror\/view \S+ \(MIT\)$/m,
    /^web-tree-sitter \S+ \(MIT\)$/m,
    /^comlink \S+ \(Apache-2\.0\)$/m,
    /^jq-wasm \S+ \(MIT\)$/m,
    /^tailwindcss \S+ \(MIT\)$/m,
    /^jq 1\.8\.2 \(MIT\), with decNumber/m,
    /^Oniguruma, the regex library jq links/m,
    /^Emscripten /m,
    /^tree-sitter-jq, the jq grammar/m,
  ]) {
    expect(text).toMatch(heading)
  }
})
