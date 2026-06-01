import { useState } from 'react'
import { Plug } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export function ImportPanel() {
  const { credentials, connect, loading, error } = useCredentials()
  // Pre-fill the URL from `.env.local` for developer convenience. Gated on
  // `import.meta.env.DEV` so the bundler tree-shakes the env read away in
  // production builds — without this guard, the bundle inlines the dev
  // enterprise URL into the shipped JS.
  const defaultUrl = import.meta.env.DEV
    ? ((import.meta.env.VITE_DEV_ENTERPRISE_URL as string | undefined) ?? '')
    : ''
  const [url, setUrl] = useState(defaultUrl)
  const [token, setToken] = useState('')

  if (credentials) {
    // When connected, the compact status chip lives in the tab bar (App.tsx).
    // The ImportPanel only renders for the unauthenticated state.
    return null
  }

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Plug size={20} weight="duotone" />
          <h2 className="text-base font-semibold">Connect to enterprise</h2>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={e => {
            e.preventDefault()
            void connect(url, token)
          }}
        >
          <label className="text-sm grid gap-1">
            <span className="text-neutral-600 dark:text-neutral-400">Enterprise URL</span>
            <Input
              required
              placeholder="https://github.com/enterprises/your-slug"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </label>
          <label className="text-sm grid gap-1">
            <span className="flex items-center justify-between gap-2 text-neutral-600 dark:text-neutral-400">
              <span>Personal access token</span>
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-normal text-blue-600 hover:underline dark:text-blue-400"
              >
                Create one ↗
              </a>
            </span>
            <Input
              required
              type="password"
              placeholder="ghp_..."
              value={token}
              onChange={e => setToken(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? 'Connecting…' : 'Connect'}
          </Button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <p className="mt-3 text-xs text-neutral-500">
          Credentials are kept in memory only. They are sent directly to GitHub's API.
        </p>
        <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-neutral-500">
            No enterprise handy? Explore the dashboard with deterministic fake data.
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.set('demo', '150')
              window.location.assign(url.toString())
            }}
          >
            Try demo mode
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
