import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests drive the production build, served by `vite preview` on
 * its own port: they check what would be deployed, worker and wasm bundling
 * included, and never touch a dev server running on 5173.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: 'list',
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
