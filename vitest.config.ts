import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // core/ and storage/ are pure and run in node; only the React layer needs a DOM.
    environmentMatchGlobs: [['src/app/**', 'jsdom']],
  },
})
