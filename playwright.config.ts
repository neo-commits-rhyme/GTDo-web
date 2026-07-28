import { defineConfig, devices } from '@playwright/test'

// Deliberately not 5173: a dev server on the usual port would be reused, and
// the dev server does not serve the generated sw.js — so the offline tests
// would silently pass against the wrong thing, which is worse than failing.
const PORT = 5199
const BASE = `http://localhost:${PORT}/GTDo-web/`

export default defineConfig({
  testDir: '.',
  testMatch: ['probes/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: BASE, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Preview, not dev: the service worker only exists after a build, and the
    // offline test is meaningless without it.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
