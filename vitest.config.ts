import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/__tests__/setup.ts',
    // Threads pool is faster than the default forks pool for this
    // small jsdom suite (lower per-worker startup cost).
    pool: 'threads',
    // Suppress vitest's per-file progress output in non-TTY contexts
    // (CI logs) while keeping the default reporter locally.
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
})
