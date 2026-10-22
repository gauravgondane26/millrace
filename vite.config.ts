/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // web-tree-sitter and jq-wasm ship .wasm; keep them out of the dependency
  // pre-bundle so they can locate their wasm at runtime.
  optimizeDeps: {
    exclude: ['web-tree-sitter', 'jq-wasm'],
  },
  worker: {
    format: 'es',
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
