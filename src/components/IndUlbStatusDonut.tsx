/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react'
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, ChartPie } from '@phosphor-icons/react'
import { bucketForBudget } from '@/components/UtilizationHistogram'
import { navigateToIndividual } from '@/lib/navigate'
import { cn } from '@/lib/utils'
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
        <div className="grid gap-4 md:grid-cols-[200px_1fr] md:items-center">
          <div className="relative" style={{ height: 180 }}>
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

          <div className="flex flex-col gap-2">
            {data.map(band => {
              const pct = total > 0 ? Math.round((band.count / total) * 100) : 0
              return (
                <button
                  key={band.id}
                  type="button"
                  onClick={() => handleBandClick(band)}
                  className={cn(
                    'group flex items-center justify-between gap-3 rounded-md border border-transparent px-2.5 py-1.5',
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
                      <div className="text-sm font-semibold tabular-nums">{band.count.toLocaleString()}</div>
                      <div className="text-[11px] text-neutral-500 tabular-nums">{pct}%</div>
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
