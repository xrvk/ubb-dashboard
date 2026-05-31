import { useMemo, useState } from 'react'
import {
  Buildings,
  Stack,
  ShieldCheck,
  Warning,
  TreeStructure,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { formatCurrency, cn } from '@/lib/utils'

/**
 * Sepia-tinted adaptation of the Budget Structure diagram from
 * https://github.com/octodemo/copilot-budget-command-calculator
 * (src/components/BudgetStructureDiagram.tsx). Shows how the enterprise
 * budget and per-cost-center budgets relate, depending on whether the
 * enterprise has `exclude_cost_center_usage` ON (independent mode) or OFF
 * (umbrella mode — CC budgets nest inside the enterprise pool).
 *
 * Data: cost-center budgets are joined to cost centers by lowercased name.
 * Cost centers without an ai_credits budget are surfaced separately as
 * "uncapped" so they can't silently overflow the enterprise pool.
 */
export function BudgetStructureDiagram() {
  const {
    enterpriseBudget,
    costCenterBudgetsByName,
    costCenters,
    loginToCostCenter,
  } = useCredentials()
  const [showAllCCs, setShowAllCCs] = useState(false)

  // Count Copilot-affecting seats per CC (a CC "affects Copilot" if any seat
  // resolves to it — directly or via the user's licensing org).
  const seatsPerCcId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const res of loginToCostCenter.values()) {
      if (!res) continue
      counts.set(res.cc.id, (counts.get(res.cc.id) ?? 0) + 1)
    }
    return counts
  }, [loginToCostCenter])

  const data = useMemo(() => {
    const named = costCenters.filter(cc => cc.name.trim().length > 0)
    const segments = named.map(cc => {
      const b = costCenterBudgetsByName.get(cc.name.toLowerCase())
      const seatCount = seatsPerCcId.get(cc.id) ?? 0
      return {
        id: cc.id,
        name: cc.name,
        budget: b ? b.budgetAmount : 0,
        preventFurtherUsage: b?.preventFurtherUsage ?? false,
        uncapped: !b,
        seatCount,
        affectsCopilot: seatCount > 0,
      }
    })
    const capped = segments.filter(s => !s.uncapped)
    const ccTotal = capped.reduce((sum, s) => sum + s.budget, 0)
    const uncappedCount = segments.length - capped.length
    return { segments, capped, ccTotal, uncappedCount }
  }, [costCenters, costCenterBudgetsByName, seatsPerCcId])

  const entAmount = enterpriseBudget?.budgetAmount ?? 0
  const excludeCcUsage = enterpriseBudget?.excludeCostCenterUsage ?? false
  const entHardCap = enterpriseBudget?.preventFurtherUsage ?? false
  const entWillAlert = enterpriseBudget?.willAlert ?? false

  // Bar scale: largest value sets 100%
  const maxBar = Math.max(entAmount, data.ccTotal, 1)
  const entBarPercent = entAmount > 0 ? Math.max(2, (entAmount / maxBar) * 100) : 0

  const segmentsForBar = excludeCcUsage ? data.segments : data.capped

  // CC sub-segment widths
  const ccSegments = useMemo(() => {
    const segs = segmentsForBar
    if (segs.length === 0) return []

    const cappedCount = segs.filter(s => !s.uncapped).length
    const uncappedHere = segs.length - cappedCount

    // Independent mode w/ both capped + uncapped: reserve visible width for
    // uncapped slices so the "no cap" risk shows up visually.
    if (excludeCcUsage && uncappedHere > 0 && cappedCount > 0) {
      const minCappedPool = 10
      const uncappedMinEach = 15
      const uncappedPool = Math.min(100 - minCappedPool, uncappedHere * uncappedMinEach)
      const uncappedEach = uncappedPool / uncappedHere
      const cappedPool = 100 - uncappedPool
      const cappedTotal = segs.reduce((s, x) => s + (x.uncapped ? 0 : x.budget), 0)

      return segs.map(s => ({
        ...s,
        percent: s.uncapped
          ? uncappedEach
          : cappedTotal > 0
            ? (s.budget / cappedTotal) * cappedPool
            : cappedPool / Math.max(cappedCount, 1),
      }))
    }

    // Default: proportional to budget; equal slices if no budget set.
    const total = segs.reduce((s, x) => s + x.budget, 0)
    return segs.map(s => ({
      ...s,
      percent: total > 0 ? (s.budget / total) * 100 : 100 / segs.length,
    }))
  }, [segmentsForBar, excludeCcUsage])

  // No envelope at all → nothing meaningful to draw.
  if (!enterpriseBudget && data.capped.length === 0) return null

  const tier: 'hard' | 'soft' | 'blind' =
    entHardCap
      ? 'hard'
      : entWillAlert
        ? 'soft'
        : entAmount > 0
          ? 'blind'
          : 'blind'

  const showUncappedGapNote = excludeCcUsage && data.uncappedCount > 0

  // Shared utility classes — sepia palette
  const cardCls =
    'rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
  const entContainerCls = !excludeCcUsage
    ? 'rounded-xl border-2 border-emerald-600/30 bg-emerald-600/5 dark:border-emerald-500/30 dark:bg-emerald-500/5 p-4 space-y-3'
    : 'rounded-lg border border-emerald-600/30 bg-emerald-600/5 dark:border-emerald-500/30 dark:bg-emerald-500/5 p-3 space-y-2'

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TreeStructure size={18} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
          Budget Structure
        </div>
        <div className="text-xs text-neutral-500">
          {excludeCcUsage ? 'Independent mode (exclude_cost_center_usage=true)' : 'Umbrella mode'}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* ───────────────── Shared / umbrella mode ───────────────── */}
        {!excludeCcUsage ? (
          <div className="space-y-3">
            <div className={entContainerCls}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  <Buildings size={14} weight="duotone" />
                  Enterprise Budget
                </div>
                <span className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  {enterpriseBudget ? formatCurrency(entAmount) : '— not set'}
                </span>
              </div>

              {/* Enterprise full-width bar */}
              <div className="h-6 rounded-lg bg-emerald-600/15 dark:bg-emerald-500/15 overflow-hidden">
                <div
                  className="h-full rounded-lg bg-emerald-600/30 dark:bg-emerald-500/30 transition-all duration-300"
                  style={{ width: '100%' }}
                />
              </div>

              {data.capped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                    <Stack size={12} weight="duotone" />
                    Cost-center sub-limits (within enterprise cap)
                  </div>
                  <div className="flex h-5 rounded-lg overflow-hidden border border-emerald-600/15 dark:border-emerald-500/15 gap-px">
                    {ccSegments.map((seg, i) => (
                      <div
                        key={seg.id}
                        title={`${seg.name} — ${formatCurrency(seg.budget)} sub-limit${seg.preventFurtherUsage ? ' (hard cap)' : ' (soft cap)'}`}
                        className="h-full flex items-center justify-center text-[10px] font-medium bg-amber-500/25 text-amber-900 dark:bg-amber-400/25 dark:text-amber-200 cursor-help transition-all duration-200"
                        style={{
                          width: `${seg.percent}%`,
                          minWidth: ccSegments.length <= 6 ? '2rem' : '0.5rem',
                          borderRadius:
                            i === 0
                              ? '0.5rem 0 0 0.5rem'
                              : i === ccSegments.length - 1
                                ? '0 0.5rem 0.5rem 0'
                                : 0,
                        }}
                      >
                        {seg.percent > 15 && formatCurrency(seg.budget)}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-neutral-500">
                    <span>
                      {data.capped.length} budgeted cost center
                      {data.capped.length !== 1 ? 's' : ''}
                      {data.uncappedCount > 0 ? ` · ${data.uncappedCount} other CC${data.uncappedCount !== 1 ? 's' : ''} share the pool` : ''}
                    </span>
                    <span>Σ {formatCurrency(data.ccTotal)} in sub-limits</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ───────────────── Independent / additive mode ───────────────── */
          <div className="space-y-3">
            <div className={entContainerCls}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  <Buildings size={14} weight="duotone" />
                  Enterprise Budget
                </div>
                <span className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  {enterpriseBudget ? formatCurrency(entAmount) : '— not set'}
                </span>
              </div>
              <div className="h-5 rounded-lg bg-emerald-600/10 dark:bg-emerald-500/10 overflow-hidden">
                <div
                  className="h-full rounded-lg bg-emerald-600/30 dark:bg-emerald-500/30 transition-all duration-300"
                  style={{ width: `${entBarPercent}%` }}
                />
              </div>
              <p className="text-[10px] text-neutral-500">
                Covers usage outside of cost centers only
              </p>
            </div>

            <div className="flex items-center justify-center text-neutral-500">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
              <span className="px-3 text-xs font-medium">+ independent</span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            </div>

            {ccSegments.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 dark:border-amber-400/30 dark:bg-amber-400/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                    <Stack size={14} weight="duotone" />
                    Cost-center budgets
                  </div>
                  <span className="font-mono text-sm font-bold text-amber-900 dark:text-amber-200">
                    {formatCurrency(data.ccTotal)}
                    {data.uncappedCount > 0 ? '+' : ''}
                  </span>
                </div>
                <div className="flex h-5 rounded-lg overflow-hidden border border-amber-500/15 dark:border-amber-400/15 gap-px">
                  {ccSegments.map((seg, i) => (
                    <div
                      key={seg.id}
                      title={
                        seg.uncapped
                          ? `${seg.name} — no per-CC cap (universal ULB is the only backstop)`
                          : `${seg.name} — ${formatCurrency(seg.budget)} independent cap${seg.preventFurtherUsage ? ' (hard cap)' : ' (soft cap)'}`
                      }
                      className={cn(
                        'h-full flex items-center justify-center text-[10px] font-medium cursor-help transition-all duration-200',
                        seg.uncapped
                          ? 'text-red-700 dark:text-red-300'
                          : 'bg-amber-500/30 text-amber-900 dark:bg-amber-400/30 dark:text-amber-200',
                      )}
                      style={{
                        width: `${seg.percent}%`,
                        minWidth: ccSegments.length <= 6 ? '2rem' : '0.5rem',
                        borderRadius:
                          i === 0
                            ? '0.5rem 0 0 0.5rem'
                            : i === ccSegments.length - 1
                              ? '0 0.5rem 0.5rem 0'
                              : 0,
                        ...(seg.uncapped
                          ? {
                              background:
                                'repeating-linear-gradient(135deg, color-mix(in oklch, var(--color-destructive) 25%, transparent), color-mix(in oklch, var(--color-destructive) 25%, transparent) 3px, color-mix(in oklch, var(--color-destructive) 12%, transparent) 3px, color-mix(in oklch, var(--color-destructive) 12%, transparent) 6px)',
                            }
                          : {}),
                      }}
                    >
                      {seg.percent > 15 && (seg.uncapped ? 'no cap' : formatCurrency(seg.budget))}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>
                    {ccSegments.length} cost center{ccSegments.length !== 1 ? 's' : ''}
                    {data.uncappedCount > 0 ? ` · ${data.uncappedCount} uncapped` : ''}
                  </span>
                  <span>Each caps charges independently</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────────── Full cost-center list ───────────────── */}
        {data.segments.length > 0 && (() => {
          const affecting = data.segments.filter(s => s.affectsCopilot)
          const notAffecting = data.segments.filter(s => !s.affectsCopilot)
          const visible = showAllCCs ? data.segments : affecting
          const sorted = [...visible].sort((a, b) => {
            // Budgeted first, then by seat count desc, then by name.
            if (a.uncapped !== b.uncapped) return a.uncapped ? 1 : -1
            if (a.budget !== b.budget) return b.budget - a.budget
            if (a.seatCount !== b.seatCount) return b.seatCount - a.seatCount
            return a.name.localeCompare(b.name)
          })

          return (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
                <div className="flex items-center gap-1.5 font-medium">
                  <Stack size={12} weight="duotone" />
                  {showAllCCs
                    ? `All ${data.segments.length} cost center${data.segments.length === 1 ? '' : 's'}`
                    : `${affecting.length} cost center${affecting.length === 1 ? '' : 's'} affecting Copilot`}
                </div>
                {notAffecting.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllCCs(v => !v)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal opacity-75 hover:opacity-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
                    aria-expanded={showAllCCs}
                  >
                    {showAllCCs
                      ? `Hide ${notAffecting.length} not affecting Copilot`
                      : `Show ${notAffecting.length} not affecting Copilot`}
                    {showAllCCs ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />}
                  </button>
                ) : null}
              </div>
              {sorted.length === 0 ? (
                <div className="text-xs text-neutral-500 italic">
                  No cost centers currently route Copilot seats.
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-100/60 dark:bg-neutral-900/60">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                        <th className="px-3 py-1.5 font-medium">Cost center</th>
                        <th className="px-3 py-1.5 font-medium text-right">Budget</th>
                        <th className="px-3 py-1.5 font-medium text-right">Copilot seats</th>
                        <th className="px-3 py-1.5 font-medium">Enforcement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(seg => (
                        <tr
                          key={seg.id}
                          className={cn(
                            'border-t border-neutral-200 dark:border-neutral-800',
                            !seg.affectsCopilot && 'opacity-60',
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium">{seg.name}</td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {seg.uncapped ? (
                              <span className="text-neutral-500">—</span>
                            ) : (
                              formatCurrency(seg.budget)
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {seg.seatCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5">
                            {seg.uncapped ? (
                              <span className="text-neutral-500">No CC budget</span>
                            ) : seg.preventFurtherUsage ? (
                              <span className="text-emerald-700 dark:text-emerald-400">Hard cap</span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">Soft cap</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* Enforcement annotation */}
        {tier === 'blind' ? (
          <div className="rounded-md px-3 py-2.5 text-xs bg-red-50 text-red-900 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900/60 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Warning size={14} weight="fill" className="shrink-0" />
              No spending controls active at the enterprise level
            </div>
            <p className="opacity-80 pl-[22px]">
              {entAmount > 0
                ? 'No alerts, no hard cap. Universal ULB (if set) is the only backstop.'
                : 'No enterprise budget set. Cost-center budgets (if any) are the only enforcement, and unassigned users are unrestricted.'}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-md px-3 py-2 flex items-center gap-2 text-xs font-medium',
              tier === 'hard'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/60'
                : 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60',
            )}
          >
            {tier === 'hard' ? (
              <ShieldCheck size={14} weight="fill" />
            ) : (
              <Warning size={14} weight="fill" />
            )}
            {tier === 'hard'
              ? 'Hard cap · enterprise usage stops at limit'
              : showUncappedGapNote
                ? `Partial cap · ${data.uncappedCount} cost center${data.uncappedCount !== 1 ? 's' : ''} have no per-CC budget`
                : 'Soft cap · alerts on, no hard limit at the enterprise level'}
          </div>
        )}
      </div>
    </div>
  )
}
