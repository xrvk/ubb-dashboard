import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Redirects the old `/ind-ulb-dashboard/*` base path (from before the
// ULB → UBB rename) to `/ubb-dashboard/*` in the dev server. Preserves
// the query string. Harmless for new visitors; saves anyone with a
// stale bookmark from the "did you mean…" error page.
function legacyBasePathRedirect() {
  return {
    name: 'legacy-base-path-redirect',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use((req: { url?: string }, res: { writeHead: (s: number, h: Record<string, string>) => void; end: () => void }, next: () => void) => {
        const url = req.url ?? ''
        if (url === '/ind-ulb-dashboard' || url.startsWith('/ind-ulb-dashboard/') || url.startsWith('/ind-ulb-dashboard?')) {
          const target = url.replace('/ind-ulb-dashboard', '/ubb-dashboard')
          res.writeHead(301, { Location: target })
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/ubb-dashboard/',
  plugins: [react(), tailwindcss(), legacyBasePathRedirect()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5003,
  },
})
