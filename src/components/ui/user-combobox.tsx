import { useId, useMemo, useState } from 'react'
import { CaretDown, MagnifyingGlass, User } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

interface SeatOption {
  login: string
  orgLogin?: string | null
  disabled?: boolean
  disabledReason?: string
}

interface Props {
  options: SeatOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  emptyMessage?: string
}

const MAX_VISIBLE = 50

export function UserCombobox({ options, value, onChange, disabled, placeholder, emptyMessage }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listId = useId()

  // Sync the dropdown's typed query to the field's value when the user is
  // typing inline (no external trigger).
  const filtered = useMemo(() => {
    const q = (open ? query : value).trim().toLowerCase()
    if (!q) return options.slice(0, MAX_VISIBLE)
    return options
      .filter(o => o.login.toLowerCase().includes(q) || (o.orgLogin?.toLowerCase().includes(q) ?? false))
      .slice(0, MAX_VISIBLE)
  }, [options, query, value, open])

  return (
    <div className="relative">
      <div className="relative">
        <MagnifyingGlass size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <Input
          type="text"
          placeholder={placeholder ?? 'Search for a user'}
          disabled={disabled}
          value={open ? query : value}
          onFocus={() => {
            setQuery(value)
            setOpen(true)
          }}
          onChange={e => {
            setOpen(true)
            setQuery(e.target.value)
            onChange(e.target.value)
          }}
          onBlur={() => {
            // Defer close so onMouseDown on items still fires
            window.setTimeout(() => setOpen(false), 150)
          }}
          className="pl-8 pr-8"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
        />
        <CaretDown
          size={14}
          weight="bold"
          className={cn(
            'absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-500">
              {emptyMessage ?? 'No matching Copilot users.'}
            </div>
          ) : (
            filtered.map(o => (
              <button
                key={o.login}
                type="button"
                role="option"
                aria-selected={value === o.login}
                aria-disabled={o.disabled}
                disabled={o.disabled}
                onMouseDown={e => {
                  // mousedown so the input's blur doesn't fire first
                  e.preventDefault()
                  if (o.disabled) return
                  onChange(o.login)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm',
                  o.disabled
                    ? 'text-neutral-400 cursor-not-allowed'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer',
                  value === o.login && !o.disabled && 'bg-emerald-50 dark:bg-emerald-950/40',
                )}
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <User size={14} weight="duotone" className="text-neutral-500 shrink-0" />
                  <span className="truncate font-medium">{o.login}</span>
                  {o.orgLogin ? (
                    <span className="truncate text-xs text-neutral-500">· {o.orgLogin}</span>
                  ) : null}
                </span>
                {o.disabled ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">
                    {o.disabledReason ?? 'already set'}
                  </span>
                ) : null}
              </button>
            ))
          )}
          {options.length > filtered.length && filtered.length === MAX_VISIBLE ? (
            <div className="px-3 py-1.5 text-xs text-neutral-500 border-t border-neutral-200 dark:border-neutral-800">
              Showing first {MAX_VISIBLE}. Keep typing to narrow.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
