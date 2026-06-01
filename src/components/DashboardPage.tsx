import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Buildings,
  CurrencyDollar,
  Receipt,
  TrendUp,
} from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCredentials } from '@/hooks/use-credentials'
import { computePoolSplit } from '@/lib/poolSplit'
import {
  COPILOT_BUSINESS_LIST_PRICE,
  COPILOT_ENTERPRISE_LIST_PRICE,
  includedAiCredits,
  isCreditPromoActive,
  seatCostBreakdown,
  type IncludedCredits,
} from '@/lib/pricing'
import { forecastSummary } from '@/lib/status'
import { projectMonthlyBudget } from '@/lib/projection'
import { getEffectiveDemoAsof } from '@/lib/demo'
import { formatCurrency, formatCurrencyWhole, formatPercent, cn } from '@/lib/utils'
import {
  filterAndSortCcRows,
  ccUtilization,
  type CcSortOption,
} from '@/lib/ccRowFilter'
import { CcListToolbar } from '@/components/ui/cc-list-toolbar'
import { CcListPagination } from '@/components/ui/cc-list-pagination'
import { CcStatusChips } from '@/components/ui/cc-status-chips'
import { DEFAULT_CC_PAGE_SIZE } from '@/lib/ccPagination'
import { ccHealthStatus, countByHealth, type CcHealth } from '@/lib/ccStatus'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
} from '@/lib/navEvents'
import { DebugBadge, type DebugInfo } from './DebugBadge'
import { BudgetStructureDiagram } from '@/components/BudgetStructureDiagram'

/**
 * Top-level Dashboard. Single-screen rollup of the enterprise's AI credit
 * posture: where the pool is committed, how budgets compare to effective
 * caps, where spend is trending, UBB coverage, and license cost context.
 *
 * Every section here is read-only — editing happens on the dedicated tabs
 * (Enterprise Budgets, Universal UBB, Individual UBBs) — so the dashboard
 * can stay focused on signal rather than form fields.
 */
export function DashboardPage() {
  const {
    enterpriseBudget,
    universalUbb,
    costCenters,
    costCenterBudgetsByName,
    seats,
    budgets,
    loginToCostCenter,
    usageSummary,
    usageByCostCenterId,
  } = useCredentials()

  const pool = useMemo(
    () =>
      computePoolSplit({
        enterpriseBudget,
        universalUbb,
        costCenters,
        ccBudgetsByName: costCenterBudgetsByName,
        seats,
        userBudgets: budgets,
      }),
    [enterpriseBudget, universalUbb, costCenters, costCenterBudgetsByName, seats, budgets],
  )

  const demoAsof = useMemo(() => getEffectiveDemoAsof() ?? undefined, [])
  const forecast = useMemo(() => forecastSummary(budgets, demoAsof), [budgets, demoAsof])
  const seatCost = useMemo(() => seatCostBreakdown(seats), [seats])

  /** How many seats are covered by an individual UBB (have a user-scope budget). */
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
   *   • `multi_user_customer` (universal UBB)
   *   • `user` (individual UBBs)
   *
   * Note: `enterprise`- and `cost_center`-scope budgets DO NOT report
   * consumed_amount (verified empirically — see probe-findings.md). Any
   * Copilot user whose spend is absorbed by a CC budget without an
   * individual UBB is invisible here. We count those seats so the card can
   * be honest about coverage.
   */
  const trackedForecast = useMemo(() => {
    const univMtd = universalUbb?.consumedAmount ?? 0
    const univProj = projectMonthlyBudget(univMtd, 0, demoAsof).projectedMonthTotal
    const indMtd = forecast.spendMtd
    const indProj = forecast.projectedEom
    // Seats whose consumption flows through a CC budget rather than universal
    // or an individual UBB — these are the "untrackable-by-budgets-API" ones.
    const indLogins = new Set(budgets.filter(b => b.user).map(b => b.user.toLowerCase()))
    let untrackedSeats = 0
    for (const s of seats) {
      if (indLogins.has(s.login.toLowerCase())) continue
      const cc = loginToCostCenter.get(s.login.toLowerCase())?.cc
      if (cc && costCenterBudgetsByName.has(cc.name.toLowerCase())) untrackedSeats += 1
    }
    // Billing usage summary is the truth-of-record for total AIC pool draw,
    // including the CC-routed slice the budgets API can't report. Use
    // aiCreditsGross so the enterprise total sums the SAME units the
    // per-scope tiles render (pool drawdown). aiCreditsNet is metered
    // overage only and is 0 until the pool exhausts, which makes for a
    // misleading total.
    const actualMtd = usageSummary?.aiCreditsGross ?? null
    const actualProjected =
      actualMtd !== null ? projectMonthlyBudget(actualMtd, 0, demoAsof).projectedMonthTotal : null
    return {
      universal: { mtd: univMtd, projected: univProj, hasBudget: !!universalUbb },
      individual: { mtd: indMtd, projected: indProj, count: indCoverage.withInd },
      trackedMtd: univMtd + indMtd,
      trackedProjected: univProj + indProj,
      totalMtd: actualMtd ?? univMtd + indMtd,
      totalProjected: actualProjected ?? univProj + indProj,
      hasActual: actualMtd !== null,
      untrackedSeats,
    }
  }, [
    universalUbb,
    forecast.spendMtd,
    forecast.projectedEom,
    indCoverage.withInd,
    budgets,
    seats,
    loginToCostCenter,
    costCenterBudgetsByName,
    usageSummary,
    demoAsof,
  ])

  const entAmount = pool.enterpriseBudget
  // User-toggleable override: customers that signed up after the transition
  // don't qualify for the bumped allowance. Click the pill to simulate that
  // experience. Persisted in localStorage so the choice survives reloads.
  const naturalPromoActive = isCreditPromoActive()
  const [promoDisabled, setPromoDisabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('dashboard.promoOverride') === 'off'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (promoDisabled) {
      window.localStorage.setItem('dashboard.promoOverride', 'off')
    } else {
      window.localStorage.removeItem('dashboard.promoOverride')
    }
  }, [promoDisabled])
  const credits = useMemo(
    () =>
      includedAiCredits(seatCost.business, seatCost.enterprise, undefined, {
        promoActive: promoDisabled ? false : naturalPromoActive,
      }),
    [seatCost.business, seatCost.enterprise, promoDisabled, naturalPromoActive],
  )
  const poolSize = credits.totalCredits > 0 ? credits.totalDollars : null
  const poolRemaining =
    poolSize === null ? null : Math.max(0, poolSize - trackedForecast.totalMtd)
  const forecastOverPool =
    poolSize === null ? 0 : Math.max(0, trackedForecast.totalProjected - poolSize)

  return (
    <div className="grid gap-6">
      {/* § 1 — Current state: pool, licenses, used so far. */}
      <SectionHeader
        title="AI Credit Pool & Licenses"
        rightSlot={
          naturalPromoActive ? (
            <button
              type="button"
              onClick={() => setPromoDisabled(v => !v)}
              title={
                promoDisabled
                  ? 'Click to apply the promotional credit boost (Jun 1 – Aug 31 2026)'
                  : "Click to simulate a customer that doesn't qualify for the promo (signed up after the transition)"
              }
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors',
                promoDisabled
                  ? 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-500 dark:text-neutral-400 line-through hover:bg-neutral-200 dark:hover:bg-neutral-700/60'
                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60',
              )}
            >
              Promotional credits · Jun 1 – Aug 31 2026
            </button>
          ) : null
        }
      />
      <PoolAndLicensesCard
        seatCost={seatCost}
        usage={usageSummary}
        credits={credits}
      />

      {/* § 1b — Budget structure: how the enterprise budget and per-CC
          budgets relate. Same diagram used on the Enterprise Budgets tab;
          the actionable-items banner is suppressed here because it's
          surfaced next to the editable cost-center list on that tab and
          would just be noise on the Dashboard. */}
      <SectionHeader title="Budget structure" />
      <BudgetStructureDiagram hideActionableItems />

      {/* § 2 — Spend so far + forecast. Numbers are gross AI credit
          drawdown (consumption from the pool plus any post-pool metered
          overflow), which reconciles with the per-scope breakdown below
          and the pool drawdown bar above. The enterprise budget itself
          caps only the post-pool metered slice, surfaced as a footnote
          in the breakdown card. */}
      <SectionHeader title="Spend forecast" />
      <div className="grid gap-3 grid-cols-1 md:grid-cols-4">
        <KpiTile
          label="Enterprise budget"
          value={entAmount === null ? 'Not set' : formatCurrency(entAmount)}
          hint={
            entAmount === null
              ? 'No enterprise budget'
              : `Caps post-pool metered spend`
          }
          icon={<Buildings size={22} weight="duotone" className="text-neutral-400" />}
          debug={{
            source: 'enterprise-scope BundlePricing/ai_credits budget · budget_amount',
            formula: 'pickEnterpriseBudget(allBudgets).budgetAmount',
            inputs: {
              'enterpriseBudget?.budgetAmount': entAmount === null ? 'null' : entAmount,
              'enterpriseBudget?.excludeCostCenterUsage':
                String(enterpriseBudget?.excludeCostCenterUsage ?? 'n/a'),
            },
            note: 'enterprise-scope budget does not report consumed_amount; this is the cap only.',
          }}
        />
        <KpiTile
          label="Spent MTD"
          value={formatCurrency(trackedForecast.totalMtd)}
          hint={
            trackedForecast.hasActual
              ? `Day ${forecast.daysElapsed} of ${forecast.daysInMonth} · gross AIC`
              : `Day ${forecast.daysElapsed} of ${forecast.daysInMonth} · UBB proxy`
          }
          icon={<CurrencyDollar size={22} weight="duotone" className="text-neutral-400" />}
          debug={{
            source: trackedForecast.hasActual
              ? "/usage/summary · Σ usageItems[sku='copilot_ai_unit'].grossAmount"
              : 'universalUbb.consumedAmount + Σ userBudgets[].consumedAmount',
            formula: trackedForecast.hasActual
              ? 'usage.aiCreditsGross'
              : 'univMtd + indMtd  (no enterprise gross available)',
            inputs: {
              'usage.aiCreditsGross': usageSummary?.aiCreditsGross ?? 'null',
              'universalUbb.consumedAmount': universalUbb?.consumedAmount ?? 0,
              'Σ userBudgets.consumedAmount': forecast.spendMtd,
              hasActual: String(trackedForecast.hasActual),
            },
            note: 'When hasActual=false, CC-routed seats without a UBB are invisible to this tile.',
          }}
        />
        <KpiTile
          label="Forecast EoM"
          value={formatCurrency(trackedForecast.totalProjected)}
          hint={
            poolSize === null
              ? 'Gross AIC, end of month'
              : forecastOverPool > 0
                ? `${formatCurrency(forecastOverPool)} projected over pool`
                : 'Stays within pool'
          }
          tone={forecastOverPool > 0 ? 'warn' : 'neutral'}
          icon={<TrendUp size={22} weight="duotone" className="text-neutral-400" />}
          debug={{
            source: 'projectMonthlyBudget(totalMtd, 0).projectedMonthTotal',
            formula: 'mtd + (mtd / daysElapsed) × daysRemaining',
            inputs: {
              totalMtd: trackedForecast.totalMtd,
              daysElapsed: forecast.daysElapsed,
              daysInMonth: forecast.daysInMonth,
              projectedMonthTotal: trackedForecast.totalProjected,
              poolSize: poolSize ?? 'null',
              forecastOverPool,
            },
            note: 'Linear extrapolation. lowConfidence < day 5 is computed but not surfaced here.',
          }}
        />
        <KpiTile
          label="Pool remaining"
          value={poolRemaining === null ? '—' : formatCurrency(poolRemaining)}
          hint={
            poolSize === null
              ? 'No pool'
              : `${formatPercent(1 - poolRemaining! / Math.max(1, poolSize))} of pool drawn`
          }
          icon={<Receipt size={22} weight="duotone" className="text-neutral-400" />}
          debug={{
            source: 'includedAiCredits(cb, ce).totalDollars − trackedForecast.totalMtd',
            formula: 'max(0, poolSize − spentMtd)',
            inputs: {
              'CB seats': seatCost.business,
              'CE seats': seatCost.enterprise,
              'AICs/CB': credits.perBusiness,
              'AICs/CE': credits.perEnterprise,
              poolSize: poolSize ?? 'null',
              totalMtd: trackedForecast.totalMtd,
              poolRemaining: poolRemaining ?? 'null',
              promoActive: String(credits.promoActive),
            },
          }}
        />
      </div>
      <ForecastBreakdownCard tracked={trackedForecast} entBudget={entAmount} />

      {/* § 3 — Budget allocation: how the enterprise budget and CC budgets
          partition the org. Layout depends on whether CC usage is
          excluded (independent pools) or rolled up into the ent cap. */}
      <SectionHeader title="Budget allocation" />
      <BudgetAllocationCard
        enterpriseBudget={enterpriseBudget}
        pool={pool}
      />

      {/* § 4 — Cost centers today: per-CC budget, MTD, projected. */}
      <SectionHeader title="Cost centers" />
      <CostCenterStatusCard
        pool={pool}
        usageByCostCenterId={usageByCostCenterId}
      />

      {/* § 5 — Action items: blocked users, missing budgets, allocation
          risk. */}
      <SectionHeader title="Action items" />
      <ActionItemsCard
        forecast={forecast}
        universalUbb={universalUbb}
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
  debug,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  tone?: 'neutral' | 'warn'
  debug?: DebugInfo
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span>{label}</span>
            {debug ? <DebugBadge debug={debug} /> : null}
          </div>
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
// Sepia palette: warm bronze/amber/emerald, matching the Enterprise Budgets tab.
const COLOR_UNIVERSAL = '#b45309' // amber-700 (bronze)
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
        <CardTitle>Forecast breakdown</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className={cn('grid gap-4', tracked.hasActual ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
          <BreakdownStat
            color={COLOR_UNIVERSAL}
            label="Universal UBB"
            mtd={tracked.universal.mtd}
            projected={tracked.universal.projected}
            sub={
              tracked.universal.hasBudget
                ? `${pct(tracked.universal.projected, tracked.totalProjected)} of total`
                : 'No universal UBB'
            }
            debug={{
              source: "multi_user_customer-scope BundlePricing/ai_credits budget · consumed_amount",
              formula: 'projectMonthlyBudget(consumed_amount, 0).projectedMonthTotal',
              inputs: {
                'universal.mtd (consumed_amount)': tracked.universal.mtd,
                'universal.projected': tracked.universal.projected,
                'totalProjected': tracked.totalProjected,
                'hasBudget': String(tracked.universal.hasBudget),
              },
              note: 'Universal UBB is one of only two scopes that report consumed_amount (the other is user-scope).',
            }}
          />
          <BreakdownStat
            color={COLOR_INDIVIDUAL}
            label="Individual UBBs"
            mtd={tracked.individual.mtd}
            projected={tracked.individual.projected}
            sub={
              tracked.individual.count > 0
                ? `${tracked.individual.count.toLocaleString()} users · ${pct(tracked.individual.projected, tracked.totalProjected)} of total`
                : 'No individual UBBs'
            }
            debug={{
              source: 'user-scope BundlePricing/ai_credits budgets · Σ consumed_amount, projected per user',
              formula: 'forecastSummary(userBudgets) → Σ projectMonthlyBudget(b.consumed_amount, 0)',
              inputs: {
                'spendMtd (Σ user consumed)': tracked.individual.mtd,
                'projectedEom': tracked.individual.projected,
                'user count': tracked.individual.count,
              },
            }}
          />
          {tracked.hasActual ? (
            <BreakdownStat
              color={COLOR_CC_ROUTED}
              label="Other / unattributed"
              mtd={ccRoutedMtd}
              projected={ccRoutedProjected}
              sub={
                ccRoutedProjected > 0
                  ? `${pct(ccRoutedProjected, tracked.totalProjected)} of total outside budget data`
                  : 'All spend attributed to a tracked scope'
              }
              debug={{
                source: 'residual: enterprise gross AIC − (universal + individual)',
                formula: 'max(0, totalProjected − universal.projected − individual.projected)',
                inputs: {
                  totalProjected: tracked.totalProjected,
                  'universal.projected': tracked.universal.projected,
                  'individual.projected': tracked.individual.projected,
                  ccRoutedProjected,
                  ccRoutedMtd,
                },
                note: 'Mostly CC-routed spend. CC budgets do not report consumed_amount, so we back this out from the enterprise total.',
              }}
            />
          ) : null}
          <div className="grid gap-1">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {tracked.hasActual ? 'Enterprise total' : 'Tracked total'}
            </div>
            <div className="text-2xl font-semibold">
              {formatCurrency(tracked.totalProjected)}
            </div>
            <div className="text-xs text-neutral-500">MTD {formatCurrency(tracked.totalMtd)}</div>
            {entBudget !== null ? (
              <div className="text-[11px] text-neutral-500">
                {pct(tracked.totalProjected, entBudget)} of enterprise budget
              </div>
            ) : null}
          </div>
        </div>

        {tracked.hasActual ? (
          <div className="text-[11px] text-neutral-500">
            Totals come from billing usage. Other / unattributed is gross AIC
            drawdown outside universal and individual UBB scopes; CC budgets
            do not report consumed spend.
          </div>
        ) : tracked.untrackedSeats > 0 ? (
          <div className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-xs">
            {tracked.untrackedSeats.toLocaleString()} seat
            {tracked.untrackedSeats === 1 ? ' uses' : 's use'} a cost-center
            budget with no individual UBB. Spend is not included above. Grant
            PAT enhanced-billing access for full totals.
          </div>
        ) : (
          <div className="text-[11px] text-neutral-500">
            Includes only spend reported by universal and individual UBBs.
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
  debug,
}: {
  color: string
  label: string
  mtd: number
  projected: number
  sub: string
  debug?: DebugInfo
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
        {debug ? <DebugBadge debug={debug} /> : null}
      </div>
      <div className="text-2xl font-semibold">{formatCurrency(projected)}</div>
      <div className="text-xs text-neutral-500">MTD {formatCurrency(mtd)}</div>
      <div className="text-[11px] text-neutral-500">{sub}</div>
    </div>
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
  title,
  subtitle,
  rightSlot,
}: {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2 mt-2">
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {subtitle ? (
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          · {subtitle}
        </div>
      ) : null}
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
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
  credits,
}: {
  seatCost: ReturnType<typeof seatCostBreakdown>
  usage: import('@/lib/api').CopilotUsageSummary | null
  credits: IncludedCredits
}) {
  if (credits.totalCredits === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-neutral-500">
          No Copilot Business or Enterprise seats.
        </CardContent>
      </Card>
    )
  }
  const poolValueWhole = `$${Math.round(credits.totalDollars).toLocaleString('en-US')}`
  const meteredMtd = usage?.aiCreditsNet ?? null
  const grossMtd = usage?.aiCreditsGross ?? null
  const poolExhausted = meteredMtd !== null && meteredMtd > 0
  const billedMtd = usage !== null ? usage.cbLicenseNet + usage.ceLicenseNet : null
  // Pool drawdown so far = gross AIC consumption capped at pool value. Once
  // gross exceeds the pool, the excess is the metered overflow charged
  // against the enterprise budget (rendered separately below).
  const poolDrawn = grossMtd === null
    ? 0
    : Math.min(grossMtd, credits.totalDollars)
  const poolPct = credits.totalDollars > 0
    ? Math.min(100, (poolDrawn / credits.totalDollars) * 100)
    : 0

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Pool headline tiles */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Total AI credits / month
            </div>
            <div className="text-2xl font-semibold mt-1 tabular-nums text-amber-950 dark:text-amber-100">
              {credits.totalCredits.toLocaleString()}
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
              from all seats
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
            far". We can only see UBB-scope consumption directly; once any
            metered charges appear, the pool is fully drawn. */}
        {meteredMtd === null ? (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 px-3 py-2 text-xs">
            Pool drawdown unknown. Connect a billing token.
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
                License MTD {formatCurrency(billedMtd)} · full-month
                estimate {formatCurrency(seatCost.monthlyCost)}
              </div>
            ) : null}
          </div>
        )}
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 pt-1 border-t border-neutral-200 dark:border-neutral-800">
          Pool and UBBs work together to cap AI credit drawdown.{' '}
          <a
            href="https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            How budgets work ↗
          </a>
        </div>
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
 * § 3 — Budget allocation. Shows how the enterprise budget and CC
 * budgets partition the org's commit. Two layouts:
 *   - Independent (excludeCostCenterUsage=true): enterprise and CC
 *     budgets are disjoint pools. Two parallel bars on a shared scale
 *     — the enterprise pool and a stacked CC pool — so it's visually
 *     obvious they don't combine into a single whole.
 *   - Rolled-up (excludeCostCenterUsage=false): CC budgets are
 *     sub-allocations inside the ent cap. Bar = ent container with CCs
 *     nested + unallocated tail. If ΣCC > ent, the CC bar extends past
 *     the ent line with an over-allocation warning.
 *
 * Allocation only — projected spend per CC lives in the Cost centers
 * section below, so segments here are purely budget shares. Uncapped
 * CCs are omitted from the bar and reported as a footnote.
 */
function BudgetAllocationCard({
  enterpriseBudget,
  pool,
}: {
  enterpriseBudget: import('@/lib/api').EnterpriseBudget | null
  pool: ReturnType<typeof computePoolSplit>
}) {
  const independent = enterpriseBudget?.excludeCostCenterUsage ?? false
  const entBudget = pool.enterpriseBudget

  const segments = useMemo(() => {
    return pool.costCenters
      .filter(cc => cc.budgetAmount !== null && cc.budgetAmount > 0)
      .map(cc => ({
        id: cc.costCenterId,
        name: cc.name,
        budget: cc.budgetAmount!,
      }))
  }, [pool.costCenters])

  const ccBudgetTotal = segments.reduce((s, c) => s + c.budget, 0)
  const uncappedCount = pool.costCenters.length - segments.length

  if (entBudget === null && segments.length === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-neutral-500">
          No enterprise budget or capped cost-center budgets to allocate.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <TooltipProvider delayDuration={150}>
          {independent
            ? (
              <IndependentAllocationView
                entBudget={entBudget}
                ccBudgetTotal={ccBudgetTotal}
                segments={segments}
              />
            )
            : (
              <RolledUpAllocationView
                entBudget={entBudget}
                ccBudgetTotal={ccBudgetTotal}
                segments={segments}
              />
            )}
        </TooltipProvider>

        {/* Legend — totals only; per-CC enumeration lives in the
            Cost centers section below to avoid duplication. */}
        <div className="grid gap-1.5 text-[11px] grid-cols-1 sm:grid-cols-2">
          {entBudget !== null && entBudget > 0 ? (
            <LegendRow
              swatch="bg-amber-700"
              label={independent ? 'Enterprise pool' : 'Enterprise cap'}
              value={formatCurrency(entBudget)}
            />
          ) : null}
          {segments.length > 0 ? (
            <LegendRow
              swatch={ALLOC_CC_AGG_CLASS}
              label={`${segments.length} Cost center Copilot budget${segments.length === 1 ? '' : 's'}`}
              value={formatCurrency(ccBudgetTotal)}
            />
          ) : null}
        </div>

        {uncappedCount > 0 ? (
          <div className="text-[11px] text-neutral-500">
            {uncappedCount} cost center{uncappedCount === 1 ? '' : 's'} with
            Copilot seats but no ai_credits budget not shown. Cost centers with no
            Copilot seats, or with budgets for other GitHub products only,
            are excluded entirely.
          </div>
        ) : (
          <div className="text-[11px] text-neutral-500">
            Scoped to Copilot ai_credits budgets only. Cost center budgets for other
            GitHub products (Actions, Packages, etc.) are not shown here.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Single aggregate color for the CC pool bar. Per-CC breakdown lives
// in the Cost centers section below; this card is about totals only.
const ALLOC_CC_AGG_CLASS = 'bg-amber-400 dark:bg-amber-500/70'

function IndependentAllocationView({
  entBudget,
  ccBudgetTotal,
  segments,
}: {
  entBudget: number | null
  ccBudgetTotal: number
  segments: ReadonlyArray<{ id: string; name: string; budget: number }>
}) {
  if (entBudget === null && ccBudgetTotal === 0) {
    return <div className="text-sm text-neutral-500">Nothing to allocate yet.</div>
  }

  // Two parallel bars, shared scale = max(ent, ccTotal). Reinforces
  // that these are disjoint pools — not parts of one whole — by giving
  // each its own row instead of stacking them end-to-end.
  const denom = Math.max(entBudget ?? 0, ccBudgetTotal) || 1
  const totalCommit = (entBudget ?? 0) + ccBudgetTotal

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-xs text-neutral-500">
          Independent pools · enterprise and cost center budgets draw from separate buckets
        </div>
        <div className="text-[11px] text-neutral-500 tabular-nums">
          {formatCurrency(totalCommit)} total org commitment
        </div>
      </div>

      <div className="space-y-2">
        {entBudget !== null && entBudget > 0 ? (
          <AllocBarRow
            label="Enterprise pool"
            amountText={formatCurrency(entBudget)}
            barWidthPct={(entBudget / denom) * 100}
          >
            <AllocSegment
              widthPct={100}
              className="bg-amber-700"
              title={`Enterprise pool · ${formatCurrency(entBudget)}`}
            />
          </AllocBarRow>
        ) : null}

        {segments.length > 0 ? (
          <AllocBarRow
            label={`${segments.length} Cost center pool${segments.length === 1 ? '' : 's'}`}
            amountText={formatCurrency(ccBudgetTotal)}
            barWidthPct={(ccBudgetTotal / denom) * 100}
          >
            <AllocSegment
              widthPct={100}
              className={ALLOC_CC_AGG_CLASS}
              title={`${segments.length} Cost center budget${segments.length === 1 ? '' : 's'} · ${formatCurrency(ccBudgetTotal)}`}
            />
          </AllocBarRow>
        ) : null}
      </div>
    </div>
  )
}

function RolledUpAllocationView({
  entBudget,
  ccBudgetTotal,
  segments,
}: {
  entBudget: number | null
  ccBudgetTotal: number
  segments: ReadonlyArray<{ id: string; name: string; budget: number }>
}) {
  if (entBudget === null || entBudget === 0) {
    // No ent cap to nest into — degrade to a CC-only stacked bar.
    if (ccBudgetTotal === 0) {
      return <div className="text-sm text-neutral-500">No budgets to allocate.</div>
    }
    return (
      <div className="space-y-2">
        <div className="text-xs text-neutral-500">
          No enterprise budget · {formatCurrency(ccBudgetTotal)} committed across {segments.length} cost center{segments.length === 1 ? '' : 's'}
        </div>
        <div className="flex h-7 w-full rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-800">
          <AllocSegment
            widthPct={100}
            className={ALLOC_CC_AGG_CLASS}
            title={`${segments.length} Cost center budget${segments.length === 1 ? '' : 's'} · ${formatCurrency(ccBudgetTotal)}`}
          />
        </div>
      </div>
    )
  }

  const overAlloc = ccBudgetTotal > entBudget
  const unallocated = Math.max(0, entBudget - ccBudgetTotal)
  // Both bars share a scale = max(ent, ccTotal). When CCs over-allocate,
  // the CC bar fills the full width while the enterprise bar visibly
  // shrinks below it, making the inverted relationship obvious.
  const denom = Math.max(entBudget, ccBudgetTotal)
  const entWidthPct = (entBudget / denom) * 100

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-xs text-neutral-500">
          {segments.length} Cost center budget{segments.length === 1 ? '' : 's'} inside the{' '}
          {formatCurrency(entBudget)} enterprise cap
        </div>
        <div
          className={cn(
            'text-[11px] tabular-nums',
            overAlloc ? 'text-red-700 dark:text-red-300 font-medium' : 'text-neutral-500',
          )}
        >
          {overAlloc
            ? `${formatCurrency(ccBudgetTotal - entBudget)} over-allocated · Cost center commitments exceed enterprise cap`
            : `${formatCurrency(unallocated)} unallocated`}
        </div>
      </div>

      {/* Two-bar layout: each bar's outer width = its share of the
          shared scale (max of ent and CC totals). The bars are
          fully filled inside — a short bar means a small value,
          never "half-empty cap". When CC totals exceed the enterprise
          cap the CC bar extends past the ent bar visually. */}
      <div className="space-y-2">
        <AllocBarRow
          label="Enterprise cap"
          amountText={formatCurrency(entBudget)}
          warn={overAlloc}
          barWidthPct={entWidthPct}
        >
          <AllocSegment
            widthPct={100}
            className="bg-amber-700"
            title={`Enterprise cap · ${formatCurrency(entBudget)}`}
          />
        </AllocBarRow>

        <AllocBarRow
          label="Cost center allocations"
          amountText={formatCurrency(ccBudgetTotal)}
          warn={overAlloc}
          barWidthPct={(ccBudgetTotal / denom) * 100}
        >
          <AllocSegment
            widthPct={100}
            className={ALLOC_CC_AGG_CLASS}
            title={`${segments.length} Cost center budget${segments.length === 1 ? '' : 's'} · ${formatCurrency(ccBudgetTotal)}`}
          />
        </AllocBarRow>
      </div>
    </div>
  )
}

function AllocBarRow({
  label,
  amountText,
  warn,
  barWidthPct,
  children,
}: {
  label: string
  amountText: string
  warn?: boolean
  barWidthPct: number
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr_6rem] items-center gap-2">
      <div className="text-[11px] text-neutral-500 truncate">{label}</div>
      <div
        className={cn(
          'flex h-6 rounded-md overflow-hidden border',
          warn
            ? 'border-red-300 dark:border-red-900/60'
            : 'border-neutral-200 dark:border-neutral-800',
        )}
        style={{ width: `${Math.max(0, Math.min(100, barWidthPct))}%` }}
      >
        {children}
      </div>
      <div className="text-[11px] tabular-nums text-neutral-500 text-right">
        {amountText}
      </div>
    </div>
  )
}

function AllocSegment({
  widthPct,
  className,
  title,
  tooltip,
}: {
  widthPct: number
  className: string
  title: string
  tooltip?: ReactNode
}) {
  if (widthPct <= 0) return null
  const content = tooltip ?? title
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn('h-full cursor-help', className)}
          style={{ width: `${widthPct}%` }}
          title={title}
        />
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}

function LegendRow({
  swatch,
  label,
  value,
}: {
  swatch: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
      <span className={cn('inline-block h-2 w-2 rounded-sm shrink-0', swatch)} />
      <span className="truncate">{label}</span>
      <span className="ml-auto tabular-nums text-neutral-500">{value}</span>
    </div>
  )
}

/**
 * § 3 — Cost centers status. Per-CC rollup answering "how are my cost
 * centers doing today". MTD/Projected use gross AI credit pool draw
 * from the billing usage summary API filtered per cost center, which is
 * what CC budgets actually cap. CCs whose per-CC fetch hasn't resolved
 * yet (or failed) render as "—".
 */
function CostCenterStatusCard({
  pool,
  usageByCostCenterId,
}: {
  pool: ReturnType<typeof computePoolSplit>
  usageByCostCenterId: ReturnType<typeof useCredentials>['usageByCostCenterId']
}) {
  const perCc = useMemo(() => {
    const asof = getEffectiveDemoAsof() ?? undefined
    type CcRow = { mtd: number; projected: number; measured: boolean }
    const rows = new Map<string, CcRow>()
    for (const cc of pool.costCenters) {
      const usage = usageByCostCenterId.get(cc.costCenterId)
      if (!usage) continue
      const mtd = usage.aiCreditsGross
      const projected = projectMonthlyBudget(mtd, 0, asof).projectedMonthTotal
      rows.set(cc.costCenterId, { mtd, projected, measured: true })
    }
    return rows
  }, [pool.costCenters, usageByCostCenterId])

  // Toolbar state is local to the card so it doesn't survive remounts —
  // intentional, mirrors the FailureList "showAll" decision in Phase 1.
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<string>('projected-desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_CC_PAGE_SIZE)
  const [selectedHealth, setSelectedHealth] = useState<ReadonlySet<CcHealth>>(new Set())
  // Bars are a nice-to-have at small CC counts but become noisy fast.
  // Default-collapse when there are more than 20 CCs so the actionable
  // table is the first thing in view; users can opt-in via the toggle.
  const [showBars, setShowBars] = useState(() => pool.costCenters.length <= 20)

  type EnrichedCc = (typeof pool)['costCenters'][number] & {
    _mtd: number
    _projected: number
    _measured: boolean
  }

  const enrichedRows: EnrichedCc[] = useMemo(
    () =>
      pool.costCenters.map(cc => {
        const data = perCc.get(cc.costCenterId)
        return {
          ...cc,
          _mtd: data?.mtd ?? 0,
          _projected: data?.projected ?? 0,
          _measured: data?.measured ?? false,
        }
      }),
    [pool.costCenters, perCc],
  )

  const sortOptions: CcSortOption<EnrichedCc>[] = useMemo(
    () => [
      {
        id: 'util-desc',
        label: 'Projected utilization (high → low)',
        cmp: (a, b) => {
          const ua = ccUtilization(a.budgetAmount, a._projected) ?? -Infinity
          const ub = ccUtilization(b.budgetAmount, b._projected) ?? -Infinity
          return ub - ua
        },
      },
      { id: 'name', label: 'Cost center (A → Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
      { id: 'name-desc', label: 'Cost center (Z → A)', cmp: (a, b) => b.name.localeCompare(a.name) },
      { id: 'seats-desc', label: 'Seats (high → low)', cmp: (a, b) => b.seatCount - a.seatCount },
      { id: 'seats-asc', label: 'Seats (low → high)', cmp: (a, b) => a.seatCount - b.seatCount },
      { id: 'mtd-desc', label: 'MTD (high → low)', cmp: (a, b) => b._mtd - a._mtd },
      { id: 'mtd-asc', label: 'MTD (low → high)', cmp: (a, b) => a._mtd - b._mtd },
      {
        id: 'projected-desc',
        label: 'Projected (high → low)',
        cmp: (a, b) => b._projected - a._projected,
      },
      {
        id: 'projected-asc',
        label: 'Projected (low → high)',
        cmp: (a, b) => a._projected - b._projected,
      },
      {
        id: 'budget-desc',
        label: 'Budget (high → low)',
        cmp: (a, b) => (b.budgetAmount ?? 0) - (a.budgetAmount ?? 0),
      },
      {
        id: 'budget-asc',
        label: 'Budget (low → high)',
        cmp: (a, b) => (a.budgetAmount ?? 0) - (b.budgetAmount ?? 0),
      },
    ],
    [],
  )

  // Each column header toggles between desc → asc → desc; clicking a
  // different column resets to desc. The toolbar dropdown stays in sync
  // because both write to the same `sort` state.
  const columnSortIds: Record<string, { asc: string; desc: string }> = useMemo(
    () => ({
      name: { asc: 'name', desc: 'name-desc' },
      seats: { asc: 'seats-asc', desc: 'seats-desc' },
      mtd: { asc: 'mtd-asc', desc: 'mtd-desc' },
      projected: { asc: 'projected-asc', desc: 'projected-desc' },
      budget: { asc: 'budget-asc', desc: 'budget-desc' },
    }),
    [],
  )

  const handleHeaderClick = (col: keyof typeof columnSortIds) => {
    const ids = columnSortIds[col]
    onSortChangeReset(sort === ids.desc ? ids.asc : ids.desc)
  }

  const headerArrow = (col: keyof typeof columnSortIds) => {
    const ids = columnSortIds[col]
    if (sort === ids.desc) return ' ↓'
    if (sort === ids.asc) return ' ↑'
    return ''
  }

  const classify = (r: EnrichedCc): CcHealth => ccHealthStatus(r.budgetAmount, r._projected)
  const healthCounts = countByHealth(enrichedRows, classify)

  // Status filter first (cheap), then text search + sort. Empty selection
  // means "All" (no filter), matching the chip row default.
  const statusFilteredRows =
    selectedHealth.size === 0
      ? enrichedRows
      : enrichedRows.filter(r => selectedHealth.has(classify(r)))

  const filteredRows = filterAndSortCcRows(
    statusFilteredRows,
    query,
    sort,
    sortOptions,
    r => r.name,
  )

  // Reset to page 1 whenever search / sort / status filter / page size
  // changes. Done in handlers (not in an effect) so React's
  // set-state-in-effect rule stays satisfied. `safePage` below also
  // clamps if the row count shrinks for any other reason.
  const onQueryChangeReset = (q: string) => {
    setQuery(q)
    setPage(1)
  }
  const onSortChangeReset = (s: string) => {
    setSort(s)
    setPage(1)
  }
  const onPageSizeChangeReset = (n: number) => {
    setPageSize(n)
    setPage(1)
  }
  const onSelectedHealthChange = (next: Set<CcHealth>) => {
    setSelectedHealth(next)
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (pool.costCenters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cost centers</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyChart message="No cost centers routing Copilot." />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost centers</CardTitle>
        <p className="text-xs text-neutral-500 mt-1">
          {pool.costCenters.length} Cost center{pool.costCenters.length === 1 ? '' : 's'} routing Copilot.{' '}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(NAV_TO_BUDGET_MODEL_EVENT))}
            className="underline hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            How CCs affect Copilot billing →
          </button>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {pool.costCenters.length > 8 ? (
          <>
            <CcListToolbar
              query={query}
              onQueryChange={onQueryChangeReset}
              sort={sort}
              onSortChange={onSortChangeReset}
              sortOptions={sortOptions}
              total={pool.costCenters.length}
              visible={filteredRows.length}
            />
            <CcStatusChips
              selected={selectedHealth}
              onChange={onSelectedHealthChange}
              counts={healthCounts}
              total={pool.costCenters.length}
            />
          </>
        ) : null}

        {pool.costCenters.length > 20 ? (
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setShowBars(s => !s)}
              className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 inline-flex items-center gap-1"
              aria-expanded={showBars}
            >
              <span aria-hidden>{showBars ? '▾' : '▸'}</span>
              {showBars ? 'Hide bars' : 'Show bars'}
              <span className="text-neutral-400">
                · {pagedRows.length} on this page
              </span>
            </button>
          </div>
        ) : null}

        {showBars ? (
          <CostCenterBulletList
            rows={pagedRows.map(cc => ({
              key: cc.costCenterId,
              name: cc.name,
              budget: cc.budgetAmount,
              ceiling: cc.ubbCeiling,
              mtd: cc._mtd,
              projected: cc._projected,
              measured: cc._measured,
            }))}
            emptyMessage={query ? `No cost centers match "${query}".` : undefined}
          />
        ) : null}

        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900/40 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleHeaderClick('name')}
                    className="hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    aria-label="Sort by cost center"
                  >
                    Cost center{headerArrow('name')}
                  </button>
                </th>
                <th className="text-right font-medium px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleHeaderClick('seats')}
                    className="hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    aria-label="Sort by seats"
                  >
                    Seats{headerArrow('seats')}
                  </button>
                </th>
                <th className="text-right font-medium px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleHeaderClick('mtd')}
                    className="hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    aria-label="Sort by MTD"
                  >
                    MTD{headerArrow('mtd')}
                  </button>
                </th>
                <th className="text-right font-medium px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleHeaderClick('projected')}
                    className="hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    aria-label="Sort by projected"
                  >
                    Projected{headerArrow('projected')}
                  </button>
                </th>
                <th className="text-right font-medium px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleHeaderClick('budget')}
                    className="hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                    aria-label="Sort by budget"
                  >
                    Budget{headerArrow('budget')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                    No cost centers match "{query}".
                  </td>
                </tr>
              ) : null}
              {pagedRows.map(cc => {
                const measured = cc._measured
                const hasBudget = cc.budgetAmount !== null && cc.budgetAmount > 0
                const projPct = measured && hasBudget
                  ? Math.round((cc._projected / cc.budgetAmount!) * 100)
                  : null
                const projTone = projPct === null
                  ? ''
                  : projPct >= 100
                    ? 'text-red-700 dark:text-red-300'
                    : projPct >= 80
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-neutral-500'
                return (
                  <tr key={cc.costCenterId} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2 font-medium text-neutral-700 dark:text-neutral-300">
                      {cc.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {cc.seatCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {measured ? formatCurrency(cc._mtd) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {measured ? (
                        <span>
                          {formatCurrency(cc._projected)}
                          {projPct !== null && (
                            <span className={cn('ml-1.5 text-[10px] font-medium', projTone)}>
                              {projPct}%
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {cc.budgetAmount === null ? (
                        <span className="text-neutral-500">Uncapped</span>
                      ) : (
                        formatCurrency(cc.budgetAmount)
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 ? (
          <CcListPagination
            page={safePage}
            pageSize={pageSize}
            total={filteredRows.length}
            onPageChange={setPage}
            onPageSizeChange={onPageSizeChangeReset}
          />
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
 * Bullet chart for cost centers. One row per CC: MTD as a solid bar,
 * projected as a lighter trailing segment. Each row is normalized to its
 * own scale (the CC budget = full bar width); overflow clamps at 100%
 * and shows a "proj 112%" badge on the right. Uncapped CCs render as a
 * faint dashed bar with the raw MTD/projected text on the right.
 */
function CostCenterBulletList({
  rows,
  emptyMessage,
}: {
  rows: CcBulletRow[]
  emptyMessage?: string
}) {
  // Rows already filtered/sorted by parent (CostCenterStatusCard toolbar).
  // We render as-is so search + sort in the parent drive this view too.
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 space-y-3">
      <div className="flex items-center gap-4 text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500" />MTD
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-300 dark:bg-emerald-500/40" />Projected
        </span>
        <span className="ml-auto">Each bar = 0 → cost center budget</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-neutral-500">
          {emptyMessage ?? 'No cost centers.'}
        </div>
      ) : null}
      {rows.map(row => (
        <CcBulletRowView key={row.key} row={row} />
      ))}
    </div>
  )
}

function CcBulletRowView({ row }: { row: CcBulletRow }) {
  const { name, budget, mtd, projected, measured } = row

  // Per-row scale: budget = 100% of the bar. Overflow is clamped at 100%
  // and surfaced via the right-side "proj 112%" badge. Uncapped CCs get
  // a faint dashed bar instead since there's no cap to scale against.
  const hasBudget = budget !== null && budget > 0
  const mtdPct = hasBudget ? Math.min(100, (mtd / budget!) * 100) : 100
  const projPct = hasBudget ? Math.min(100, (projected / budget!) * 100) : 100
  // At budget (>= 100%) counts as "over" for color/badge — the cap is hit.
  // 80%+ counts as "near".
  const overBudget = hasBudget && projected >= budget!
  const nearBudget = hasBudget && projected >= budget! * 0.8 && !overBudget
  const fillColor = overBudget
    ? 'bg-red-500'
    : nearBudget
      ? 'bg-amber-500'
      : 'bg-emerald-500'
  const trailColor = overBudget
    ? 'bg-red-300 dark:bg-red-500/40'
    : nearBudget
      ? 'bg-amber-300 dark:bg-amber-500/40'
      : 'bg-emerald-300 dark:bg-emerald-500/40'
  const uncappedBar = !hasBudget

  const numericLabel = (() => {
    if (!measured) {
      return <span className="text-neutral-400">—</span>
    }
    if (!hasBudget) {
      return (
        <span className="text-neutral-500">
          {formatCurrencyWhole(mtd)} · uncapped
        </span>
      )
    }
    return (
      <span className="text-neutral-700 dark:text-neutral-200">
        {formatCurrencyWhole(mtd)} / {formatCurrencyWhole(budget!)}
      </span>
    )
  })()

  // Right-edge badge sits in its own fixed-width column so every bar ends
  // at the same x-position regardless of badge presence. Always rendered
  // (green for safe rows) so the eye has a consistent landmark.
  const projDisplayPct = hasBudget && projected > 0
    ? Math.round((projected / budget!) * 100)
    : null
  const badge = (() => {
    if (!measured || !hasBudget || projDisplayPct === null) return null
    const tone = overBudget
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
      : nearBudget
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
    return (
      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums', tone)}>
        {projDisplayPct}%
      </span>
    )
  })()

  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_2.75rem_6.25rem] items-center gap-x-2">
      <div
        className="text-xs font-medium truncate text-neutral-700 dark:text-neutral-300"
        title={name}
      >
        {name}
      </div>
      <div
        className={cn(
          'relative h-3 rounded-sm overflow-hidden',
          uncappedBar
            ? 'bg-neutral-50 dark:bg-neutral-800/30 border border-dashed border-neutral-200 dark:border-neutral-700'
            : 'bg-neutral-100 dark:bg-neutral-800/70',
        )}
      >
        <div
          className={cn('absolute inset-y-0 left-0', trailColor)}
          style={{ width: `${projPct}%` }}
          title={`Projected ${formatCurrency(projected)}`}
        />
        <div
          className={cn('absolute inset-y-0 left-0', fillColor)}
          style={{ width: `${mtdPct}%` }}
          title={`MTD ${formatCurrency(mtd)}`}
        />
      </div>
      <div className="text-right">{badge}</div>
      <div className="text-[11px] tabular-nums text-right whitespace-nowrap">
        {numericLabel}
      </div>
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
  universalUbb,
  entAmount,
  pool,
  seats,
  budgets,
  loginToCostCenter,
}: {
  forecast: ReturnType<typeof forecastSummary>
  universalUbb: import('@/lib/api').UniversalUbb | null
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
      title: `${forecast.alreadyOver} user${forecast.alreadyOver === 1 ? '' : 's'} over individual UBB`,
      hint: 'Already over individual UBB. Blocked only if UBB is set to prevent further usage.',
      ctaLabel: 'Review',
      onCta: () =>
        window.dispatchEvent(new CustomEvent(NAV_TO_INDIVIDUAL_EVENT, { detail: {} })),
    })
  }
  if (forecast.projectedOver > 0) {
    items.push({
      id: 'projected-over',
      severity: 'medium',
      title: `${forecast.projectedOver} user${forecast.projectedOver === 1 ? '' : 's'} projected over UBB`,
      hint: 'On track to exceed cap.',
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
      hint: "No enterprise cap on metered charges.",
      ctaLabel: 'Set budget',
      onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT)),
    })
  }
  if (pool.overAllocated && entAmount !== null) {
    const overshoot = pool.cappedTotal + pool.uncappedTotal + pool.unassignedTotal - entAmount
    items.push({
      id: 'over-alloc',
      severity: 'high',
      title: `Cost center commitments exceed enterprise budget by ${formatCurrency(overshoot)}`,
      hint: 'Cost center commitments exceed the enterprise cap.',
      ctaLabel: 'Open budgets',
      onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT)),
    })
  }
  if (!universalUbb) {
    const indLogins = new Set(budgets.filter(b => b.user).map(b => b.user.toLowerCase()))
    const fallbackSeats = seats.filter(s => !indLogins.has(s.login.toLowerCase())).length
    if (fallbackSeats > 0) {
      items.push({
        id: 'missing-univ',
        severity: 'medium',
        title: `No universal UBB. ${fallbackSeats.toLocaleString()} seat${fallbackSeats === 1 ? '' : 's'} have no per-user cap`,
        hint: 'Pool drawdown is uncapped until the pool runs out.',
        ctaLabel: 'Set universal UBB',
        onCta: () => window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT)),
      })
    }
  }
  // Uncapped CCs whose seats include any without individual UBB coverage —
  // a recipe for surprise spend once the pool exhausts.
  const indLoginsForCcCheck = new Set(
    budgets.filter(b => b.user).map(b => b.user.toLowerCase()),
  )
  const uncappedRiskyCcs = pool.costCenters.filter(cc => {
    if (cc.budgetAmount !== null) return false
    if (universalUbb) return false // universal UBB covers them
    // count seats in this CC without an individual UBB
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
      title: `${uncappedRiskyCcs.length} uncapped cost center${uncappedRiskyCcs.length === 1 ? '' : 's'} have seats without UBB fallback`,
      hint: 'No cost center budget and no user cap after pool exhaustion.',
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
            All clear. No items to address.
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
