import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

interface SortOption {
  id: string
  label: string
}

interface Props {
  query: string
  onQueryChange: (q: string) => void
  sort: string
  onSortChange: (id: string) => void
  sortOptions: readonly SortOption[]
  /** Total rows in the underlying list (before query). */
  total: number
  /** Rows after the query filter (and any external filters). */
  visible: number
  /** Optional placeholder for the search input. */
  placeholder?: string
  className?: string
  /** Optional right-aligned slot for filter chips / toggles. */
  rightSlot?: React.ReactNode
  /** Hide the sort dropdown (e.g. when sortable column headers are present). */
  hideSort?: boolean
}

/**
 * Compact toolbar shared by the Dashboard CC card and Planner CC list:
 * search input, sort selector, and an "X of Y" counter. Deliberately
 * presentation-only — the parent owns the filter/sort state and applies
 * the helpers in `src/lib/ccRowFilter.ts`.
 */
export function CcListToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  sortOptions,
  total,
  visible,
  placeholder,
  className,
  rightSlot,
  hideSort = false,
}: Props) {
  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      <div className="relative">
        <MagnifyingGlass
          size={14}
          weight="duotone"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
        />
        <Input
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder ?? 'Search cost centers'}
          aria-label="Search cost centers"
          className="pl-8 pr-7 h-8 text-xs w-56"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 w-5 rounded text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={11} weight="bold" />
          </button>
        ) : null}
      </div>
      {hideSort ? null : (
        <label className="text-xs text-neutral-500 flex items-center gap-1.5">
          Sort
          <select
            value={sort}
            onChange={e => onSortChange(e.target.value)}
            className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-600"
            aria-label="Sort cost centers by"
          >
            {sortOptions.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="text-[11px] text-neutral-500 tabular-nums">
        {visible === total
          ? `${total.toLocaleString()} CC${total === 1 ? '' : 's'}`
          : `${visible.toLocaleString()} of ${total.toLocaleString()}`}
      </div>
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
    </div>
  )
}
