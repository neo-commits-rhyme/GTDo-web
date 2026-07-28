import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
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
    command: 'npm run build && npx vite preview --port 5173 --strictPort',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
