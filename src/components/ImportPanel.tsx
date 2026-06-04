import { useState } from 'react'
import { Plug } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { readOrgUrlFromUrl } from '@/lib/urlParams'

export function ImportPanel() {
  const { credentials, connect, loading, error } = useCredentials()
  // Priority: ?org= URL param (any environment) > .env.local fallback (dev only).
  // The env-var read is gated on `import.meta.env.DEV` so the bundler tree-shakes
  // it away in production builds — without this guard, the bundle would inline
  // the dev org URL into the shipped JS.
  const [url, setUrl] = useState(
    () =>
      readOrgUrlFromUrl() ??
      (import.meta.env.DEV
        ? ((import.meta.env.VITE_DEV_ORG_URL as string | undefined) ?? '')
        : ''),
  )
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
          <h2 className="text-base font-semibold">Connect to organization</h2>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={e => {
            e.preventDefault()
            void connect(url, token)
          }}
        >
          <label className="text-sm grid gap-1">
            <span className="text-neutral-600 dark:text-neutral-400">
              Organization URL{' '}
              <span className="text-neutral-400 dark:text-neutral-500">
                (github.com only)
              </span>
            </span>
            <Input
              required
              placeholder="https://github.com/your-org"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </label>
          <label className="text-sm grid gap-1">
            <span className="flex items-center justify-between gap-2 text-neutral-600 dark:text-neutral-400">
              <span>Personal access token (classic)</span>
              <a
                href="https://github.com/settings/tokens/new?description=Org+Copilot+Dashboard&scopes=admin:org"
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
        <div className="mt-3 text-xs text-neutral-500 space-y-1">
          <p>
            Requires a{' '}
            <a
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#personal-access-tokens-classic"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              classic personal access token
            </a>{' '}
            with these scopes:
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px] dark:bg-neutral-800">
                admin:org
              </code>{' '}
              — org budgets, usage, and Copilot seats
            </li>
          </ul>
          <p>
            Fine-grained PATs are not supported for the org billing endpoints. Credentials stay
            in memory and are sent directly to GitHub's API (github.com only).
          </p>
        </div>
        <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-neutral-500">
            No organization handy? Explore the dashboard with deterministic fake data.
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
