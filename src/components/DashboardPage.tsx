import { useMemo } from 'react'
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Buildings,
  CurrencyDollar,
  Receipt,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConstraintsBanner } from '@/components/ConstraintsBanner'
import { useCredentials } from '@/hooks/use-credentials'
import { computePoolSplit } from '@/lib/poolSplit'
import {
  COPILOT_BUSINESS_LIST_PRICE,
  COPILOT_ENTERPRISE_LIST_PRICE,
  seatCostBreakdown,
} from '@/lib/pricing'
import { forecastSummary } from '@/lib/status'
import { projectMonthlyBudget } from '@/lib/projection'
import { formatCurrency, formatCurrencyShort, formatPercent, cn } from '@/lib/utils'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
} from '@/lib/navEvents'

/**
 * Top-level Dashboard. Single-screen rollup of the enterprise's AI credit
 * posture: where the pool is committed, how budgets compare to effective
 * caps, where spend is trending, ULB coverage, and license cost context.
 *
 * Every section here is read-only — editing happens on the dedicated tabs
 * (Enterprise Budgets, Universal ULB, Individual ULBs) — so the dashboard
 * can stay focused on signal rather than form fields.
 */
export function DashboardPage() {
  const {
    enterpriseBudget,
    universalUlb,
    costCenters,
    costCenterBudgetsByName,
    seats,
    budgets,
    loginToCostCenter,
    usageSummary,
  } = useCredentials()

  const pool = useMemo(
    () =>
      computePoolSplit({
        enterpriseBudget,
        universalUlb,
        costCenters,
        ccBudgetsByName: costCenterBudgetsByName,
        seats,
        userBudgets: budgets,
      }),
    [enterpriseBudget, universalUlb, costCenters, costCenterBudgetsByName, seats, budgets],
  )

  const forecast = useMemo(() => forecastSummary(budgets), [budgets])
  const seatCost = useMemo(() => seatCostBreakdown(seats), [seats])

  /** How many seats are covered by an individual ULB (have a user-scope budget). */
  const indCoverage = useMemo(() => {
    const seatLogins = new Set(seats.map(s => s.login.toLowerCase()))
    let withInd = 0
    for (const b of budgets) {
      if (b.user && seatLogins.has(b.user.toLowerCase())) withInd += 1
    }
    return { withInd, total: seats.length }
  }, [seats, budgets])

  /** Seats that fall back to the universal ULB (no individual override). */
  const universalCoverage = useMemo(() => {
    const indLogins = new Set(budgets.filter(b => b.user).map(b => b.user.toLowerCase()))
    let covered = 0
    for (const s of seats) {
      if (!indLogins.has(s.login.toLowerCase())) covered += 1
    }
    return covered
  }, [seats, budgets])

  const ccCount = useMemo(() => {
    const set = new Set<string>()
    for (const r of loginToCostCenter.values()) if (r) set.add(r.cc.id)
    return set.size
  }, [loginToCostCenter])

  /**
   * Forecast breakdown across the two budget scopes that report
   * `consumed_amount` via the budgets API:
   *   • `multi_user_customer` (universal ULB)
   *   • `user` (individual ULBs)
   *
   * Note: `enterprise`- and `cost_center`-scope budgets DO NOT report
   * consumed_amount (verified empirically — see probe-findings.md). Any
   * Copilot user whose spend is absorbed by a CC budget without an
   * individual ULB is invisible here. We count those seats so the card can
   * be honest about coverage.
   */
  const trackedForecast = useMemo(() => {
    const univMtd = universalUlb?.consumedAmount ?? 0
    const univProj = projectMonthlyBudget(univMtd, 0).projectedMonthTotal
    const indMtd = forecast.spendMtd
    const indProj = forecast.projectedEom
    // Seats whose consumption flows through a CC budget rather than universal
    // or an individual ULB — these are the "untrackable-by-budgets-API" ones.
    const indLogins = new Set(budgets.filter(b => b.user).map(b => b.user.toLowerCase()))
    let untrackedSeats = 0
    for (const s of seats) {
      if (indLogins.has(s.login.toLowerCase())) continue
      const cc = loginToCostCenter.get(s.login.toLowerCase())?.cc
      if (cc && costCenterBudgetsByName.has(cc.name.toLowerCase())) untrackedSeats += 1
    }
    // When the billing usage summary is available it's the truth-of-record
    // for total MTD AIC spend — including the CC-routed slice the budgets API
    // can't report. We project it forward with the same straight-line model.
    const actualMtd = usageSummary?.aiCreditsNet ?? null
    const actualProjected =
      actualMtd !== null ? projectMonthlyBudget(actualMtd, 0).projectedMonthTotal : null
    return {
      universal: { mtd: univMtd, projected: univProj, hasBudget: !!universalUlb },
      individual: { mtd: indMtd, projected: indProj, count: indCoverage.withInd },
      trackedMtd: univMtd + indMtd,
      trackedProjected: univProj + indProj,
      totalMtd: actualMtd ?? univMtd + indMtd,
      totalProjected: actualProjected ?? univProj + indProj,
      hasActual: actualMtd !== null,
      untrackedSeats,
    }
  }, [
    universalUlb,
    forecast.spendMtd,
    forecast.projectedEom,
    indCoverage.withInd,
    budgets,
    seats,
    loginToCostCenter,
    costCenterBudgetsByName,
    usageSummary,
  ])

  const entAmount = pool.enterpriseBudget
  const overDelta = trackedForecast.totalProjected - (entAmount ?? 0)
  const headroomVsEnt =
    entAmount === null ? null : Math.max(0, entAmount - trackedForecast.totalMtd)

  return (
    <div className="grid gap-6">
      <ConstraintsBanner />

      {/* Hero KPIs */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-4">
        <KpiTile
          label="Enterprise budget"
          value={entAmount === null ? 'Not set' : formatCurrency(entAmount)}
          hint={
            entAmount === null
              ? 'No enterprise-scope ai_credits budget'
              : `${costCenters.length.toLocaleString()} cost centers · ${seats.length.toLocaleString()} seats`
          }
          icon={<Buildings size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Spend to date"
          value={formatCurrency(trackedForecast.totalMtd)}
          hint={
            trackedForecast.hasActual
              ? `Day ${forecast.daysElapsed} of ${forecast.daysInMonth} · billing usage API`
              : `Day ${forecast.daysElapsed} of ${forecast.daysInMonth} · tracked scopes only`
          }
          icon={<CurrencyDollar size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Projected end-of-month"
          value={formatCurrency(trackedForecast.totalProjected)}
          hint={
            entAmount === null
              ? 'No enterprise cap to compare against'
              : overDelta > 0
                ? `${formatCurrency(overDelta)} over ent budget`
                : `${formatCurrency(-overDelta)} under ent budget`
          }
          tone={entAmount !== null && overDelta > 0 ? 'warn' : 'neutral'}
          icon={<TrendUp size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Headroom today"
          value={headroomVsEnt === null ? '—' : formatCurrency(headroomVsEnt)}
          hint={
            entAmount === null
              ? 'Requires enterprise budget'
              : `${formatPercent(trackedForecast.totalMtd / Math.max(1, entAmount))} of ent budget spent`
          }
          icon={<Receipt size={22} weight="duotone" className="text-neutral-400" />}
        />
      </div>

      <ForecastBreakdownCard tracked={trackedForecast} entBudget={entAmount} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PoolSplitCard pool={pool} />
        <BudgetVsCapCard pool={pool} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <UlbStateCard
          title="Universal ULB"
          value={
            universalUlb ? formatCurrency(universalUlb.budgetAmount) : 'Not set'
          }
          subtitle={
            universalUlb
              ? `${universalCoverage.toLocaleString()} of ${seats.length.toLocaleString()} seats fall back to this cap`
              : `${seats.length.toLocaleString()} seats have no universal fallback`
          }
          ctaLabel="Manage universal ULB"
          onCta={() => window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT))}
          icon={<UsersThree size={20} weight="duotone" className="text-neutral-400" />}
          tone={universalUlb ? 'neutral' : 'warn'}
        />
        <UlbStateCard
          title="Individual ULBs"
          value={`${indCoverage.withInd.toLocaleString()} / ${indCoverage.total.toLocaleString()}`}
          subtitle={
            forecast.totalBudgeted > 0
              ? `${formatCurrency(forecast.totalBudgeted)} allocated · ${forecast.alreadyOver + forecast.projectedOver} at risk by EoM`
              : 'No individual overrides set'
          }
          ctaLabel="Manage individual ULBs"
          onCta={() =>
            window.dispatchEvent(
              new CustomEvent(NAV_TO_INDIVIDUAL_EVENT, { detail: {} }),
            )
          }
          icon={<UsersThree size={20} weight="duotone" className="text-neutral-400" />}
        />
        <UlbStateCard
          title="Cost centers routing Copilot"
          value={ccCount.toLocaleString()}
          subtitle={`${pool.costCenters.filter(s => s.budgetAmount !== null).length} capped · ${pool.costCenters.filter(s => s.budgetAmount === null).length} uncapped (ULB-bounded)`}
          ctaLabel="Edit enterprise budgets"
          onCta={() => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT))}
          icon={<Buildings size={20} weight="duotone" className="text-neutral-400" />}
        />
      </div>

      <LicenseCostCard seatCost={seatCost} entBudget={entAmount} usage={usageSummary} />
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  tone?: 'neutral' | 'warn'
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
          <div
            className={cn(
              'text-2xl font-semibold mt-1',
              tone === 'warn' && 'text-amber-600 dark:text-amber-400',
            )}
          >
            {value}
          </div>
          {hint ? <div className="text-xs text-neutral-500 mt-1">{hint}</div> : null}
        </div>
        {icon}
      </CardContent>
    </Card>
  )
}

// Color tokens for the spend-forecast stacked bar — kept distinct from the
// pool donut palette so the two charts read as different metrics.
const COLOR_UNIVERSAL = '#6366f1' // indigo-500
const COLOR_INDIVIDUAL = '#10b981' // emerald-500
const COLOR_CC_ROUTED = '#f59e0b' // amber-500

interface TrackedForecast {
  universal: { mtd: number; projected: number; hasBudget: boolean }
  individual: { mtd: number; projected: number; count: number }
  /** Sum of tracked scopes only (universal + individual). */
  trackedMtd: number
  trackedProjected: number
  /** Real enterprise total when usage API is available, else trackedMtd. */
  totalMtd: number
  totalProjected: number
  /** True when the totals above come from the billing usage summary API. */
  hasActual: boolean
  untrackedSeats: number
}

function ForecastBreakdownCard({
  tracked,
  entBudget,
}: {
  tracked: TrackedForecast
  entBudget: number | null
}) {
  const pct = (v: number, total: number) =>
    total > 0 ? `${Math.round((v / total) * 100)}%` : '—'
  // The denominator for the bar is the actual enterprise total when present
  // (so the bar can show what the budgets API can't see); otherwise it's the
  // tracked-only sum.
  const denom = Math.max(1, tracked.totalProjected)
  const univPctW = (tracked.universal.projected / denom) * 100
  const indPctW = (tracked.individual.projected / denom) * 100
  // CC-routed = whatever the billing API reports beyond what we can attribute
  // to universal + individual scopes. Clamp to zero so demo/edge cases where
  // tracked > actual don't render a negative slice.
  const ccRoutedProjected = tracked.hasActual
    ? Math.max(0, tracked.totalProjected - tracked.universal.projected - tracked.individual.projected)
    : 0
  const ccRoutedMtd = tracked.hasActual
    ? Math.max(0, tracked.totalMtd - tracked.universal.mtd - tracked.individual.mtd)
    : 0
  const ccPctW = (ccRoutedProjected / denom) * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecasted end-of-month spend</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className={cn('grid gap-4', tracked.hasActual ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
          <BreakdownStat
            color={COLOR_UNIVERSAL}
            label="Universal ULB"
            mtd={tracked.universal.mtd}
            projected={tracked.universal.projected}
            sub={
              tracked.universal.hasBudget
                ? `${pct(tracked.universal.projected, tracked.totalProjected)} of total`
                : 'No universal ULB set'
            }
          />
          <BreakdownStat
            color={COLOR_INDIVIDUAL}
            label="Individual ULBs"
            mtd={tracked.individual.mtd}
            projected={tracked.individual.projected}
            sub={
              tracked.individual.count > 0
                ? `${tracked.individual.count.toLocaleString()} users · ${pct(tracked.individual.projected, tracked.totalProjected)} of total`
                : 'No individual overrides set'
            }
          />
          {tracked.hasActual ? (
            <BreakdownStat
              color={COLOR_CC_ROUTED}
              label="CC-routed (other)"
              mtd={ccRoutedMtd}
              projected={ccRoutedProjected}
              sub={
                ccRoutedProjected > 0
                  ? `${pct(ccRoutedProjected, tracked.totalProjected)} of total · not in budgets API`
                  : 'All spend attributed to a tracked scope'
              }
            />
          ) : null}
          <div className="grid gap-1">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {tracked.hasActual ? 'Enterprise total' : 'Tracked total'}
            </div>
            <div className="text-2xl font-semibold">
              {formatCurrency(tracked.totalProjected)}
            </div>
            <div className="text-xs text-neutral-500">
              MTD {formatCurrency(tracked.totalMtd)}
              {entBudget !== null
                ? ` · ${pct(tracked.totalProjected, entBudget)} of ent budget`
                : ''}
            </div>
          </div>
        </div>

        {/* Stacked progress bar */}
        <div>
          <div className="flex w-full h-3 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
            {tracked.universal.projected > 0 ? (
              <div
                className="h-full"
                style={{ width: `${univPctW}%`, backgroundColor: COLOR_UNIVERSAL }}
                title={`Universal ULB · ${formatCurrency(tracked.universal.projected)}`}
              />
            ) : null}
            {tracked.individual.projected > 0 ? (
              <div
                className="h-full"
                style={{ width: `${indPctW}%`, backgroundColor: COLOR_INDIVIDUAL }}
                title={`Individual ULBs · ${formatCurrency(tracked.individual.projected)}`}
              />
            ) : null}
            {ccRoutedProjected > 0 ? (
              <div
                className="h-full"
                style={{ width: `${ccPctW}%`, backgroundColor: COLOR_CC_ROUTED }}
                title={`CC-routed (other) · ${formatCurrency(ccRoutedProjected)}`}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-neutral-600 dark:text-neutral-400">
            <LegendDot color={COLOR_UNIVERSAL} label="Universal ULB" />
            <LegendDot color={COLOR_INDIVIDUAL} label="Individual ULBs" />
            {tracked.hasActual ? (
              <LegendDot color={COLOR_CC_ROUTED} label="CC-routed (other)" />
            ) : null}
          </div>
        </div>

        {tracked.hasActual ? (
          <div className="text-[11px] text-neutral-500">
            Totals from the billing usage summary API (
            <code className="font-mono">copilot_ai_unit</code> SKU). Universal +
            Individual rows come from the budgets API; the &ldquo;CC-routed&rdquo;
            slice is the residual that flows through cost-center budgets — those
            scopes don&rsquo;t report <code className="font-mono">consumed_amount</code>.
          </div>
        ) : tracked.untrackedSeats > 0 ? (
          <div className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-xs">
            {tracked.untrackedSeats.toLocaleString()} seat
            {tracked.untrackedSeats === 1 ? ' is' : 's are'} covered by a cost-center
            budget with no individual ULB — their spend isn&rsquo;t included above.
            The budgets API doesn&rsquo;t report{' '}
            <code className="font-mono">consumed_amount</code> for{' '}
            <code className="font-mono">enterprise</code>- or{' '}
            <code className="font-mono">cost_center</code>-scope budgets. Grant
            this PAT enhanced-billing access to pull the real totals from the
            usage summary API.
          </div>
        ) : (
          <div className="text-[11px] text-neutral-500">
            Spend is summed from <code className="font-mono">multi_user_customer</code>{' '}
            and <code className="font-mono">user</code> budget scopes — the only
            two that report <code className="font-mono">consumed_amount</code>.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BreakdownStat({
  color,
  label,
  mtd,
  projected,
  sub,
}: {
  color: string
  label: string
  mtd: number
  projected: number
  sub: string
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </div>
      <div className="text-2xl font-semibold">{formatCurrency(projected)}</div>
      <div className="text-xs text-neutral-500">
        MTD {formatCurrency(mtd)} → projected EoM
      </div>
      <div className="text-[11px] text-neutral-500">{sub}</div>
    </div>
  )
}

// Stable palette for the pool donut; first N colors apply to CC slices, the
// last two are reserved for "unassigned" + "headroom" so they always look
// distinct from CCs no matter how many you have.
const CC_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#a855f7', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
]
const COLOR_UNASSIGNED = '#737373' // neutral-500
const COLOR_HEADROOM = '#d4d4d8' // neutral-300 (light gap chunk)
const COLOR_OVERFLOW = '#dc2626' // red-600 (when committed > ent budget)

interface DonutDatum {
  key: string
  name: string
  value: number
  color: string
  kind: 'cc-capped' | 'cc-uncapped' | 'unassigned' | 'headroom' | 'overflow'
  /** Optional secondary metric to show in tooltip (e.g. CC budget). */
  meta?: string
}

function PoolSplitCard({ pool }: { pool: ReturnType<typeof computePoolSplit> }) {
  const data = useMemo<DonutDatum[]>(() => {
    const arr: DonutDatum[] = []
    pool.costCenters.forEach((s, i) => {
      arr.push({
        key: s.costCenterId,
        name: s.name,
        value: s.effectiveDraw,
        color: CC_COLORS[i % CC_COLORS.length],
        kind: s.budgetAmount === null ? 'cc-uncapped' : 'cc-capped',
        meta:
          s.budgetAmount === null
            ? `${s.seatCount} seats · uncapped, ULB ceiling ${formatCurrencyShort(s.ulbCeiling)}`
            : `${s.seatCount} seats · budget ${formatCurrencyShort(s.budgetAmount)}`,
      })
    })
    if (pool.unassignedTotal > 0) {
      arr.push({
        key: 'unassigned',
        name: 'Unassigned seats',
        value: pool.unassignedTotal,
        color: COLOR_UNASSIGNED,
        kind: 'unassigned',
        meta: 'Seats not routed to any cost center',
      })
    }
    if (pool.headroom > 0) {
      arr.push({
        key: 'headroom',
        name: 'Headroom',
        value: pool.headroom,
        color: COLOR_HEADROOM,
        kind: 'headroom',
        meta: 'Unallocated portion of the enterprise budget',
      })
    }
    if (pool.overAllocated && pool.enterpriseBudget !== null) {
      const overshoot =
        pool.cappedTotal + pool.uncappedTotal + pool.unassignedTotal - pool.enterpriseBudget
      arr.push({
        key: 'overflow',
        name: 'Over-allocated',
        value: overshoot,
        color: COLOR_OVERFLOW,
        kind: 'overflow',
        meta: 'Committed draws exceed the enterprise budget',
      })
    }
    return arr
  }, [pool])

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI credit pool split</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyChart message="No cost centers route Copilot today, and no enterprise budget is set." />
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_auto] items-center">
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={1}
                    isAnimationActive={false}
                  >
                    {data.map(d => (
                      <Cell key={d.key} fill={d.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid #e5e5e5',
                    }}
                    formatter={(value: number, _name: string, item) => {
                      const datum = item?.payload as DonutDatum | undefined
                      const pct = total > 0 ? (value / total) * 100 : 0
                      return [
                        `${formatCurrency(value)} (${pct.toFixed(1)}%)${datum?.meta ? `\n${datum.meta}` : ''}`,
                        datum?.name ?? '',
                      ]
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-neutral-600 dark:text-neutral-400 space-y-1.5 min-w-[180px]">
              <Stat
                label="Enterprise budget"
                value={
                  pool.enterpriseBudget === null
                    ? 'Not set'
                    : formatCurrency(pool.enterpriseBudget)
                }
              />
              <Stat label="Capped CC draws" value={formatCurrency(pool.cappedTotal)} />
              <Stat
                label="Uncapped (ULB ceiling)"
                value={formatCurrency(pool.uncappedTotal)}
              />
              {pool.unassignedTotal > 0 ? (
                <Stat
                  label="Unassigned seats"
                  value={formatCurrency(pool.unassignedTotal)}
                />
              ) : null}
              {pool.enterpriseBudget !== null ? (
                <Stat
                  label={pool.overAllocated ? 'Over-allocated' : 'Headroom'}
                  value={
                    pool.overAllocated
                      ? `+${formatCurrency(
                          pool.cappedTotal +
                            pool.uncappedTotal +
                            pool.unassignedTotal -
                            pool.enterpriseBudget,
                        )}`
                      : formatCurrency(pool.headroom)
                  }
                  tone={pool.overAllocated ? 'warn' : 'neutral'}
                />
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warn'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span
        className={cn(
          'font-medium tabular-nums',
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-800 dark:text-neutral-200',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function BudgetVsCapCard({ pool }: { pool: ReturnType<typeof computePoolSplit> }) {
  const data = useMemo(
    () =>
      pool.costCenters.map(s => ({
        name: s.name,
        budget: s.budgetAmount ?? 0,
        ulbCeiling: s.ulbCeiling,
        uncapped: s.budgetAmount === null,
      })),
    [pool.costCenters],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget vs. effective cap (ULB ceiling)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart message="No cost centers route Copilot today." />
        ) : (
          <>
            <div style={{ height: Math.max(180, data.length * 38 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  barGap={2}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#888"
                    fontSize={11}
                    tickFormatter={v => formatCurrencyShort(Number(v))}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#888"
                    fontSize={11}
                    width={110}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid #e5e5e5',
                    }}
                    formatter={(value: number, name: string, item) => {
                      const datum = item?.payload as { uncapped: boolean } | undefined
                      if (name === 'budget' && datum?.uncapped) {
                        return ['Uncapped', 'CC budget']
                      }
                      return [formatCurrency(Number(value)), name === 'budget' ? 'CC budget' : 'ULB ceiling']
                    }}
                  />
                  <Bar dataKey="budget" fill="#3b82f6" name="CC budget" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="ulbCeiling" fill="#10b981" name="ULB ceiling" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-neutral-500">
              <LegendDot color="#3b82f6" label="CC budget" />
              <LegendDot color="#10b981" label="ULB ceiling (Σ seat caps)" />
              <span className="ml-auto">
                When ULB ceiling &lt; budget, ULBs bind spend below the budget.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="text-xs text-neutral-500 dark:text-neutral-400 py-12 text-center">
      {message}
    </div>
  )
}

function UlbStateCard({
  title,
  value,
  subtitle,
  ctaLabel,
  onCta,
  icon,
  tone = 'neutral',
}: {
  title: string
  value: string
  subtitle: string
  ctaLabel: string
  onCta: () => void
  icon?: React.ReactNode
  tone?: 'neutral' | 'warn'
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{title}</div>
            <div
              className={cn(
                'text-xl font-semibold mt-1',
                tone === 'warn' && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {value}
            </div>
            <div className="text-xs text-neutral-500 mt-1">{subtitle}</div>
          </div>
          {icon}
        </div>
        <Button variant="outline" size="sm" onClick={onCta} className="w-full">
          {ctaLabel}
        </Button>
      </CardContent>
    </Card>
  )
}

function LicenseCostCard({
  seatCost,
  entBudget,
  usage,
}: {
  seatCost: ReturnType<typeof seatCostBreakdown>
  entBudget: number | null
  usage: import('@/lib/api').CopilotUsageSummary | null
}) {
  // When the billing usage summary is available, the prorated month-to-date
  // license cost reported by GitHub is more accurate than our list-price
  // estimate (it accounts for negotiated discounts, mid-month seat moves,
  // and the actual day-count). Surface that as the headline.
  const billedMtd =
    usage !== null ? usage.cbLicenseNet + usage.ceLicenseNet : null
  const headlineCost = billedMtd ?? seatCost.monthlyCost
  const ratio =
    entBudget !== null && headlineCost > 0 ? entBudget / headlineCost : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>License cost vs. AI credit budget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-4">
          <LicenseRow
            label="Copilot Business"
            count={seatCost.business}
            unitPrice={COPILOT_BUSINESS_LIST_PRICE}
            billed={usage?.cbLicenseNet ?? null}
          />
          <LicenseRow
            label="Copilot Enterprise"
            count={seatCost.enterprise}
            unitPrice={COPILOT_ENTERPRISE_LIST_PRICE}
            billed={usage?.ceLicenseNet ?? null}
          />
          {seatCost.other > 0 ? (
            <LicenseRow
              label="Other plan"
              count={seatCost.other}
              unitPrice={0}
              unitLabel="—"
              billed={null}
            />
          ) : (
            <div />
          )}
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              {billedMtd !== null ? 'Billed month-to-date' : 'Monthly license cost'}
            </div>
            <div className="text-xl font-semibold mt-1 tabular-nums">
              {formatCurrency(headlineCost)}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {billedMtd !== null
                ? `${seatCost.total.toLocaleString()} seats · est. ${formatCurrency(seatCost.monthlyCost)} full month`
                : `${seatCost.total.toLocaleString()} total seats`}
            </div>
          </div>
        </div>
        {ratio !== null ? (
          <div className="text-xs text-neutral-600 dark:text-neutral-400">
            Enterprise AI credit budget ({formatCurrency(entBudget ?? 0)}) is{' '}
            <span className="font-medium tabular-nums">{formatPercent(ratio)}</span> of
            monthly license spend.
          </div>
        ) : null}
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500 leading-snug">
          {billedMtd !== null ? (
            <>
              &ldquo;Billed&rdquo; values come from the billing usage summary API
              (prorated, post-discount). Full-month estimate uses GitHub Copilot{' '}
              <a
                href="https://github.com/features/copilot/plans"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-800 dark:hover:text-neutral-300"
              >
                list pricing
              </a>
              {' '}(${COPILOT_BUSINESS_LIST_PRICE}/seat/mo Business, $
              {COPILOT_ENTERPRISE_LIST_PRICE}/seat/mo Enterprise).
            </>
          ) : (
            <>
              Uses GitHub Copilot{' '}
              <a
                href="https://github.com/features/copilot/plans"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-800 dark:hover:text-neutral-300"
              >
                list pricing
              </a>{' '}
              (${COPILOT_BUSINESS_LIST_PRICE}/seat/mo Business, $
              {COPILOT_ENTERPRISE_LIST_PRICE}/seat/mo Enterprise) — your negotiated
              rate may differ.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}

function LicenseRow({
  label,
  count,
  unitPrice,
  unitLabel,
  billed,
}: {
  label: string
  count: number
  unitPrice: number
  unitLabel?: string
  /** Actual MTD billed amount from the usage summary API, when available. */
  billed: number | null
}) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-xl font-semibold mt-1 tabular-nums">
        {count.toLocaleString()}
      </div>
      {billed !== null ? (
        <div className="text-xs text-neutral-500 mt-0.5">
          <span className="tabular-nums">{formatCurrency(billed)}</span> billed MTD
          <span className="text-neutral-400">
            {' · '}~{unitLabel ?? `$${unitPrice}/mo`}
          </span>
        </div>
      ) : (
        <div className="text-xs text-neutral-500 mt-0.5">
          seats × {unitLabel ?? `$${unitPrice}/mo`} ={' '}
          <span className="tabular-nums">{formatCurrency(count * unitPrice)}</span>
        </div>
      )}
    </div>
  )
}
