/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react'
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, ChartPie } from '@phosphor-icons/react'
import { bucketForBudget } from '@/components/UtilizationHistogram'
import { navigateToIndividual } from '@/lib/navigate'
import { utilization } from '@/lib/status'
import { cn, formatCurrencyWhole } from '@/lib/utils'
import type { UserBudget } from '@/lib/api'

/**
 * Three collapsed bands over the five UTIL_BUCKETS used by the histogram.
 * Order matters: the legend, the pie's renderable slices, and the band-band
 * color choice all read from this list, so keeping it in this order matches
 * the visual progression "safe → warning → blocked".
 *
 * `bucketIds` lists which UTIL_BUCKETS each band absorbs. The donut uses
 * this list as the deep-link filter into the Individual ULBs table, where
 * the bucketIds[] filter passes a budget if its bucket id is in the list.
 */
export interface UtilBand {
  id: 'ok' | 'near' | 'at'
  label: string
  description: string
  color: string
  bucketIds: string[]
}

export const UTIL_BANDS: UtilBand[] = [
  {
    id: 'ok',
    label: 'OK',
    description: 'Under 80% of ULB',
    color: '#10b981',
    bucketIds: ['b0-50', 'b50-80'],
  },
  {
    id: 'near',
    label: 'Near cap',
    description: '80–100% of ULB',
    color: '#f59e0b',
    bucketIds: ['b80-90', 'b90-100'],
  },
  {
    id: 'at',
    label: 'At cap',
    description: '100%+ — blocked or over',
    color: '#dc2626',
    bucketIds: ['b100'],
  },
]

export function bandForBudget(b: UserBudget): UtilBand {
  const bucket = bucketForBudget(b)
  return UTIL_BANDS.find(band => band.bucketIds.includes(bucket.id)) ?? UTIL_BANDS[UTIL_BANDS.length - 1]
}

interface Props {
  budgets: UserBudget[]
}

/**
 * Compact 3-band utilization donut for the dashboard. Clicking any slice or
 * the corresponding legend row deep-links into the Individual ULBs page
 * filtered to that band.
 */
export function IndUlbStatusDonut({ budgets }: Props) {
  const data = useMemo(() => {
    const counts = UTIL_BANDS.map(band => ({ ...band, count: 0 }))
    for (const b of budgets) {
      const band = bandForBudget(b)
      const idx = counts.findIndex(c => c.id === band.id)
      if (idx >= 0) counts[idx].count += 1
    }
    return counts
  }, [budgets])

  // Top users at or near cap — the natural "what now?" follow-up to the
  // band summary. We sort by utilization desc (Infinity-utilization users
  // with no budget but spend rank first), then break ties by raw consumed
  // amount so two 100%+ users with the same ratio show the bigger spender
  // first. Cap at 5 to keep the panel scannable. Computed before the
  // empty-state early return so hook order stays stable across renders.
  const topAtRisk = useMemo(() => {
    const eligible = budgets.filter(b => bandForBudget(b).id !== 'ok')
    return [...eligible]
      .sort((a, b) => {
        const ua = utilization(a)
        const ub = utilization(b)
        if (ua !== ub) return ub - ua
        return b.consumedAmount - a.consumedAmount
      })
      .slice(0, 5)
  }, [budgets])

  const total = budgets.length

  // Empty state: no individual ULBs to chart. Render a card-shaped CTA so
  // the dashboard layout doesn't get a gap, and so first-time users have a
  // clear next step.
  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Individual ULB utilization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <ChartPie size={32} weight="duotone" className="text-neutral-400" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm">
              No individual ULBs yet. Set per-user limits so you can see how
              many users are approaching or hitting their cap.
            </p>
            <Button size="sm" variant="outline" onClick={() => navigateToIndividual()}>
              Go to Individual ULBs
              <ArrowRight size={14} weight="bold" />
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const handleBandClick = (band: UtilBand) => {
    navigateToIndividual({ filter: { bucketIds: band.bucketIds } })
  }

  // Recharts requires at least one non-zero slice to render anything; if
  // every band has 0 except one (which is the typical case in tiny demos),
  // it still renders fine. If `total > 0` then by construction at least one
  // band has count > 0 so we don't need a separate guard.
  const nearOrAt = data.filter(d => d.id !== 'ok').reduce((sum, d) => sum + d.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Individual ULB utilization</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
          <div className="relative md:self-center" style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  stroke="none"
                  onClick={(slice: unknown) => {
                    const s = slice as { payload?: UtilBand } | undefined
                    if (s?.payload) handleBandClick(s.payload)
                  }}
                  cursor="pointer"
                >
                  {data.map(d => (
                    <Cell key={d.id} fill={d.color} />
                  ))}
                  <Label
                    position="center"
                    content={({ viewBox }) => {
                      // Recharts' typing of `viewBox` here is loose; we know
                      // the polar shape contributes cx/cy in this context.
                      const cx = (viewBox as { cx?: number } | undefined)?.cx ?? 0
                      const cy = (viewBox as { cy?: number } | undefined)?.cy ?? 0
                      return (
                        <g>
                          <text
                            x={cx}
                            y={cy - 6}
                            textAnchor="middle"
                            className="fill-neutral-900 dark:fill-neutral-100"
                            style={{ fontSize: 22, fontWeight: 600 }}
                          >
                            {total.toLocaleString()}
                          </text>
                          <text
                            x={cx}
                            y={cy + 14}
                            textAnchor="middle"
                            className="fill-neutral-500 dark:fill-neutral-400"
                            style={{ fontSize: 11 }}
                          >
                            users
                          </text>
                        </g>
                      )
                    }}
                  />
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(value, _name, item) => {
                    const p = (item as { payload?: UtilBand })?.payload
                    const numeric = typeof value === 'number' ? value : Number(value ?? 0)
                    const pct = total > 0 ? Math.round((numeric / total) * 100) : 0
                    return [`${numeric.toLocaleString()} (${pct}%)`, p?.label ?? '']
                  }}
                  labelFormatter={() => ''}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col gap-1 md:self-center">
            {data.map(band => {
              const pct = total > 0 ? Math.round((band.count / total) * 100) : 0
              return (
                <button
                  key={band.id}
                  type="button"
                  onClick={() => handleBandClick(band)}
                  className={cn(
                    'group flex w-full items-center justify-between gap-4 rounded-md border border-transparent px-2.5 py-1.5',
                    'text-left transition-colors',
                    'hover:bg-neutral-50 dark:hover:bg-neutral-900 hover:border-neutral-200 dark:hover:border-neutral-800',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                  )}
                  aria-label={`Filter Individual ULBs to ${band.label} (${band.count} users)`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="inline-block h-3 w-3 rounded-sm shrink-0"
                      style={{ backgroundColor: band.color }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight">{band.label}</div>
                      <div className="text-[11px] text-neutral-500 leading-tight truncate">
                        {band.description}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{pct}%</div>
                      <div className="text-[11px] text-neutral-500 tabular-nums">
                        {band.count.toLocaleString()} {band.count === 1 ? 'user' : 'users'}
                      </div>
                    </div>
                    <ArrowRight
                      size={14}
                      weight="bold"
                      className="text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </button>
              )
            })}
          </div>

          <TopAtRiskList users={topAtRisk} totalNearOrAt={nearOrAt} />
        </div>

        <p className="mt-3 text-[11px] text-neutral-500">
          {nearOrAt > 0
            ? `${nearOrAt.toLocaleString()} of ${total.toLocaleString()} users are near or at their individual ULB. Click a slice or row to dive in.`
            : `All ${total.toLocaleString()} users are under 80% of their individual ULB.`}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Top-N list of users at or near their individual ULB cap. Each row links
 * to the Individual ULBs tab with a query pre-filled to that user so the
 * full row (ULB amount, spend, cost center, edit / unblock actions) is one
 * click away. We use a `query` filter rather than a single-record route
 * because the table is already the canonical detail view and supports
 * follow-on edits without leaving the page.
 */
function TopAtRiskList({
  users,
  totalNearOrAt,
}: {
  users: UserBudget[]
  totalNearOrAt: number
}) {
  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-200 dark:border-neutral-800 px-4 py-6 text-center md:self-stretch">
        <div className="text-sm font-medium">No users near or at cap</div>
        <div className="text-[11px] text-neutral-500 max-w-xs">
          Everyone is comfortably under their individual ULB. Nothing to act
          on right now.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Top users to watch
        </h3>
        {totalNearOrAt > users.length ? (
          <button
            type="button"
            onClick={() =>
              navigateToIndividual({
                filter: { bucketIds: ['b80-90', 'b90-100', 'b100'] },
              })
            }
            className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline underline-offset-2"
          >
            View all {totalNearOrAt.toLocaleString()}
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {users.map(b => {
          const ratio = utilization(b)
          const pctText = ratio === Infinity ? 'No ULB' : `${Math.round(ratio * 100)}%`
          const band = bandForBudget(b)
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() =>
                  // Query-by-login pre-fills the Individual ULBs search box,
                  // narrowing the table to this exact user.
                  navigateToIndividual({ filter: { query: b.user } })
                }
                className={cn(
                  'group flex w-full items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1',
                  'text-left transition-colors',
                  'hover:bg-neutral-50 dark:hover:bg-neutral-900 hover:border-neutral-200 dark:hover:border-neutral-800',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                )}
                aria-label={`Open ${b.user} in Individual ULBs (at ${pctText} of ULB)`}
                title={`${b.user} · ${formatCurrencyWhole(b.consumedAmount)} of ${b.budgetAmount > 0 ? formatCurrencyWhole(b.budgetAmount) : 'no ULB'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: band.color }}
                    aria-hidden
                  />
                  <span className="text-sm truncate">{b.user}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-right">
                  <div>
                    <div
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: band.color }}
                    >
                      {pctText}
                    </div>
                    <div className="text-[10px] text-neutral-500 tabular-nums">
                      {formatCurrencyWhole(b.consumedAmount)}
                      {b.budgetAmount > 0 ? ` / ${formatCurrencyWhole(b.budgetAmount)}` : ''}
                    </div>
                  </div>
                  <ArrowRight
                    size={12}
                    weight="bold"
                    className="text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
