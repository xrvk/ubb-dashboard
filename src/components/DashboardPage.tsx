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

  const entAmount = pool.enterpriseBudget
  const overDelta = forecast.projectedEom - (entAmount ?? 0)
  const headroomVsEnt =
    entAmount === null ? null : Math.max(0, entAmount - forecast.spendMtd)

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
          value={formatCurrency(forecast.spendMtd)}
          hint={`Day ${forecast.daysElapsed} of ${forecast.daysInMonth}`}
          icon={<CurrencyDollar size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Projected end-of-month"
          value={formatCurrency(forecast.projectedEom)}
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
              : `${formatPercent(forecast.spendMtd / Math.max(1, entAmount))} of ent budget spent`
          }
          icon={<Receipt size={22} weight="duotone" className="text-neutral-400" />}
        />
      </div>

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

      <LicenseCostCard seatCost={seatCost} entBudget={entAmount} />
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
}: {
  seatCost: ReturnType<typeof seatCostBreakdown>
  entBudget: number | null
}) {
  const ratio =
    entBudget !== null && seatCost.monthlyCost > 0
      ? entBudget / seatCost.monthlyCost
      : null
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
          />
          <LicenseRow
            label="Copilot Enterprise"
            count={seatCost.enterprise}
            unitPrice={COPILOT_ENTERPRISE_LIST_PRICE}
          />
          {seatCost.other > 0 ? (
            <LicenseRow
              label="Other plan"
              count={seatCost.other}
              unitPrice={0}
              unitLabel="—"
            />
          ) : (
            <div />
          )}
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              Monthly license cost
            </div>
            <div className="text-xl font-semibold mt-1 tabular-nums">
              {formatCurrency(seatCost.monthlyCost)}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {seatCost.total.toLocaleString()} total seats
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
          Uses GitHub Copilot{' '}
          <a
            href="https://github.com/features/copilot/plans"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-neutral-800 dark:hover:text-neutral-300"
          >
            list pricing
          </a>{' '}
          (${COPILOT_BUSINESS_LIST_PRICE}/seat/mo Business, ${COPILOT_ENTERPRISE_LIST_PRICE}/seat/mo
          Enterprise) — your negotiated rate may differ.
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
}: {
  label: string
  count: number
  unitPrice: number
  unitLabel?: string
}) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-xl font-semibold mt-1 tabular-nums">
        {count.toLocaleString()}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">
        seats × {unitLabel ?? `$${unitPrice}/mo`} ={' '}
        <span className="tabular-nums">{formatCurrency(count * unitPrice)}</span>
      </div>
    </div>
  )
}
