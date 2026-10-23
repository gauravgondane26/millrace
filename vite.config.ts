/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { licenseNotices, workerLicenses } from './scripts/license-notices.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), licenseNotices()],
  // web-tree-sitter and jq-wasm ship .wasm; keep them out of the dependency
  // pre-bundle so they can locate their wasm at runtime.
  optimizeDeps: {
    exclude: ['web-tree-sitter', 'jq-wasm'],
  },
  worker: {
    format: 'es',
    plugins: () => [workerLicenses()],
  },
  build: {
    rollupOptions: {
      output: {
        // the big libraries in chunks of their own: they download in
        // parallel, and an app change doesn't invalidate their cache
        // (module ids use forward slashes on every platform)
        manualChunks(id) {
          const pkg = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1]
          if (!pkg) return undefined
          if (pkg.startsWith('@xyflow/') || pkg.startsWith('d3-') || pkg === 'classcat') return 'react-flow'
          if (pkg.startsWith('@codemirror/') || pkg.startsWith('@lezer/')) return 'codemirror'
          if (['style-mod', 'w3c-keyname', 'crelt'].includes(pkg)) return 'codemirror'
          if (['react', 'react-dom', 'scheduler'].includes(pkg)) return 'react'
          if (pkg === 'web-tree-sitter') return 'tree-sitter'
          return undefined
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // core logic is the correctness surface; keep its coverage visible
    coverage: {
      include: ['src/core/**'],
    },
  },
})
