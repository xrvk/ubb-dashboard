import { useEffect, useRef, useState } from 'react'
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretDown,
  LinkSimple,
  PlugsConnected,
  SignOut,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface DevProfile {
  name: string
  url: string
  token: string
}

interface ConnectionMenuProps {
  isDemo: boolean
  label: string
  loading: boolean
  onRefresh: () => void
  onDisconnect: () => void
  /** Optional list of dev-only `.env.*.local` profiles for quick-switch. */
  devProfiles?: ReadonlyArray<DevProfile>
  /** Optional handler invoked when a dev profile is selected. */
  onSwitchProfile?: (profile: DevProfile) => void
  /** Host of the currently connected enterprise URL, used to mark the active profile. */
  currentHost?: string
  /**
   * Optional handler for copying a shareable pre-fill link. When
   * omitted (e.g. demo mode, or no parseable host), the menu item is
   * hidden — there's nothing useful to share.
   */
  onCopyShareLink?: () => void
}

/**
 * Single connection pill that opens a small menu with Refresh + Disconnect.
 * Consolidates what used to be a host chip + two trailing buttons in the tab
 * bar. The pill itself is the trigger so the host stays visible at a glance.
 *
 * Optionally renders a "Switch profile" section listing `.env.*.local`
 * profiles surfaced by the Vite dev server. Production builds receive an
 * empty list (the endpoint doesn't exist), so the section silently hides.
 */
export function ConnectionMenu({
  isDemo,
  label,
  loading,
  onRefresh,
  onDisconnect,
  devProfiles = [],
  onSwitchProfile,
  currentHost,
  onCopyShareLink,
}: ConnectionMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const showProfiles = devProfiles.length > 0 && !!onSwitchProfile

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isDemo ? 'Demo session' : `Connected to ${label}`}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs h-8 transition-colors',
          'border-neutral-200 dark:border-neutral-800',
          'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <PlugsConnected
          size={14}
          weight="duotone"
          className={isDemo ? 'text-amber-500' : 'text-emerald-600'}
        />
        <span className="hidden md:inline font-medium text-neutral-700 dark:text-neutral-200 max-w-[180px] truncate">
          {label}
        </span>
        <CaretDown
          size={10}
          weight="bold"
          className={cn(
            'text-neutral-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[220px] rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg z-20 py-1"
        >
          <div className="px-3 py-1.5 text-[11px] text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 md:hidden">
            {label}
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={loading}
            onClick={() => {
              setOpen(false)
              onRefresh()
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
          >
            <ArrowsClockwise size={14} weight="duotone" className={loading ? 'animate-spin' : ''} />
            {isDemo ? 'Regenerate demo' : 'Refresh data'}
          </button>
          {showProfiles ? (
            <div className="border-t border-neutral-200 dark:border-neutral-800 mt-1 pt-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-neutral-500 flex items-center gap-1.5">
                <ArrowsLeftRight size={11} weight="bold" />
                Switch profile
                <span className="ml-auto text-[9px] font-normal normal-case text-neutral-400">dev</span>
              </div>
              {devProfiles.map(p => {
                let host: string
                try {
                  host = new URL(p.url).host
                } catch {
                  host = p.url
                }
                const isActive = !isDemo && currentHost && host === currentHost
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="menuitem"
                    disabled={loading || !!isActive}
                    onClick={() => {
                      setOpen(false)
                      onSwitchProfile?.(p)
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                      'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      'disabled:opacity-60 disabled:pointer-events-none',
                    )}
                    title={p.url}
                  >
                    <PlugsConnected
                      size={13}
                      weight="duotone"
                      className={isActive ? 'text-emerald-600' : 'text-neutral-400'}
                    />
                    <span className="font-medium text-neutral-700 dark:text-neutral-200 truncate">{p.name}</span>
                    {isActive ? (
                      <span className="ml-auto text-[10px] text-emerald-700 dark:text-emerald-400">active</span>
                    ) : (
                      <span className="ml-auto text-[10px] text-neutral-400 truncate max-w-[100px]">{host}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className={cn(showProfiles && 'border-t border-neutral-200 dark:border-neutral-800 mt-1 pt-1')}>
            {onCopyShareLink ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onCopyShareLink()
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <LinkSimple size={14} weight="duotone" />
                Copy shareable link
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onDisconnect()
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <SignOut size={14} weight="duotone" />
              {isDemo ? 'Exit demo' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
