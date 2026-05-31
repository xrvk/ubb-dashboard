import { useMemo } from 'react'
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import {
  Buildings,
  CurrencyDollar,
  Receipt,
  TrendUp,
} from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCredentials } from '@/hooks/use-credentials'
import { computePoolSplit } from '@/lib/poolSplit'
import {
  COPILOT_BUSINESS_LIST_PRICE,
  COPILOT_ENTERPRISE_LIST_PRICE,
  includedAiCredits,
  seatCostBreakdown,
} from '@/lib/pricing'
import { forecastSummary } from '@/lib/status'
import { projectMonthlyBudget } from '@/lib/projection'
import { formatCurrency, formatPercent, cn } from '@/lib/utils'
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
      {/* § 1 — Current state: pool, licenses, used so far. */}
      <SectionHeader number={1} title="AI credit pool & licenses" />
      <PoolAndLicensesCard
        seatCost={seatCost}
        usage={usageSummary}
        meteredMtd={usageSummary?.aiCreditsNet ?? null}
        ulbDrawnMtd={trackedForecast.universal.mtd + trackedForecast.individual.mtd}
      />

      {/* § 2 — Metered spend so far + forecast. KPIs scope to metered
          charges (which is what the enterprise budget governs); the
          forecast card breaks them down across the budget scopes the API
          does and doesn't report. */}
      <SectionHeader number={2} title="Metered charges" />
      <div className="grid gap-3 grid-cols-1 md:grid-cols-4">
        <KpiTile
          label="Enterprise budget"
          value={entAmount === null ? 'Not set' : formatCurrency(entAmount)}
          hint={
            entAmount === null
              ? 'No enterprise-scope budget'
              : `Caps metered charges · ${seats.length.toLocaleString()} seats`
          }
          icon={<Buildings size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Metered MTD"
          value={formatCurrency(trackedForecast.totalMtd)}
          hint={
            trackedForecast.hasActual
              ? `Day ${forecast.daysElapsed} of ${forecast.daysInMonth}`
              : `Day ${forecast.daysElapsed} of ${forecast.daysInMonth} · ULB-scope proxy`
          }
          icon={<CurrencyDollar size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Forecast"
          value={formatCurrency(trackedForecast.totalProjected)}
          hint={
            entAmount === null
              ? 'No budget to compare against'
              : overDelta > 0
                ? `${formatCurrency(overDelta)} over budget`
                : `${formatCurrency(-overDelta)} under budget`
          }
          tone={entAmount !== null && overDelta > 0 ? 'warn' : 'neutral'}
          icon={<TrendUp size={22} weight="duotone" className="text-neutral-400" />}
        />
        <KpiTile
          label="Headroom"
          value={headroomVsEnt === null ? '—' : formatCurrency(headroomVsEnt)}
          hint={
            entAmount === null
              ? 'Requires enterprise budget'
              : `${formatPercent(trackedForecast.totalMtd / Math.max(1, entAmount))} of budget spent`
          }
          icon={<Receipt size={22} weight="duotone" className="text-neutral-400" />}
        />
      </div>
      <ForecastBreakdownCard tracked={trackedForecast} entBudget={entAmount} />

      {/* § 3 — Cost centers today: per-CC budget, ULB ceiling, derivable
          spend so far + forecast. Allocation chart kept as supporting
          visual. */}
      <SectionHeader number={3} title="Cost centers" />
      <CostCenterStatusCard
        pool={pool}
        seats={seats}
        budgets={budgets}
        loginToCostCenter={loginToCostCenter}
      />

      {/* § 4 — Action items: blocked users, missing budgets, allocation
          risk. */}
      <SectionHeader number={4} title="Action items" />
      <ActionItemsCard
        forecast={forecast}
        universalUlb={universalUlb}
        entAmount={entAmount}
        pool={pool}
        seats={seats}
        budgets={budgets}
        loginToCostCenter={loginToCostCenter}
      />
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
  const ccRoutedProjected = tracked.hasActual
    ? Math.max(0, tracked.totalProjected - tracked.universal.projected - tracked.individual.projected)
    : 0
  const ccRoutedMtd = tracked.hasActual
    ? Math.max(0, tracked.totalMtd - tracked.universal.mtd - tracked.individual.mtd)
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecasted metered charges</CardTitle>
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

        {tracked.hasActual ? (
          <div className="text-[11px] text-neutral-500">
            Total from the billing usage summary API. "CC-routed" is the
            residual not attributable to ULB scopes — those budgets don't
            report consumed_amount.
          </div>
        ) : tracked.untrackedSeats > 0 ? (
          <div className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-xs">
            {tracked.untrackedSeats.toLocaleString()} seat
            {tracked.untrackedSeats === 1 ? ' is' : 's are'} covered by a
            cost-center budget with no individual ULB — their spend isn't
            included above. Grant the PAT enhanced-billing access for full
            totals.
          </div>
        ) : (
          <div className="text-[11px] text-neutral-500">
            Spend summed from the two budget scopes that report consumed
            amounts: universal ULB and individual ULBs.
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



// ============================================================================
// Reorganized dashboard sections — § 1 Pool & licenses · § 2 Metered ·
// § 3 Cost centers · § 4 Action items.
// ============================================================================

function SectionHeader({
  number,
  title,
  subtitle,
}: {
  number: number
  title: string
  subtitle?: string
}) {
  return (
    <div className="flex items-baseline gap-2 mt-2">
      <div className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 tabular-nums">
        {String(number).padStart(2, '0')}
      </div>
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {subtitle ? (
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          · {subtitle}
        </div>
      ) : null}
    </div>
  )
}

/**
 * § 1 — AI credit pool & licenses. Replaces the old SharedPoolCard +
 * LicenseCostCard + BudgetModelBanner. One card answering "how is my
 * current state — pool, licenses, used so far". Per-license rows include
 * AIC contribution AND billed MTD so the same row tells the licensing
 * story and the spend story.
 */
function PoolAndLicensesCard({
  seatCost,
  usage,
  meteredMtd,
  ulbDrawnMtd,
}: {
  seatCost: ReturnType<typeof seatCostBreakdown>
  usage: import('@/lib/api').CopilotUsageSummary | null
  meteredMtd: number | null
  ulbDrawnMtd: number
}) {
  const credits = includedAiCredits(seatCost.business, seatCost.enterprise)
  if (credits.totalCredits === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-neutral-500">
          No Copilot Business or Enterprise seats found.
        </CardContent>
      </Card>
    )
  }
  const poolValueWhole = `$${Math.round(credits.totalDollars).toLocaleString('en-US')}`
  const poolExhausted = meteredMtd !== null && meteredMtd > 0
  const billedMtd = usage !== null ? usage.cbLicenseNet + usage.ceLicenseNet : null
  // Pool drawdown so far. When metered charges exist the pool is fully drawn
  // (metering only starts after exhaustion); otherwise we use the ULB-scope
  // consumption the budgets API reports as a lower bound. CC-direct users
  // without an individual ULB also draw the pool but aren't reported here.
  const poolDrawn = poolExhausted
    ? credits.totalDollars
    : Math.min(ulbDrawnMtd, credits.totalDollars)
  const poolPct = credits.totalDollars > 0
    ? Math.min(100, (poolDrawn / credits.totalDollars) * 100)
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>AI credit pool &amp; licenses</CardTitle>
            <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
              Your CB and CE seats fund a <strong>shared AI credit pool</strong>{' '}
              that's drawn before any metered charges. Only user-level budgets
              (universal ULB + individual overrides) constrain pool drawdown.{' '}
              <a
                href="https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises#how-do-ai-credits-work"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline text-neutral-500"
              >
                Docs ↗
              </a>
            </p>
          </div>
          {credits.promoActive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-900 dark:text-violet-200 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
              Promotional credits · Jun 1 – Sep 1 2026
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pool headline tiles */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="rounded-md border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
              Total AI credits / month
            </div>
            <div className="text-2xl font-semibold mt-1 tabular-nums text-indigo-950 dark:text-indigo-100">
              {credits.totalCredits.toLocaleString()}
            </div>
            <div className="text-[11px] text-indigo-700 dark:text-indigo-300 mt-0.5">
              pooled across all seats
            </div>
          </div>
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Pool value
            </div>
            <div className="text-2xl font-semibold mt-1 tabular-nums text-emerald-950 dark:text-emerald-100">
              {poolValueWhole}
            </div>
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
              @ $0.01 per AI credit
            </div>
          </div>
        </div>

        {/* License contribution table — answers "how many CB / CE licenses
            do I have and how does that affect the pool". One row tells the
            full story per license type. */}
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">License</th>
                <th className="text-right font-medium px-3 py-2">Seats</th>
                <th className="text-right font-medium px-3 py-2">$/seat</th>
                <th className="text-right font-medium px-3 py-2">AICs/seat</th>
                <th className="text-right font-medium px-3 py-2">Pool contribution</th>
                <th className="text-right font-medium px-3 py-2">License MTD</th>
              </tr>
            </thead>
            <tbody>
              {seatCost.business > 0 ? (
                <LicenseContribRow
                  label="Copilot Business"
                  seats={seatCost.business}
                  unitPrice={COPILOT_BUSINESS_LIST_PRICE}
                  creditsPerSeat={credits.perBusiness}
                  billedMtd={usage?.cbLicenseNet ?? null}
                />
              ) : null}
              {seatCost.enterprise > 0 ? (
                <LicenseContribRow
                  label="Copilot Enterprise"
                  seats={seatCost.enterprise}
                  unitPrice={COPILOT_ENTERPRISE_LIST_PRICE}
                  creditsPerSeat={credits.perEnterprise}
                  billedMtd={usage?.ceLicenseNet ?? null}
                />
              ) : null}
              {seatCost.other > 0 ? (
                <tr className="border-t border-neutral-200 dark:border-neutral-800 text-neutral-500">
                  <td className="px-3 py-2">Other plan</td>
                  <td className="px-3 py-2 text-right tabular-nums">{seatCost.other.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">—</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pool drawdown — answers "how much of the pool has been used so
            far". We can only see ULB-scope consumption directly; once any
            metered charges appear, the pool is fully drawn. */}
        {meteredMtd === null ? (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 px-3 py-2 text-xs">
            Pool drawdown unknown — connect a billing-scope token to see
            whether the pool has been exhausted.
          </div>
        ) : (
          <div
            className={cn(
              'rounded-md border px-3 py-3 space-y-2',
              poolExhausted
                ? 'border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40'
                : poolPct >= 80
                  ? 'border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20'
                  : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
              <div
                className={cn(
                  'font-medium',
                  poolExhausted
                    ? 'text-amber-900 dark:text-amber-200'
                    : poolPct >= 80
                      ? 'text-amber-900 dark:text-amber-200'
                      : 'text-emerald-900 dark:text-emerald-200',
                )}
              >
                Pool drawdown · {formatPercent(poolPct / 100)}
              </div>
              <div className="text-[11px] text-neutral-600 dark:text-neutral-400 tabular-nums">
                {formatCurrency(poolDrawn)} of {poolValueWhole} drawn
                {poolExhausted ? (
                  <span className="ml-2 text-amber-800 dark:text-amber-300">
                    · {formatCurrency(meteredMtd!)} metered overflow
                  </span>
                ) : null}
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  poolExhausted
                    ? 'bg-amber-500'
                    : poolPct >= 80
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                )}
                style={{ width: `${Math.max(2, poolPct)}%` }}
              />
            </div>
            {billedMtd !== null ? (
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                License spend MTD {formatCurrency(billedMtd)} · full-month
                estimate {formatCurrency(seatCost.monthlyCost)}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LicenseContribRow({
  label,
  seats,
  unitPrice,
  creditsPerSeat,
  billedMtd,
}: {
  label: string
  seats: number
  unitPrice: number
  creditsPerSeat: number
  billedMtd: number | null
}) {
  const totalAics = seats * creditsPerSeat
  const poolValue = totalAics * 0.01
  return (
    <tr className="border-t border-neutral-200 dark:border-neutral-800">
      <td className="px-3 py-2 font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{seats.toLocaleString()}</td>
      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
        ${unitPrice}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
        {creditsPerSeat.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="font-medium">{totalAics.toLocaleString()}</span>
        <span className="text-neutral-500 ml-1">
          (${Math.round(poolValue).toLocaleString()})
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
        {billedMtd !== null ? formatCurrency(billedMtd) : '—'}
      </td>
    </tr>
  )
}

/**
 * § 3 — Cost centers status. Per-CC rollup answering "how are my cost
 * centers doing today". MTD per CC is derived from sum of user-budget
 * consumed_amount for users routed to the CC (the only thing the budgets
 * API can give us — cost_center-scope budgets don't report consumed). For
 * CCs whose seats rely on the universal ULB, MTD shows as "—" with a
 * footnote caveat.
 */
function CostCenterStatusCard({
  pool,
  seats,
  budgets,
  loginToCostCenter,
}: {
  pool: ReturnType<typeof computePoolSplit>
  seats: import('@/lib/api').CopilotSeat[]
  budgets: import('@/lib/api').UserBudget[]
  loginToCostCenter: ReturnType<typeof useCredentials>['loginToCostCenter']
}) {
  // Per-CC derived MTD: sum of user-budget consumed_amount for users routed
  // to each CC, plus count of seats with vs. without individual ULB so we
  // can warn when our MTD only represents a fraction of the CC's seats.
  const perCc = useMemo(() => {
    type CcRow = {
      ccId: string
      ulbMtd: number
      ulbProjected: number
      seatsWithUlb: number
      seatsTotal: number
    }
    const rows = new Map<string, CcRow>()
    const budgetByLogin = new Map<string, import('@/lib/api').UserBudget>()
    for (const b of budgets) if (b.user) budgetByLogin.set(b.user.toLowerCase(), b)
    for (const seat of seats) {
      const login = seat.login.toLowerCase()
      const cc = loginToCostCenter.get(login)?.cc
      if (!cc) continue
      let row = rows.get(cc.id)
      if (!row) {
        row = { ccId: cc.id, ulbMtd: 0, ulbProjected: 0, seatsWithUlb: 0, seatsTotal: 0 }
        rows.set(cc.id, row)
      }
      row.seatsTotal += 1
      const b = budgetByLogin.get(login)
      if (b) {
        row.seatsWithUlb += 1
        row.ulbMtd += b.consumedAmount
        row.ulbProjected += projectMonthlyBudget(b.consumedAmount, 0).projectedMonthTotal
      }
    }
    return rows
  }, [seats, budgets, loginToCostCenter])

  if (pool.costCenters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cost centers</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyChart message="No cost centers route Copilot today." />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost centers</CardTitle>
        <p className="text-xs text-neutral-500 mt-1">
          {pool.costCenters.length} CC{pool.costCenters.length === 1 ? '' : 's'} routing Copilot today.
          MTD comes from individual ULBs in each CC — universal-ULB users aren't reported per CC.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bullet chart — one row per CC + unassigned. Each row normalized
            to its own scale max so the budget vs ceiling vs projected
            relationship is visible at a glance. */}
        <CostCenterBulletList
          rows={pool.costCenters.map(cc => {
            const data = perCc.get(cc.costCenterId)
            return {
              key: cc.costCenterId,
              name: cc.name,
              budget: cc.budgetAmount,
              ceiling: cc.ulbCeiling,
              mtd: data?.ulbMtd ?? 0,
              projected: data?.ulbProjected ?? 0,
              measured: (data?.seatsWithUlb ?? 0) > 0,
            }
          })}
          unassignedDraw={pool.unassignedTotal}
        />

        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Cost center</th>
                <th className="text-right font-medium px-3 py-2">Seats</th>
                <th className="text-right font-medium px-3 py-2">Budget</th>
                <th className="text-right font-medium px-3 py-2">ULB ceiling</th>
                <th className="text-right font-medium px-3 py-2">MTD (ULB users)</th>
                <th className="text-right font-medium px-3 py-2">Projected (ULB users)</th>
                <th className="text-left font-medium px-3 py-2 pl-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {pool.costCenters.map(cc => {
                const data = perCc.get(cc.costCenterId)
                const mtd = data?.ulbMtd ?? 0
                const proj = data?.ulbProjected ?? 0
                const seatsWithUlb = data?.seatsWithUlb ?? 0
                const seatsTotal = data?.seatsTotal ?? cc.seatCount
                const measured = seatsWithUlb > 0
                const partial = measured && seatsWithUlb < seatsTotal
                const budgetExceeded =
                  cc.budgetAmount !== null && proj > cc.budgetAmount
                const ceilingBinds =
                  cc.budgetAmount !== null && cc.ulbCeiling < cc.budgetAmount
                let status: { label: string; tone: 'ok' | 'warn' | 'info' }
                if (cc.budgetAmount === null) {
                  status = { label: 'Uncapped · bounded by ULB ceiling', tone: 'info' }
                } else if (budgetExceeded) {
                  status = { label: 'Projected to exceed budget', tone: 'warn' }
                } else if (ceilingBinds) {
                  status = { label: 'ULB ceiling < budget', tone: 'info' }
                } else {
                  status = { label: 'On track', tone: 'ok' }
                }
                return (
                  <tr key={cc.costCenterId} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2 font-medium text-neutral-700 dark:text-neutral-300">
                      {cc.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {seatsTotal.toLocaleString()}
                      {partial ? (
                        <span className="text-neutral-400 ml-1" title={`${seatsWithUlb} have individual ULB`}>
                          ({seatsWithUlb}/{seatsTotal})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {cc.budgetAmount === null ? (
                        <span className="text-neutral-500">Uncapped</span>
                      ) : (
                        formatCurrency(cc.budgetAmount)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                      {formatCurrency(cc.ulbCeiling)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {measured ? formatCurrency(mtd) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {measured ? formatCurrency(proj) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-2 pl-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          status.tone === 'warn' && 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
                          status.tone === 'info' && 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
                          status.tone === 'ok' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
                        )}
                      >
                        {status.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pool.unassignedTotal > 0 ? (
          <div className="text-[11px] text-neutral-500">
            Plus {formatCurrency(pool.unassignedTotal)} of effective draw from seats not routed to any cost center.
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

type CcBulletRow = {
  key: string
  name: string
  budget: number | null
  ceiling: number
  mtd: number
  projected: number
  measured: boolean
}

/**
 * Bullet chart for cost centers. Per row: MTD as a solid bar, projected
 * as a lighter trailing segment, tick marks at the budget cap and the
 * ULB ceiling. Each row normalizes to its own scale (max of budget,
 * ceiling, projected) so the relationships are legible without a global
 * x-axis. The unassigned row is appended when there's effective draw from
 * seats not routed to any CC — it shows draw only (no budget/ceiling).
 */
function CostCenterBulletList({
  rows,
  unassignedDraw,
}: {
  rows: CcBulletRow[]
  unassignedDraw: number
}) {
  // Shared scale across all rows so budget/ceiling ticks line up visually
  // and CCs are comparable in size. Round up to a "nice" number so the
  // right edge feels stable.
  const rawMax = Math.max(
    1,
    ...rows.flatMap(r => [r.budget ?? 0, r.projected, r.mtd]),
    unassignedDraw,
  )
  const scaleMax = niceCeil(rawMax)
  const sorted = [...rows].sort(
    (a, b) => (b.budget ?? b.ceiling) - (a.budget ?? a.ceiling),
  )
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 space-y-3">
      <div className="flex items-center gap-4 text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500" />MTD
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-300 dark:bg-emerald-500/40" />Projected
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-0.5 h-3 bg-neutral-900 dark:bg-neutral-200" />Budget cap
        </span>
        <span className="ml-auto tabular-nums">scale 0 – {formatCurrency(scaleMax)}</span>
      </div>
      {sorted.map(row => (
        <CcBulletRowView key={row.key} row={row} scaleMax={scaleMax} />
      ))}
      {unassignedDraw > 0 ? (
        <CcBulletRowView
          key="__unassigned"
          row={{
            key: '__unassigned',
            name: 'Unassigned',
            budget: null,
            ceiling: 0,
            mtd: unassignedDraw,
            projected: unassignedDraw,
            measured: true,
          }}
          scaleMax={scaleMax}
          muted
        />
      ) : null}
    </div>
  )
}

/** Round up to a friendly axis max so the right edge feels stable. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const pow = Math.pow(10, exp)
  const norm = value / pow
  let nice: number
  if (norm <= 1) nice = 1
  else if (norm <= 2) nice = 2
  else if (norm <= 2.5) nice = 2.5
  else if (norm <= 5) nice = 5
  else nice = 10
  return nice * pow
}

function CcBulletRowView({
  row,
  scaleMax,
  muted = false,
}: {
  row: CcBulletRow
  scaleMax: number
  muted?: boolean
}) {
  const { name, budget, mtd, projected, measured } = row
  const mtdPct = Math.min(100, (mtd / scaleMax) * 100)
  const projPct = Math.min(100, (projected / scaleMax) * 100)
  const budgetPct = budget !== null ? Math.min(100, (budget / scaleMax) * 100) : null

  const overBudget = budget !== null && projected > budget
  const nearBudget = budget !== null && projected > budget * 0.8 && !overBudget
  const fillColor = muted
    ? 'bg-neutral-400 dark:bg-neutral-500'
    : overBudget
      ? 'bg-red-500'
      : nearBudget
        ? 'bg-amber-500'
        : 'bg-emerald-500'
  const trailColor = muted
    ? 'bg-neutral-300 dark:bg-neutral-600/50'
    : overBudget
      ? 'bg-red-300 dark:bg-red-500/40'
      : nearBudget
        ? 'bg-amber-300 dark:bg-amber-500/40'
        : 'bg-emerald-300 dark:bg-emerald-500/40'

  const numericLabel = (() => {
    if (muted) {
      return (
        <span className="text-neutral-500">
          {formatCurrency(mtd)} draw · no CC budget
        </span>
      )
    }
    if (!measured) {
      return (
        <span className="text-neutral-400">
          no spend yet
          {budget !== null ? ` · budget ${formatCurrency(budget)}` : ''}
        </span>
      )
    }
    const left = budget !== null
      ? `${formatCurrency(mtd)} / ${formatCurrency(budget)}`
      : `${formatCurrency(mtd)} spend · uncapped`
    return (
      <>
        <span className="text-neutral-700 dark:text-neutral-200">{left}</span>
        <span className="text-neutral-500"> · proj {formatCurrency(projected)}</span>
      </>
    )
  })()

  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3">
      <div
        className={cn(
          'text-xs font-medium truncate',
          muted ? 'text-neutral-500 italic' : 'text-neutral-700 dark:text-neutral-300',
        )}
        title={name}
      >
        {name}
      </div>
      <div className="relative h-3 rounded-sm bg-neutral-100 dark:bg-neutral-800/70 overflow-hidden">
        {/* Projected trail (lighter, behind MTD) */}
        <div
          className={cn('absolute inset-y-0 left-0', trailColor)}
          style={{ width: `${projPct}%` }}
          title={`Projected ${formatCurrency(projected)}`}
        />
        {/* MTD solid fill on top */}
        <div
          className={cn('absolute inset-y-0 left-0', fillColor)}
          style={{ width: `${mtdPct}%` }}
          title={`MTD ${formatCurrency(mtd)}`}
        />
        {/* Budget tick (dark vertical line) */}
        {budgetPct !== null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-neutral-900 dark:bg-neutral-200"
            style={{ left: `calc(${budgetPct}% - 1px)` }}
            title={`Budget ${formatCurrency(budget!)}`}
          />
        ) : null}
      </div>
      <div className="text-[11px] tabular-nums text-right whitespace-nowrap">{numericLabel}</div>
    </div>
  )
}

/**
 * § 4 — Action items. Surfaces already-computed signals (forecast over,
 * missing budgets, over-allocation) that the rest of the dashboard hints
 * at but doesn't make actionable. Each row deeplinks to the tab that
 * can fix it. Renders "All clear" when nothing is flagged.
 */
type ActionItem = {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  hint?: string
  ctaLabel: string
  onCta: () => void
}

function ActionItemsCard({
  forecast,
  universalUlb,
  entAmount,
  pool,
  seats,
  budgets,
  loginToCostCenter,
}: {
  forecast: ReturnType<typeof forecastSummary>
  universalUlb: import('@/lib/api').UniversalUlb | null
  entAmount: number | null
  pool: ReturnType<typeof computePoolSplit>
  seats: import('@/lib/api').CopilotSeat[]
  budgets: import('@/lib/api').UserBudget[]
  loginToCostCenter: ReturnType<typeof useCredentials>['loginToCostCenter']
}) {
  const items: ActionItem[] = []

  if (forecast.alreadyOver > 0) {
    items.push({
      id: 'already-over',
      severity: 'high',
      title: `${forecast.alreadyOver} user${forecast.alreadyOver === 1 ? '' : 's'} blocked at their ULB`,
      hint: 'Already over their individual ULB this cycle.',
      ctaLabel: 'Review',
      onCta: () =>
        window.dispatchEvent(new CustomEvent(NAV_TO_INDIVIDUAL_EVENT, { detail: {} })),
    })
  }
  if (forecast.projectedOver > 0) {
    items.push({
      id: 'projected-over',
      severity: 'medium',
      title: `${forecast.projectedOver} user${forecast.projectedOver === 1 ? '' : 's'} projected over their ULB`,
      hint: 'On track to exceed cap at current burn.',
      ctaLabel: 'Review',
      onCta: () =>
        window.dispatchEvent(new CustomEvent(NAV_TO_INDIVIDUAL_EVENT, { detail: {} })),
    })
  }
  if (entAmount === null) {
    items.push({
      id: 'missing-ent',
      severity: 'medium',
      title: 'No enterprise budget set',
      hint: "Metered charges aren't capped at the enterprise level.",
      ctaLabel: 'Set budget',
      onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT)),
    })
  }
  if (pool.overAllocated && entAmount !== null) {
    const overshoot = pool.cappedTotal + pool.uncappedTotal + pool.unassignedTotal - entAmount
    items.push({
      id: 'over-alloc',
      severity: 'high',
      title: `CC commitments exceed enterprise budget by ${formatCurrency(overshoot)}`,
      hint: 'Sum of CC effective draws is higher than the enterprise cap.',
      ctaLabel: 'Open budgets',
      onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT)),
    })
  }
  if (!universalUlb) {
    const indLogins = new Set(budgets.filter(b => b.user).map(b => b.user.toLowerCase()))
    const fallbackSeats = seats.filter(s => !indLogins.has(s.login.toLowerCase())).length
    if (fallbackSeats > 0) {
      items.push({
        id: 'missing-univ',
        severity: 'medium',
        title: `No universal ULB · ${fallbackSeats.toLocaleString()} seat${fallbackSeats === 1 ? '' : 's'} have no per-user cap`,
        hint: 'Their pool drawdown is unconstrained until the pool runs out.',
        ctaLabel: 'Set universal ULB',
        onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT)),
      })
    }
  }
  // Uncapped CCs whose seats include any without individual ULB coverage —
  // a recipe for surprise spend once the pool exhausts.
  const indLoginsForCcCheck = new Set(
    budgets.filter(b => b.user).map(b => b.user.toLowerCase()),
  )
  const uncappedRiskyCcs = pool.costCenters.filter(cc => {
    if (cc.budgetAmount !== null) return false
    if (universalUlb) return false // universal ULB covers them
    // count seats in this CC without an individual ULB
    let bare = 0
    for (const seat of seats) {
      const r = loginToCostCenter.get(seat.login.toLowerCase())?.cc
      if (r?.id !== cc.costCenterId) continue
      if (!indLoginsForCcCheck.has(seat.login.toLowerCase())) bare += 1
    }
    return bare > 0
  })
  if (uncappedRiskyCcs.length > 0) {
    items.push({
      id: 'uncapped-risky',
      severity: 'medium',
      title: `${uncappedRiskyCcs.length} uncapped CC${uncappedRiskyCcs.length === 1 ? '' : 's'} have seats with no ULB fallback`,
      hint: 'No CC budget AND no user-level cap once the pool exhausts.',
      ctaLabel: 'Open budgets',
      onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT)),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Action items</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            All clear — no items to address.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 -mx-4 -my-2">
            {items.map(item => (
              <li
                key={item.id}
                className="px-4 py-3 flex items-start gap-3"
              >
                <span
                  className={cn(
                    'mt-1.5 inline-block w-2 h-2 rounded-full shrink-0',
                    item.severity === 'high' && 'bg-red-500',
                    item.severity === 'medium' && 'bg-amber-500',
                    item.severity === 'low' && 'bg-neutral-400',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {item.title}
                  </div>
                  {item.hint ? (
                    <div className="text-xs text-neutral-500 mt-0.5">{item.hint}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={item.onCta}
                  className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline underline-offset-2 shrink-0"
                >
                  {item.ctaLabel} →
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
