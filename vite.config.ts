import path from 'node:path'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Redirects the old `/ind-ulb-dashboard/*` base path (from before the
// ULB → UBB rename) to `/ubb-dashboard/*` in the dev server. Preserves
// the query string. Harmless for new visitors; saves anyone with a
// stale bookmark from the "did you mean…" error page.
function legacyBasePathRedirect(): Plugin {
  return {
    name: 'legacy-base-path-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
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

// Dev-only endpoint that exposes additional `.env.*.local` profiles
// (e.g. `.env.acme.local`, `.env.contoso.local`) so the UI can offer a
// quick-switch between several local test enterprises. Files are read
// from disk on each request — no secrets are baked into the bundle.
// `apply: 'serve'` ensures this plugin is never active during `vite
// build`, so production artifacts can't accidentally ship secrets.
function devProfiles(): Plugin {
  return {
    name: 'dev-profiles',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev_profiles', (_req, res) => {
        const root = server.config.root
        let profiles: Array<{ name: string; url: string; token: string }> = []
        try {
          const entries = fs.readdirSync(root)
          for (const f of entries) {
            // Only scan `.env.<name>.local` where <name> is non-empty
            // and not "example" or another reserved word. Skip the
            // plain `.env.local` since it's already auto-connected.
            const m = f.match(/^\.env\.([^.]+(?:\.[^.]+)*)\.local$/)
            if (!m) continue
            const name = m[1]
            if (!name || name === 'example') continue
            const full = path.join(root, f)
            // Follow symlinks (the repo uses one for the shared .env.local).
            let content: string
            try {
              content = fs.readFileSync(full, 'utf8')
            } catch {
              continue
            }
            const url = content.match(/^VITE_DEV_ENTERPRISE_URL=(.+)$/m)?.[1]?.trim()
            const token = content.match(/^VITE_DEV_PAT=(.+)$/m)?.[1]?.trim()
            if (!url || !token) continue
            profiles.push({ name, url, token })
          }
          profiles = profiles.sort((a, b) => a.name.localeCompare(b.name))
        } catch {
          // Surface as an empty list rather than failing the dashboard.
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(profiles))
      })
    },
  }
}

export default defineConfig({
  base: '/ubb-dashboard-org/',
  plugins: [react(), tailwindcss(), legacyBasePathRedirect(), devProfiles()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5003,
  },
})
