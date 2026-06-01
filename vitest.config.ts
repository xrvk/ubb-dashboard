import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Default to `node` — most of the suite is pure logic and starts
    // ~3x faster without a jsdom window. Tests that need DOM opt in
    // with `// @vitest-environment jsdom` at the top of the file
    // (currently snapshot.test.ts and reportCache.test.ts).
    environment: 'node',
    globals: true,
    setupFiles: './src/__tests__/setup.ts',
    // Threads pool benchmarked faster than forks for this suite
    // (lower per-worker startup cost); revisit if file count grows
    // or tests start sharing module-level state across workers.
    pool: 'threads',
    // Suppress vitest's per-file progress output in non-TTY contexts
    // (CI logs) while keeping the default reporter locally.
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
})
