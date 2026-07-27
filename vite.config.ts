import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A project Pages site serves from https://<user>.github.io/GTDo-web/, so every
// emitted asset URL has to carry that prefix. Verified in docs/assumptions.md.
export default defineConfig({
  base: '/GTDo-web/',
  plugins: [react()],
})
