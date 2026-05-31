import { useEffect, useRef, useState } from 'react'
import {
  ArrowsClockwise,
  CaretDown,
  PlugsConnected,
  SignOut,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface ConnectionMenuProps {
  isDemo: boolean
  label: string
  loading: boolean
  onRefresh: () => void
  onDisconnect: () => void
}

/**
 * Single connection pill that opens a small menu with Refresh + Disconnect.
 * Consolidates what used to be a host chip + two trailing buttons in the tab
 * bar. The pill itself is the trigger so the host stays visible at a glance.
 */
export function ConnectionMenu({
  isDemo,
  label,
  loading,
  onRefresh,
  onDisconnect,
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
          className="absolute right-0 top-full mt-1 min-w-[200px] rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg z-20 py-1"
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
      ) : null}
    </div>
  )
}
