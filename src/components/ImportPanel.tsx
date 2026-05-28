import { useState } from 'react'
import { Plug, PlugsConnected, ArrowsClockwise } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export function ImportPanel() {
  const { credentials, connect, disconnect, refresh, loading, error } = useCredentials()
  const [url, setUrl] = useState((import.meta.env.VITE_DEV_ENTERPRISE_URL as string) ?? '')
  const [token, setToken] = useState('')

  if (credentials) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PlugsConnected size={22} weight="duotone" className="text-emerald-600" />
            <div>
              <div className="text-sm font-medium">Connected</div>
              <div className="text-xs text-neutral-500">
                {credentials.ent} · {new URL(credentials.base).host}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <ArrowsClockwise size={16} weight="duotone" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>
    )
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
            <span className="text-neutral-600 dark:text-neutral-400">Personal access token</span>
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
          Credentials are kept in memory only. They are never sent anywhere except api.&lt;your-host&gt;.
        </p>
      </CardContent>
    </Card>
  )
}
