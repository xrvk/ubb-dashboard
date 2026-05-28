import { useMemo, useState } from 'react'
import { CaretDown, CaretUp, PencilSimple, Trash, BellRinging, MagnifyingGlass } from '@phosphor-icons/react'
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

const ROW_CAP = 250

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
  const [query, setQuery] = useState('')

  const allRows = useMemo(() => {
    const filtered = budgets.filter(b => {
      if (filter !== 'all' && classifyStatus(b) !== filter) return false
      if (query && !b.user.toLowerCase().includes(query.toLowerCase())) return false
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
  }, [budgets, filter, query, sortKey, sortDir])

  const rows = allRows.slice(0, ROW_CAP)
  const hiddenCount = allRows.length - rows.length

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'user' ? 'asc' : 'desc')
    }
  }

  const sortProps = { sortKey, sortDir, onSort: toggleSort } as const

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900',
                )}
              >
                {f === 'all' ? 'All' : f === 'over' ? 'Over' : f === 'near' ? 'Near' : 'OK'}
              </button>
            ))}
          </div>
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
                    <td className="px-3 py-2.5 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {b.user}
                        {b.willAlert ? (
                          <span title="Alerts enabled">
                            <BellRinging size={12} weight="duotone" className="text-amber-600" />
                          </span>
                        ) : null}
                      </span>
                    </td>
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
        {hiddenCount > 0 ? (
          <div className="px-3 py-3 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500 text-center bg-neutral-50 dark:bg-neutral-900/50">
            Showing {rows.length.toLocaleString()} of {allRows.length.toLocaleString()}. Use search or status filter to narrow results.
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
