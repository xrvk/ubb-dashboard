/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { CaretDown, CaretUp, PencilSimple, Trash, MagnifyingGlass, CaretLeft, CaretRight, LockOpen, X, Buildings } from '@phosphor-icons/react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { classifyStatus, utilization, type Status } from '@/lib/status'
import { bucketForBudget } from '@/components/UtilizationHistogram'
import type { CostCenter, CostCenterResolution, UserBudget } from '@/lib/api'

type SortKey = 'user' | 'costCenter' | 'budgetAmount' | 'consumedAmount' | 'utilization' | 'status'

/**
 * Sentinel filter value meaning "users with no resolved cost center
 * (neither direct nor via their Copilot-license-granting org)". Chosen so it
 * can never collide with a real CC UUID.
 */
export const UNASSIGNED_CC = '__unassigned__'

export interface TableFilters {
  status: 'all' | Status
  bucketId: string | null
  minBudget: number | null
  maxBudget: number | null
  query: string
  /**
   * Cost-center filter. Empty string = no filter, UNASSIGNED_CC = users with
   * no resolved CC, any other value = a specific CC id.
   */
  costCenter: string
}

export const EMPTY_FILTERS: TableFilters = {
  status: 'all',
  bucketId: null,
  minBudget: null,
  maxBudget: null,
  query: '',
  costCenter: '',
}

interface Props {
  budgets: UserBudget[]
  filters: TableFilters
  onFiltersChange: (next: TableFilters) => void
  onEdit: (b: UserBudget) => void
  onDelete: (b: UserBudget) => void
  onBulkUnblock: (items: UserBudget[]) => void
  /** Active cost centers, used to populate the filter dropdown. */
  costCenters: CostCenter[]
  /** Lowercased login → resolved CC (or null for unassigned). */
  loginToCostCenter: Map<string, CostCenterResolution | null>
}

const STATUS_ORDER: Record<Status, number> = { over: 0, near: 1, ok: 2 }

const PAGE_SIZE = 50

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

export function BudgetsTable({ budgets, filters, onFiltersChange, onEdit, onDelete, onBulkUnblock, costCenters, loginToCostCenter }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('utilization')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [minInput, setMinInput] = useState(filters.minBudget !== null ? String(filters.minBudget) : '')
  const [maxInput, setMaxInput] = useState(filters.maxBudget !== null ? String(filters.maxBudget) : '')

  // Sync local input strings when filters change externally (e.g. reset)
  const [prevFilterMin, setPrevFilterMin] = useState(filters.minBudget)
  const [prevFilterMax, setPrevFilterMax] = useState(filters.maxBudget)
  if (prevFilterMin !== filters.minBudget) {
    setPrevFilterMin(filters.minBudget)
    setMinInput(filters.minBudget !== null ? String(filters.minBudget) : '')
  }
  if (prevFilterMax !== filters.maxBudget) {
    setPrevFilterMax(filters.maxBudget)
    setMaxInput(filters.maxBudget !== null ? String(filters.maxBudget) : '')
  }

  const setFilter = (next: Partial<TableFilters>) => onFiltersChange({ ...filters, ...next })

  // Status chip click: status and bucket are mutually exclusive categorical
  // filters. Selecting a status chip clears any active bucket selection.
  const selectStatus = (status: TableFilters['status']) =>
    onFiltersChange({ ...filters, status, bucketId: null })

  const commitBudgetRange = () => {
    const parse = (s: string): number | null => {
      const t = s.trim()
      if (!t) return null
      const n = Number(t)
      return Number.isFinite(n) ? n : null
    }
    onFiltersChange({ ...filters, minBudget: parse(minInput), maxBudget: parse(maxInput) })
  }

  const allRows = useMemo(() => {
    const filtered = budgets.filter(b => {
      if (filters.status !== 'all' && classifyStatus(b) !== filters.status) return false
      if (filters.query && !b.user.toLowerCase().includes(filters.query.toLowerCase())) return false
      if (filters.minBudget !== null && b.budgetAmount < filters.minBudget) return false
      if (filters.maxBudget !== null && b.budgetAmount > filters.maxBudget) return false
      if (filters.bucketId && bucketForBudget(b).id !== filters.bucketId) return false
      if (filters.costCenter) {
        const resolution = loginToCostCenter.get(b.user.toLowerCase()) ?? null
        if (filters.costCenter === UNASSIGNED_CC) {
          if (resolution) return false
        } else {
          if (!resolution || resolution.cc.id !== filters.costCenter) return false
        }
      }
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'user':
          cmp = a.user.localeCompare(b.user)
          break
        case 'costCenter': {
          const an = loginToCostCenter.get(a.user.toLowerCase())?.cc.name ?? null
          const bn = loginToCostCenter.get(b.user.toLowerCase())?.cc.name ?? null
          // Unassigned rows always sort last, regardless of asc/desc.
          if (an === null && bn !== null) return 1
          if (an !== null && bn === null) return -1
          if (an === null && bn === null) return 0
          cmp = an!.localeCompare(bn!)
          break
        }
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
  }, [budgets, filters, sortKey, sortDir, loginToCostCenter])

  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  const [prevAllLen, setPrevAllLen] = useState(allRows.length)
  if (prevAllLen !== allRows.length) {
    setPrevAllLen(allRows.length)
    if (page > 0 && page >= pageCount) setPage(0)
  }

  const rows = showAll
    ? allRows
    : allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const visibleIds = useMemo(() => rows.map(r => r.id), [rows])
  const allIds = useMemo(() => allRows.map(r => r.id), [allRows])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))
  const someVisibleSelected = visibleIds.some(id => selected.has(id))
  const allMatchingSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const showAcrossPagesBanner =
    allVisibleSelected && !showAll && allRows.length > rows.length && !allMatchingSelected

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'user' ? 'asc' : 'desc')
    }
  }
  const sortProps = { sortKey, sortDir, onSort: toggleSort } as const

  const toggleRow = (id: string) => {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleVisible = () => {
    setSelected(s => {
      const next = new Set(s)
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))
      return next
    })
  }
  const clearSelection = () => setSelected(new Set())

  const selectAllMatching = () => {
    setSelected(prev => {
      const next = new Set(prev)
      allIds.forEach(id => next.add(id))
      return next
    })
  }

  const selectedItems = useMemo(
    () => budgets.filter(b => selected.has(b.id)),
    [budgets, selected],
  )
  const selectedOverItems = selectedItems.filter(b => classifyStatus(b) === 'over')

  const startIdx = showAll ? 1 : page * PAGE_SIZE + 1
  const endIdx = showAll ? allRows.length : Math.min((page + 1) * PAGE_SIZE, allRows.length)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Individual ULBs ({allRows.length.toLocaleString()})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
              {(['all', 'over', 'near', 'ok'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => selectStatus(f)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize',
                    filters.status === f
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
                  )}
                >
                  {f === 'all' ? 'All' : f === 'over' ? 'Over' : f === 'near' ? 'Near' : 'OK'}
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-1 text-xs text-neutral-500">
              <span>Budget</span>
              <Input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="Min"
                value={minInput}
                onChange={e => setMinInput(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={commitBudgetRange}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitBudgetRange()
                }}
                className="h-8 w-20 text-xs px-2"
              />
              <span>–</span>
              <Input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="Max"
                value={maxInput}
                onChange={e => setMaxInput(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={commitBudgetRange}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitBudgetRange()
                }}
                className="h-8 w-20 text-xs px-2"
              />
              {(filters.minBudget !== null || filters.maxBudget !== null || minInput !== '' || maxInput !== '') ? (
                <button
                  onClick={() => {
                    setMinInput('')
                    setMaxInput('')
                    setFilter({ minBudget: null, maxBudget: null })
                  }}
                  className="h-8 px-2 inline-flex items-center gap-1 rounded-md text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  title="Clear budget range"
                >
                  <X size={12} weight="bold" />
                  Clear
                </button>
              ) : null}
            </div>
            {costCenters.length > 0 ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                <Buildings size={14} weight="duotone" className="text-neutral-400" />
                <select
                  value={filters.costCenter}
                  onChange={e => setFilter({ costCenter: e.target.value })}
                  className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                  title="Filter by cost center"
                  aria-label="Filter by cost center"
                >
                  <option value="">All cost centers</option>
                  <option value={UNASSIGNED_CC}>Unassigned</option>
                  <optgroup label="Cost centers">
                    {[...costCenters]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.name}</option>
                      ))}
                  </optgroup>
                </select>
                {filters.costCenter ? (
                  <button
                    onClick={() => setFilter({ costCenter: '' })}
                    className="h-8 px-1.5 inline-flex items-center rounded-md text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    title="Clear cost center filter"
                    aria-label="Clear cost center filter"
                  >
                    <X size={12} weight="bold" />
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="relative">
              <MagnifyingGlass size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <Input
                placeholder="Search user"
                value={filters.query}
                onChange={e => setFilter({ query: e.target.value })}
                className="h-8 w-44 pl-8 text-sm"
              />
            </div>
            {filters.bucketId ? (
              <button
                onClick={() => setFilter({ bucketId: null })}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-xs text-amber-800 dark:text-amber-200"
                title="Clear utilization bucket filter"
              >
                Bucket
                <X size={12} weight="bold" />
              </button>
            ) : null}
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-col gap-2 p-2.5 rounded-md border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/30">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-emerald-900 dark:text-emerald-100">
                <strong>{selected.size.toLocaleString()}</strong> selected
                {selectedOverItems.length > 0 ? (
                  <span className="text-emerald-700 dark:text-emerald-300 ml-2 text-xs">
                    ({selectedOverItems.length.toLocaleString()} over budget)
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onBulkUnblock(selectedItems)}>
                  <LockOpen size={14} weight="duotone" />
                  Unblock for month
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            </div>
            {showAcrossPagesBanner ? (
              <div className="text-xs text-emerald-800 dark:text-emerald-200">
                <button
                  type="button"
                  onClick={selectAllMatching}
                  className="font-medium underline hover:no-underline"
                >
                  Select all {allRows.length.toLocaleString()} users matching the current filter
                </button>
              </div>
            ) : null}
            {allMatchingSelected && allRows.length > PAGE_SIZE ? (
              <div className="text-xs text-emerald-800 dark:text-emerald-200">
                <button
                  type="button"
                  onClick={clearSelection}
                  className="font-medium underline hover:no-underline"
                >
                  Clear selection
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 dark:border-neutral-800">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible rows"
                  checked={allVisibleSelected}
                  ref={el => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                  }}
                  onChange={toggleVisible}
                  className="rounded cursor-pointer"
                />
              </th>
              <SortHeader k="user" {...sortProps}>User</SortHeader>
              {costCenters.length > 0 ? (
                <SortHeader k="costCenter" {...sortProps}>Cost center</SortHeader>
              ) : null}
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
                <td colSpan={costCenters.length > 0 ? 8 : 7} className="px-3 py-8 text-center text-sm text-neutral-500">
                  No matching individual ULBs.
                </td>
              </tr>
            ) : (
              rows.map(b => {
                const status = classifyStatus(b)
                const u = utilization(b)
                const isSelected = selected.has(b.id)
                return (
                  <tr
                    key={b.id}
                    className={cn(
                      'border-b border-neutral-100 dark:border-neutral-800/50',
                      isSelected
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                        : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40',
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${b.user}`}
                        checked={isSelected}
                        onChange={() => toggleRow(b.id)}
                        className="rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium">{b.user}</td>
                    {costCenters.length > 0 ? (
                      (() => {
                        const r = loginToCostCenter.get(b.user.toLowerCase()) ?? null
                        if (!r) {
                          return (
                            <td
                              className="px-3 py-2.5 text-neutral-400 dark:text-neutral-500"
                              title="Unassigned (charges fall to the enterprise default)"
                            >
                              —
                            </td>
                          )
                        }
                        const viaOrgTitle = r.via === 'org'
                          ? `Inherited via org "${r.viaOrg ?? '?'}"`
                          : `Direct user assignment`
                        return (
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => setFilter({ costCenter: r.cc.id })}
                              className="text-left text-neutral-900 dark:text-neutral-100 hover:underline"
                              title={`${viaOrgTitle}. Click to filter to this cost center.`}
                            >
                              <span>{r.cc.name}</span>
                              {r.via === 'org' ? (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                  via org
                                </span>
                              ) : null}
                            </button>
                          </td>
                        )
                      })()
                    ) : null}
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
