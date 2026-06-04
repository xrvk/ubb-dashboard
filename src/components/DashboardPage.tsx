import { useEffect, useMemo, useState } from 'react'
import { CurrencyDollar, ChartLineUp, Users, ShieldCheck } from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { useCredentials } from '@/hooks/use-credentials'
import { computePoolSplit } from '@/lib/poolSplit'
import { forecastSummary } from '@/lib/status'
import { getEffectiveDemoAsof } from '@/lib/demo'
import {
  includedAiCredits,
  isCreditPromoActive,
  seatCostBreakdown,
  type IncludedCredits,
} from '@/lib/pricing'
import { projectMonthlyBudget } from '@/lib/projection'
import { cn, formatCurrency } from '@/lib/utils'
import type { CopilotUsageSummary } from '@/lib/api'
import { ConstraintsBanner } from '@/components/ConstraintsBanner'

/**
 * Top-level Dashboard for the org variant. Single-screen rollup of the
 * organization's AI credit posture: where the pool is committed, how the org
 * budget compares to effective per-user caps, and where MTD spend is trending.
 *
 * Every section is read-only — editing happens on the dedicated tabs (Org
 * Budget, Universal ULB, Individual ULBs).
 */
export function DashboardPage() {
  const {
    orgBudget,
    universalUlb,
    seats,
    budgets,
    usageSummary,
  } = useCredentials()

  const pool = useMemo(
    () => computePoolSplit({ orgBudget, universalUlb, seats, userBudgets: budgets }),
    [orgBudget, universalUlb, seats, budgets],
  )

  const demoAsof = useMemo(() => getEffectiveDemoAsof() ?? undefined, [])
  const forecast = useMemo(() => forecastSummary(budgets, demoAsof), [budgets, demoAsof])
  const seatCost = useMemo(() => seatCostBreakdown(seats), [seats])

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

  /** Σ universal ULB consumed + Σ individual ULB consumed. The two budget
   * scopes that report consumed_amount via the budgets API. The billing
   * usage summary is the truth-of-record for total AIC pool draw. */
  const trackedForecast = useMemo(() => {
    const univMtd = universalUlb?.consumedAmount ?? 0
    const univProj = projectMonthlyBudget(univMtd, 0, demoAsof).projectedMonthTotal
    const indMtd = forecast.spendMtd
    const indProj = forecast.projectedEom
    const actualMtd = usageSummary?.aiCreditsGross ?? null
    const actualProjected =
      actualMtd !== null
        ? projectMonthlyBudget(actualMtd, 0, demoAsof).projectedMonthTotal
        : null
    return {
      universal: { mtd: univMtd, projected: univProj, hasBudget: !!universalUlb },
      individual: { mtd: indMtd, projected: indProj },
      totalMtd: actualMtd ?? univMtd + indMtd,
      totalProjected: actualProjected ?? univProj + indProj,
      hasActual: actualMtd !== null,
    }
  }, [universalUlb, forecast.spendMtd, forecast.projectedEom, usageSummary, demoAsof])

  const indCoverage = useMemo(() => {
    const seatLogins = new Set(seats.map(s => s.login.toLowerCase()))
    let withInd = 0
    for (const b of budgets) {
      if (b.user && seatLogins.has(b.user.toLowerCase())) withInd += 1
    }
    return { withInd, total: seats.length }
  }, [seats, budgets])

  const orgCap = pool.orgBudget
  const poolSize = credits.totalCredits > 0 ? credits.totalDollars : null
  const poolRemaining = poolSize === null ? null : Math.max(0, poolSize - trackedForecast.totalMtd)

  return (
    <div className="space-y-8">
      <ConstraintsBanner />

      {/* § 1 — Pool & licenses */}
      <Section
        title="AI credit pool and licenses"
        rightSlot={
          naturalPromoActive ? (
            <button
              type="button"
              onClick={() => setPromoDisabled(v => !v)}
              title={
                promoDisabled
                  ? 'Click to apply the promotional credit boost (Jun 1 – Aug 31 2026)'
                  : "Click to simulate a customer that doesn't qualify for the promo"
              }
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap cursor-pointer transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-950',
                promoDisabled
                  ? 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-500 dark:text-neutral-400 line-through hover:bg-neutral-200 dark:hover:bg-neutral-700/60'
                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60',
              )}
            >
              Promotional credits · Jun 1 – Aug 31 2026
            </button>
          ) : null
        }
      >
        <PoolAndLicensesCard
          seatCost={seatCost}
          usage={usageSummary}
          credits={credits}
        />
      </Section>

      {/* § 2 — Org budget forecast */}
      <Section title="Spend forecast">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<CurrencyDollar size={18} weight="duotone" className="text-emerald-600" />}
            label="Org budget cap"
            value={orgCap === null ? '—' : formatCurrency(orgCap)}
            sub={orgCap === null ? 'No org-level budget set' : 'Monthly cap'}
          />
          <StatCard
            icon={<ChartLineUp size={18} weight="duotone" className="text-sky-600" />}
            label="Spent MTD"
            value={formatCurrency(trackedForecast.totalMtd)}
            sub={trackedForecast.hasActual ? 'From billing API' : 'Sum of tracked ULBs'}
          />
          <StatCard
            icon={<ChartLineUp size={18} weight="duotone" className="text-amber-600" />}
            label="Projected EoM"
            value={formatCurrency(trackedForecast.totalProjected)}
            sub={
              orgCap !== null && trackedForecast.totalProjected > orgCap
                ? `Projected to exceed cap by ${formatCurrency(trackedForecast.totalProjected - orgCap)}`
                : 'Linear projection from MTD'
            }
          />
          <StatCard
            icon={<ShieldCheck size={18} weight="duotone" className="text-emerald-600" />}
            label="Pool remaining"
            value={poolRemaining === null ? '—' : formatCurrency(poolRemaining)}
            sub={poolSize === null ? 'No Copilot seats' : `Of ${formatCurrency(poolSize)} pool`}
          />
        </div>
      </Section>

      {/* § 3 — ULB coverage */}
      <Section title="ULB coverage">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<Users size={18} weight="duotone" className="text-emerald-600" />}
            label="Seats with individual ULB"
            value={indCoverage.withInd.toLocaleString()}
            sub={`Of ${indCoverage.total.toLocaleString()} Copilot seats`}
          />
          <StatCard
            icon={<Users size={18} weight="duotone" className="text-sky-600" />}
            label="Universal ULB"
            value={universalUlb ? formatCurrency(universalUlb.budgetAmount) : 'Not set'}
            sub={
              universalUlb
                ? `${Math.max(0, indCoverage.total - indCoverage.withInd).toLocaleString()} seats default to this cap`
                : 'Seats without an individual cap have no fallback cap'
            }
          />
          <StatCard
            icon={<CurrencyDollar size={18} weight="duotone" className="text-amber-600" />}
            label="Committed (Σ ULB caps)"
            value={formatCurrency(pool.individualUlbTotal + pool.universalUlbDraw)}
            sub={
              orgCap === null
                ? 'No org cap to compare against'
                : pool.overAllocated
                  ? `Over the ${formatCurrency(orgCap)} org cap`
                  : `${formatCurrency(pool.headroom)} headroom under the org cap`
            }
          />
        </div>
      </Section>
    </div>
  )
}

function PoolAndLicensesCard({
  seatCost,
  usage,
  credits,
}: {
  seatCost: ReturnType<typeof seatCostBreakdown>
  usage: CopilotUsageSummary | null
  credits: IncludedCredits
}) {
  if (credits.totalCredits === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-neutral-500 pt-6">
          No Copilot Business seats.
        </CardContent>
      </Card>
    )
  }
  const poolValueWhole = `$${Math.round(credits.totalDollars).toLocaleString('en-US')}`
  const grossMtd = usage?.aiCreditsGross ?? null
  const meteredMtd = usage?.aiCreditsNet ?? null
  const billedMtd = usage !== null ? usage.cbLicenseNet + usage.ceLicenseNet : null
  const poolDrawn = grossMtd === null ? 0 : Math.min(grossMtd, credits.totalDollars)
  const poolPct = credits.totalDollars > 0 ? Math.min(100, (poolDrawn / credits.totalDollars) * 100) : 0

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Tile
            tone="amber"
            label="Total AI credits / month"
            value={credits.totalCredits.toLocaleString()}
            sub="from all seats"
          />
          <Tile
            tone="emerald"
            label="Pool value"
            value={poolValueWhole}
            sub="@ $0.01 per AI credit"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Pool drawdown
            </div>
            <div className="text-xs tabular-nums text-neutral-500">
              {formatCurrency(poolDrawn)} / {poolValueWhole}
              {meteredMtd !== null && meteredMtd > 0 ? (
                <span className="ml-2 text-red-600 dark:text-red-400">
                  + {formatCurrency(meteredMtd)} metered
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-1 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${poolPct.toFixed(1)}%` }}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-xs text-neutral-500">
          <div>
            <div className="uppercase tracking-wide">Business seats</div>
            <div className="text-neutral-700 dark:text-neutral-300 tabular-nums">
              {seatCost.business.toLocaleString()}
            </div>
          </div>
          {seatCost.enterprise > 0 ? (
            <div>
              <div className="uppercase tracking-wide">Enterprise seats</div>
              <div className="text-neutral-700 dark:text-neutral-300 tabular-nums">
                {seatCost.enterprise.toLocaleString()}
              </div>
            </div>
          ) : null}
          <div>
            <div className="uppercase tracking-wide">License cost (MTD)</div>
            <div className="text-neutral-700 dark:text-neutral-300 tabular-nums">
              {billedMtd !== null ? formatCurrency(billedMtd) : '—'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Tile({
  tone,
  label,
  value,
  sub,
}: {
  tone: 'amber' | 'emerald'
  label: string
  value: string
  sub: string
}) {
  const tones =
    tone === 'amber'
      ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100'
      : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100'
  const labelTone =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-emerald-700 dark:text-emerald-300'
  return (
    <div className={cn('rounded-md border p-3', tones)}>
      <div className={cn('text-[11px] uppercase tracking-wide', labelTone)}>{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      <div className={cn('text-[11px] mt-0.5', labelTone)}>{sub}</div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-500">
          {icon} {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-0.5 text-xs text-neutral-500">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}

function Section({
  title,
  rightSlot,
  children,
}: {
  title: string
  rightSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {rightSlot}
      </div>
      {children}
    </section>
  )
}
