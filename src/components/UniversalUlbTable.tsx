import { useMemo, useState } from 'react'
import {
  CaretDown,
  CaretUp,
  MagnifyingGlass,
  CaretLeft,
  CaretRight,
  X,
  Buildings,
  Plus,
} from '@phosphor-icons/react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
import { UNASSIGNED_CC } from '@/components/BudgetsTable'
import type { CopilotSeat, CostCenter, CostCenterResolution } from '@/lib/api'
import type { UserAicAggregate } from '@/lib/usageReport'

export interface UniversalUlbRow {
  login: string
  orgLogin: string | null
  /** AIC consumed across copilot_ai_credit + coding_agent_ai_credit. 0 if no data. */
  aicConsumed: number
  /** $ value of that consumption from the report. */
  grossAmount: number
  /** AIC consumed by the coding-agent SKU only. */
  codingAgentAic: number
  /** Most recent activity date from either the seat or the usage report. */
  lastUsed: string | null
  /** True iff the row appeared in the usage report (i.e., has actual data). */
  hasReportData: boolean
}

type SortKey = 'login' | 'costCenter' | 'aicConsumed' | 'pctOfCap' | 'lastUsed'

interface Filters {
  query: string
  costCenter: string
  /** all | only-with-data | only-without-data */
  reportFilter: 'all' | 'with-data' | 'without-data'
}

const EMPTY_FILTERS: Filters = { query: '', costCenter: '', reportFilter: 'all' }

const PAGE_SIZE = 50

interface Props {
  /** Universal-ULB-covered seats (already filtered to exclude ind-ULB holders). */
  seats: CopilotSeat[]
  /** Aggregated per-user usage from the latest ingested report. May be empty. */
  usage: UserAicAggregate[]
  /** Universal ULB cap (USD). Used to compute % consumed. 0 means uncapped. */
  cap: number
  costCenters: CostCenter[]
  loginToCostCenter: Map<string, CostCenterResolution | null>
  /** Bulk-convert selected logins to individual ULBs. */
  onBulkConvert: (logins: string[]) => void
  /** Add a single individual ULB for one user (deep-links to the existing dialog). */
  onCreateOne: (login: string) => void
}

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

export function UniversalUlbTable({
  seats,
  usage,
  cap,
  costCenters,
  loginToCostCenter,
  onBulkConvert,
  onCreateOne,
}: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('aicConsumed')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const setFilter = (next: Partial<Filters>) => setFilters({ ...filters, ...next })

  // Join seats with usage by lowercased login.
  const rows = useMemo<UniversalUlbRow[]>(() => {
    const usageByLogin = new Map<string, UserAicAggregate>()
    for (const u of usage) usageByLogin.set(u.username.toLowerCase(), u)
    return seats.map(s => {
      const u = usageByLogin.get(s.login.toLowerCase())
      const reportDate = u?.lastUsedDate ?? null
      const seatDate = s.lastActivityAt
      // Use whichever is more recent (lexicographic ISO compare is fine).
      const lastUsed: string | null =
        reportDate && seatDate
          ? reportDate > seatDate ? reportDate : seatDate
          : reportDate ?? seatDate ?? null
      return {
        login: s.login,
        orgLogin: s.orgLogin,
        aicConsumed: u?.aicConsumed ?? 0,
        grossAmount: u?.grossAmount ?? 0,
        codingAgentAic: u?.codingAgentAic ?? 0,
        lastUsed,
        hasReportData: !!u,
      }
    })
  }, [seats, usage])

  const allRows = useMemo(() => {
    const filtered = rows.filter(r => {
      if (filters.query && !r.login.toLowerCase().includes(filters.query.toLowerCase())) return false
      if (filters.costCenter) {
        const cc = loginToCostCenter.get(r.login.toLowerCase()) ?? null
        if (filters.costCenter === UNASSIGNED_CC) {
          if (cc) return false
        } else {
          if (!cc || cc.cc.id !== filters.costCenter) return false
        }
      }
      if (filters.reportFilter === 'with-data' && !r.hasReportData) return false
      if (filters.reportFilter === 'without-data' && r.hasReportData) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'login':
          cmp = a.login.localeCompare(b.login)
          break
        case 'costCenter': {
          const an = loginToCostCenter.get(a.login.toLowerCase())?.cc.name ?? null
          const bn = loginToCostCenter.get(b.login.toLowerCase())?.cc.name ?? null
          if (an === null && bn !== null) return 1
          if (an !== null && bn === null) return -1
          if (an === null && bn === null) return 0
          cmp = an!.localeCompare(bn!)
          break
        }
        case 'aicConsumed':
          cmp = a.aicConsumed - b.aicConsumed
          break
        case 'pctOfCap': {
          // Sort by gross $ / cap; unmetered rows (cap=0) all tie.
          const ap = cap > 0 ? a.grossAmount / cap : 0
          const bp = cap > 0 ? b.grossAmount / cap : 0
          cmp = ap - bp
          break
        }
        case 'lastUsed': {
          const al = a.lastUsed ?? ''
          const bl = b.lastUsed ?? ''
          if (al === '' && bl !== '') return 1
          if (al !== '' && bl === '') return -1
          cmp = al.localeCompare(bl)
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [rows, filters, sortKey, sortDir, loginToCostCenter, cap])

  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  const [prevLen, setPrevLen] = useState(allRows.length)
  if (prevLen !== allRows.length) {
    setPrevLen(allRows.length)
    if (page > 0 && page >= pageCount) setPage(0)
  }

  const pagedRows = showAll ? allRows : allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const visibleLogins = useMemo(() => pagedRows.map(r => r.login), [pagedRows])
  const allLogins = useMemo(() => allRows.map(r => r.login), [allRows])

  const allVisibleSelected = visibleLogins.length > 0 && visibleLogins.every(l => selected.has(l))
  const someVisibleSelected = visibleLogins.some(l => selected.has(l))
  const allMatchingSelected = allLogins.length > 0 && allLogins.every(l => selected.has(l))
  const showAcrossBanner =
    allVisibleSelected && !showAll && allRows.length > pagedRows.length && !allMatchingSelected

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir(k === 'login' ? 'asc' : 'desc')
    }
  }
  const sortProps = { sortKey, sortDir, onSort: toggleSort } as const

  const toggleRow = (login: string) =>
    setSelected(s => {
      const next = new Set(s)
      if (next.has(login)) next.delete(login)
      else next.add(login)
      return next
    })
  const toggleVisible = () =>
    setSelected(s => {
      const next = new Set(s)
      if (allVisibleSelected) visibleLogins.forEach(l => next.delete(l))
      else visibleLogins.forEach(l => next.add(l))
      return next
    })
  const selectAllMatching = () =>
    setSelected(prev => {
      const next = new Set(prev)
      allLogins.forEach(l => next.add(l))
      return next
    })
  const clearSelection = () => setSelected(new Set())

  const startIdx = showAll ? 1 : page * PAGE_SIZE + 1
  const endIdx = showAll ? allRows.length : Math.min((page + 1) * PAGE_SIZE, allRows.length)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Users covered by the universal ULB ({allRows.length.toLocaleString()})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
              {(['all', 'with-data', 'without-data'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter({ reportFilter: f })}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded transition-colors',
                    filters.reportFilter === f
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
                  )}
                >
                  {f === 'all' ? 'All' : f === 'with-data' ? 'With report data' : 'No report data'}
                </button>
              ))}
            </div>
            {costCenters.length > 0 ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                <Buildings size={14} weight="duotone" className="text-neutral-400" />
                <select
                  value={filters.costCenter}
                  onChange={e => setFilter({ costCenter: e.target.value })}
                  className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-600"
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
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-col gap-2 p-2.5 rounded-md border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/30">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-emerald-900 dark:text-emerald-100">
                <strong>{selected.size.toLocaleString()}</strong> selected
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onBulkConvert(Array.from(selected))}>
                  <Plus size={14} weight="duotone" />
                  Convert to individual ULB
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            </div>
            {showAcrossBanner ? (
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
              <SortHeader k="login" {...sortProps}>User</SortHeader>
              {costCenters.length > 0 ? (
                <SortHeader k="costCenter" {...sortProps}>Cost center</SortHeader>
              ) : null}
              <SortHeader k="aicConsumed" align="right" {...sortProps}>AIC consumed</SortHeader>
              <SortHeader k="pctOfCap" align="right" {...sortProps}>% of cap</SortHeader>
              <SortHeader k="lastUsed" {...sortProps}>Last used</SortHeader>
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 ? (
              <tr>
                <td colSpan={costCenters.length > 0 ? 7 : 6} className="px-3 py-8 text-center text-sm text-neutral-500">
                  No matching users.
                </td>
              </tr>
            ) : (
              pagedRows.map(r => {
                const isSelected = selected.has(r.login)
                const pct = cap > 0 ? r.grossAmount / cap : 0
                const overCap = cap > 0 && r.grossAmount >= cap
                const nearCap = cap > 0 && !overCap && r.grossAmount >= cap * 0.8
                return (
                  <tr
                    key={r.login}
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
                        aria-label={`Select ${r.login}`}
                        checked={isSelected}
                        onChange={() => toggleRow(r.login)}
                        className="rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      {r.login}
                      {!r.hasReportData ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-400">no data</span>
                      ) : null}
                    </td>
                    {costCenters.length > 0 ? (
                      (() => {
                        const cc = loginToCostCenter.get(r.login.toLowerCase()) ?? null
                        if (!cc) {
                          return (
                            <td className="px-3 py-2.5 text-neutral-400 dark:text-neutral-500">—</td>
                          )
                        }
                        return (
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => setFilter({ costCenter: cc.cc.id })}
                              className="text-left text-neutral-900 dark:text-neutral-100 hover:underline"
                              title={cc.via === 'org' ? `Inherited via org "${cc.viaOrg ?? '?'}"` : 'Direct user assignment'}
                            >
                              <span>{cc.cc.name}</span>
                              {cc.via === 'org' ? (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                  via org
                                </span>
                              ) : null}
                            </button>
                          </td>
                        )
                      })()
                    ) : null}
                    <td className="px-3 py-2.5 text-right tabular-nums" title={`${formatCurrency(r.grossAmount)} gross${r.codingAgentAic > 0 ? ` · ${r.codingAgentAic.toFixed(2)} from coding agent` : ''}`}>
                      {r.aicConsumed.toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right tabular-nums',
                        overCap && 'text-red-600 dark:text-red-400 font-medium',
                        nearCap && 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {cap > 0 ? formatPercent(pct) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600 dark:text-neutral-400">
                      {r.lastUsed ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onCreateOne(r.login)} title="Set individual ULB">
                        <Plus size={14} weight="duotone" />
                        Set ind ULB
                      </Button>
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
              {`Showing ${startIdx.toLocaleString()}–${endIdx.toLocaleString()} of ${allRows.length.toLocaleString()}`}
            </div>
            <div className="flex items-center gap-2">
              {!showAll ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                    <CaretLeft size={14} weight="bold" />
                    Prev
                  </Button>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 tabular-nums">
                    Page {page + 1} / {pageCount}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
                    Next
                    <CaretRight size={14} weight="bold" />
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant={showAll ? 'secondary' : 'ghost'} onClick={() => { setShowAll(s => !s); setPage(0) }}>
                {showAll ? 'Paginate' : 'Show all'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
