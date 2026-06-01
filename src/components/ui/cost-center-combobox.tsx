import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Buildings, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface CostCenterOption {
  /** Stable id passed back via `onChange`. Use sentinels like `''` for
   * "All cost centers" and a constant like `UNASSIGNED_CC` for Unassigned. */
  id: string
  label: string
  /** Optional count shown as " · 1.2k" to the right of the label. */
  count?: number
  /** Visually emphasizes this row (used for the "All cost centers" pinned
   * option). */
  emphasis?: boolean
}

interface Props {
  options: CostCenterOption[]
  value: string
  onChange: (id: string) => void
  /** Shown when the input is empty (no option selected). */
  placeholder?: string
  /** Shown when typing matches nothing. */
  emptyMessage?: string
  className?: string
  inputClassName?: string
  ariaLabel?: string
  disabled?: boolean
  /** When provided, renders a small `×` button to the right of the input
   * that calls this. Typically used to reset to the "All" option. */
  onClear?: () => void
  clearTitle?: string
}

const MAX_VISIBLE = 50

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return n.toLocaleString()
}

/**
 * Searchable dropdown for cost centers. Modeled after `UserCombobox` —
 * type-ahead filter, click-to-select, MAX_VISIBLE cap with a "keep typing"
 * hint when the list is truncated. Generic over the option list so the two
 * call sites (BudgetsTable filter, UniversalUbbPage outlier filter) can
 * each build their own option set (incl. their respective sentinels).
 */
export function CostCenterCombobox({
  options,
  value,
  onChange,
  placeholder,
  emptyMessage,
  className,
  inputClassName,
  ariaLabel,
  disabled,
  onClear,
  clearTitle,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedLabel = useMemo(
    () => options.find(o => o.id === value)?.label ?? '',
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, MAX_VISIBLE)
    return options
      .filter(o => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE)
  }, [options, query])

  // Close on outside click — the input's blur isn't enough because we want
  // the option buttons to handle their own clicks (we use onMouseDown).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={containerRef} className={cn('relative inline-flex items-center gap-1', className)}>
      <div className="relative">
        {open ? (
          <MagnifyingGlass size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        ) : (
          <Buildings size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        )}
        <Input
          type="text"
          role="combobox"
          aria-label={ariaLabel ?? 'Filter by cost center'}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          disabled={disabled}
          placeholder={placeholder ?? 'Search cost centers'}
          value={open ? query : selectedLabel}
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onChange={e => {
            setOpen(true)
            setQuery(e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setOpen(false)
              setQuery('')
              ;(e.target as HTMLElement).blur()
            } else if (e.key === 'Enter' && open && filtered.length > 0) {
              e.preventDefault()
              const first = filtered[0]
              onChange(first.id)
              setOpen(false)
              setQuery('')
            }
          }}
          className={cn('pl-8 pr-7 h-8 text-xs', inputClassName)}
        />
        <CaretDown
          size={12}
          weight="bold"
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 transition-transform pointer-events-none',
            open && 'rotate-180',
          )}
        />
      </div>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="h-8 px-1.5 inline-flex items-center rounded-md text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title={clearTitle ?? 'Clear cost center filter'}
          aria-label={clearTitle ?? 'Clear cost center filter'}
        >
          <X size={12} weight="bold" />
        </button>
      ) : null}
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 left-0 top-full mt-1 min-w-[16rem] max-w-[24rem] max-h-72 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-500">
              {emptyMessage ?? 'No matching cost centers.'}
            </div>
          ) : (
            filtered.map(o => (
              <button
                key={o.id || '__empty__'}
                type="button"
                role="option"
                aria-selected={value === o.id}
                onMouseDown={e => {
                  e.preventDefault()
                  onChange(o.id)
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs cursor-pointer',
                  'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  value === o.id && 'bg-emerald-50 dark:bg-emerald-950/40',
                  o.emphasis && 'font-medium',
                )}
              >
                <span className="truncate">{o.label}</span>
                {typeof o.count === 'number' ? (
                  <span className="shrink-0 text-[11px] text-neutral-500">{formatCount(o.count)}</span>
                ) : null}
              </button>
            ))
          )}
          {options.length > filtered.length && filtered.length === MAX_VISIBLE ? (
            <div className="px-3 py-1.5 text-[11px] text-neutral-500 border-t border-neutral-200 dark:border-neutral-800 sticky bottom-0 bg-white dark:bg-neutral-900">
              Showing first {MAX_VISIBLE} of {options.length}. Keep typing to narrow.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
