import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { CC_PAGE_SIZE_OPTIONS } from '@/lib/ccPagination'

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
  className?: string
  /** When true, "All" appears as a page-size option and renders every row. */
  allowAll?: boolean
}

/**
 * Pagination control for cost-center lists. Companion to CcListToolbar —
 * lives below the rendered table/list. Parent owns `page` & `pageSize`
 * state and applies the slice; this component is presentation-only.
 */
export function CcListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
  allowAll = true,
}: Props) {
  const showingAll = pageSize >= total
  const pageCount = showingAll ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = showingAll ? total : Math.min(total, safePage * pageSize)

  return (
    <div
      className={cn(
        'flex items-center gap-3 flex-wrap text-xs text-neutral-500',
        className,
      )}
    >
      <label className="flex items-center gap-1.5">
        Rows per page
        <select
          value={showingAll ? 'all' : String(pageSize)}
          onChange={e => {
            const v = e.target.value
            onPageSizeChange(v === 'all' ? Number.MAX_SAFE_INTEGER : Number(v))
            onPageChange(1)
          }}
          className="h-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-600"
          aria-label="Rows per page"
        >
          {CC_PAGE_SIZE_OPTIONS.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          {allowAll ? <option value="all">All</option> : null}
        </select>
      </label>

      <div className="tabular-nums">
        {total === 0
          ? '0 of 0'
          : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50 dark:hover:bg-neutral-800"
          aria-label="Previous page"
        >
          <CaretLeft size={12} weight="bold" />
        </button>
        <span className="tabular-nums px-1.5">
          Page {safePage} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50 dark:hover:bg-neutral-800"
          aria-label="Next page"
        >
          <CaretRight size={12} weight="bold" />
        </button>
      </div>
    </div>
  )
}
