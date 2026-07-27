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
    command: 'npm run dev -- --port 5173 --strictPort',
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
