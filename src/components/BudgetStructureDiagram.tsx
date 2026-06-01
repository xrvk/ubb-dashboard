import { useMemo } from 'react'
import {
  Buildings,
  Stack,
  ShieldCheck,
  Warning,
  TreeStructure,
} from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { formatCurrency, formatCurrencyShort, cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Sepia-tinted adaptation of the Budget Structure diagram from
 * https://github.com/xrvk/copilot-budget-command-calculator
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
    universalUbb,
  } = useCredentials()

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

  // Compact label rendered inside a bar segment. Name is the primary signal
  // (so users can identify which CC each block represents); the amount is
  // appended in $1.2k shorthand only when there's room. Below ~10% width
  // there's no useful room for text, so we render nothing and rely on the
  // tooltip.
  function segmentLabel(seg: { name: string; budget: number; uncapped: boolean }, percent: number): string {
    if (percent < 10) return ''
    const suffix = seg.uncapped ? 'no cap' : formatCurrencyShort(seg.budget)
    if (percent < 22) return seg.name
    return `${seg.name} · ${suffix}`
  }

  // Effective cap for an uncapped CC = its Copilot seat count × universal UBB.
  // This is the implicit ceiling once universal UBB is set; without it the CC
  // has no per-CC bound at all.
  function uncappedBackstopLine(seatCount: number): string | null {
    const ubb = universalUbb?.budgetAmount ?? null
    if (ubb === null || ubb <= 0 || seatCount <= 0) return null
    return `Effective cap: ${seatCount.toLocaleString()} seat${seatCount === 1 ? '' : 's'} × ${formatCurrencyShort(ubb)} = ${formatCurrencyShort(seatCount * ubb)}`
  }

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

  // Shared utility classes — sepia palette
  const cardCls =
    'rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
  const entContainerCls = !excludeCcUsage
    ? 'rounded-xl border-2 border-emerald-600/30 bg-emerald-600/5 dark:border-emerald-500/30 dark:bg-emerald-500/5 p-4 space-y-3'
    : 'rounded-lg border border-emerald-600/30 bg-emerald-600/5 dark:border-emerald-500/30 dark:bg-emerald-500/5 p-3 space-y-2'

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cardCls}>
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TreeStructure size={18} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
            Budget Structure
          </div>
          <div className="text-xs text-neutral-500">
            {excludeCcUsage ? 'Cost center exclusion is on' : null}
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
                      <Tooltip key={seg.id}>
                        <TooltipTrigger asChild>
                          <div
                            className="h-full flex items-center justify-start px-1.5 text-[10px] font-medium bg-amber-500/25 text-amber-900 dark:bg-amber-400/25 dark:text-amber-200 cursor-help transition-all duration-200 truncate"
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
                            {segmentLabel(seg, seg.percent)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="font-medium">{seg.name}</div>
                          <div className="opacity-80">
                            {formatCurrency(seg.budget)} sub-limit · {seg.preventFurtherUsage ? 'Hard cap' : 'Soft cap'}
                          </div>
                          <div className="opacity-70 text-[10px] mt-0.5">
                            {seg.seatCount.toLocaleString()} Copilot seat{seg.seatCount === 1 ? '' : 's'}
                          </div>
                        </TooltipContent>
                      </Tooltip>
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
                    <Tooltip key={seg.id}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'h-full flex items-center justify-start px-1.5 text-[10px] font-medium cursor-help transition-all duration-200 truncate',
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
                          {segmentLabel(seg, seg.percent)}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="font-medium">{seg.name}</div>
                        <div className="opacity-80">
                          {seg.uncapped
                            ? 'No stop budget on Cost Center'
                            : `${formatCurrency(seg.budget)} independent cap · ${seg.preventFurtherUsage ? 'Hard cap' : 'Soft cap'}`}
                        </div>
                        {seg.uncapped && uncappedBackstopLine(seg.seatCount) ? (
                          <div className="opacity-80 text-[10px] mt-0.5">
                            {uncappedBackstopLine(seg.seatCount)}
                          </div>
                        ) : null}
                        <div className="opacity-70 text-[10px] mt-0.5">
                          {seg.seatCount.toLocaleString()} Copilot seat{seg.seatCount === 1 ? '' : 's'}
                        </div>
                      </TooltipContent>
                    </Tooltip>
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

        {/* Cost-center list is rendered (editable) by BudgetPlanner immediately
            below this diagram — kept consolidated to avoid duplication. */}

        {/* Actionable items — info-style alert listing things the user can fix */}
        {(() => {
          interface Item {
            severity: 'red' | 'amber' | 'info'
            text: string
          }
          const items: Item[] = []

          if (!enterpriseBudget) {
            items.push({
              severity: 'amber',
              text: 'No enterprise budget set — add one to constrain unassigned users.',
            })
          } else {
            if (!entHardCap && !entWillAlert) {
              items.push({
                severity: 'red',
                text: 'Enterprise budget has neither a hard cap nor alerts — enable at least one in GitHub admin.',
              })
            } else if (!entHardCap) {
              items.push({
                severity: 'amber',
                text: 'Enterprise budget is soft cap only — enable hard cap to enforce the limit.',
              })
            }
          }

          // Note: "cost center has no per-CC budget" is intentionally NOT
          // surfaced here. Each uncapped row already shows a "Set budget"
          // CTA in the Cost centers card directly below, so duplicating it
          // here as a bullet would just be noise.

          const softCapped = data.capped.filter(s => s.affectsCopilot && !s.preventFurtherUsage)
          if (softCapped.length > 0) {
            items.push({
              severity: 'amber',
              text: `${softCapped.length} cost-center budget${softCapped.length === 1 ? '' : 's'} ${softCapped.length === 1 ? 'is' : 'are'} on soft cap — flip to hard cap (turn on “Stop usage when budget limit is reached”) to actually stop metered charges.`,
            })
          }

          if (items.length === 0) {
            return (
              <div className="rounded-md px-3 py-2 flex items-center gap-2 text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/60">
                <ShieldCheck size={14} weight="fill" />
                No outstanding actionable items — budget enforcement looks solid.
              </div>
            )
          }

          return (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <Warning size={14} weight="fill" />
                {items.length} actionable item{items.length === 1 ? '' : 's'}
              </div>
              <ul className="space-y-1 pl-[22px] text-xs">
                {items.map((it, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 rounded-full shrink-0',
                        it.severity === 'red'
                          ? 'bg-red-500'
                          : it.severity === 'amber'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500',
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        it.severity === 'red'
                          ? 'text-red-900 dark:text-red-200'
                          : 'text-amber-900 dark:text-amber-100',
                      )}
                    >
                      {it.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })()}
        </div>
      </div>
    </TooltipProvider>
  )
}
