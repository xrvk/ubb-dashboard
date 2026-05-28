import { useMemo, useState } from 'react'
import { CaretDown, CaretUp, PencilSimple, Trash, MagnifyingGlass, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { classifyStatus, utilization, type Status } from '@/lib/status'
import type { UserBudget } from '@/lib/api'

type SortKey = 'user' | 'budgetAmount' | 'consumedAmount' | 'utilization' | 'status'

interface Props {
  budgets: UserBudget[]
  onEdit: (b: UserBudget) => void
  onDelete: (b: UserBudget) => void
}

const STATUS_ORDER: Record<Status, number> = { over: 0, near: 1, ok: 2 }

const PAGE_SIZE = 50

const TIERS = [
  { id: 'all', label: 'Any budget', min: -Infinity, max: Infinity },
  { id: 'micro', label: '< $10', min: 0, max: 10 },
  { id: 'small', label: '$10–$100', min: 10, max: 100 },
  { id: 'mid', label: '$100–$1k', min: 100, max: 1000 },
  { id: 'large', label: '$1k+', min: 1000, max: Infinity },
] as const

type TierId = (typeof TIERS)[number]['id']

function SortHeader({
  k,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
  children,
}: {
  k: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  return (
    <th
      onClick={() => onSort(k)}
      className={cn(
        'px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 cursor-pointer select-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end w-full')}>
        {children}
        {sortKey === k ? (
          sortDir === 'asc' ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />
        ) : null}
      </span>
    </th>
  )
}

export function BudgetsTable({ budgets, onEdit, onDelete }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('consumedAmount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [tier, setTier] = useState<TierId>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [showAll, setShowAll] = useState(false)

  const allRows = useMemo(() => {
    const tierDef = TIERS.find(t => t.id === tier)!
    const filtered = budgets.filter(b => {
      if (filter !== 'all' && classifyStatus(b) !== filter) return false
      if (query && !b.user.toLowerCase().includes(query.toLowerCase())) return false
      if (b.budgetAmount < tierDef.min || b.budgetAmount >= tierDef.max) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'user':
          cmp = a.user.localeCompare(b.user)
          break
        case 'budgetAmount':
          cmp = a.budgetAmount - b.budgetAmount
          break
        case 'consumedAmount':
          cmp = a.consumedAmount - b.consumedAmount
          break
        case 'utilization': {
          const au = utilization(a)
          const bu = utilization(b)
          cmp = (au === Infinity ? 1e9 : au) - (bu === Infinity ? 1e9 : bu)
          break
        }
        case 'status':
          cmp = STATUS_ORDER[classifyStatus(a)] - STATUS_ORDER[classifyStatus(b)]
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [budgets, filter, query, sortKey, sortDir, tier])

  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  // Reset page on filter changes during render (state-during-render pattern)
  const [prevAllLen, setPrevAllLen] = useState(allRows.length)
  if (prevAllLen !== allRows.length) {
    setPrevAllLen(allRows.length)
    if (page > 0 && page >= pageCount) setPage(0)
  }

  const rows = showAll
    ? allRows
    : allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'user' ? 'asc' : 'desc')
    }
  }
  const sortProps = { sortKey, sortDir, onSort: toggleSort } as const

  const startIdx = showAll ? 1 : page * PAGE_SIZE + 1
  const endIdx = showAll ? allRows.length : Math.min((page + 1) * PAGE_SIZE, allRows.length)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Individual ULBs ({allRows.length.toLocaleString()})
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
            {(['all', 'over', 'near', 'ok'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize',
                  filter === f
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
                )}
              >
                {f === 'all' ? 'All' : f === 'over' ? 'Over' : f === 'near' ? 'Near' : 'OK'}
              </button>
            ))}
          </div>
          <select
            value={tier}
            onChange={e => setTier(e.target.value as TierId)}
            className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs"
          >
            {TIERS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <div className="relative">
            <MagnifyingGlass size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Search user"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-8 w-48 pl-8 text-sm"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 dark:border-neutral-800">
            <tr>
              <SortHeader k="user" {...sortProps}>User</SortHeader>
              <SortHeader k="budgetAmount" align="right" {...sortProps}>Budget</SortHeader>
              <SortHeader k="consumedAmount" align="right" {...sortProps}>Consumed</SortHeader>
              <SortHeader k="utilization" align="right" {...sortProps}>% used</SortHeader>
              <SortHeader k="status" {...sortProps}>Status</SortHeader>
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-neutral-500">
                  No matching individual ULBs.
                </td>
              </tr>
            ) : (
              rows.map(b => {
                const status = classifyStatus(b)
                const u = utilization(b)
                return (
                  <tr
                    key={b.id}
                    className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className="px-3 py-2.5 font-medium">{b.user}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(b.budgetAmount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(b.consumedAmount)}</td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right tabular-nums',
                        status === 'over' && 'text-red-600 dark:text-red-400 font-medium',
                        status === 'near' && 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {u === Infinity ? '∞' : formatPercent(u)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => onEdit(b)} title="Edit">
                          <PencilSimple size={15} weight="duotone" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => onDelete(b)} title="Delete">
                          <Trash size={15} weight="duotone" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        {allRows.length > PAGE_SIZE ? (
          <div className="px-3 py-2.5 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-neutral-50/60 dark:bg-neutral-900/40">
            <div className="text-xs text-neutral-500">
              {allRows.length === 0
                ? 'No results'
                : `Showing ${startIdx.toLocaleString()}–${endIdx.toLocaleString()} of ${allRows.length.toLocaleString()}`}
            </div>
            <div className="flex items-center gap-2">
              {!showAll ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <CaretLeft size={14} weight="bold" />
                    Prev
                  </Button>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 tabular-nums">
                    Page {page + 1} / {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                  >
                    Next
                    <CaretRight size={14} weight="bold" />
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant={showAll ? 'secondary' : 'ghost'}
                onClick={() => {
                  setShowAll(s => !s)
                  setPage(0)
                }}
              >
                {showAll ? 'Paginate' : 'Show all'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
