import type {
  CopilotUsageSummary,
  OrgBudget,
  UniversalUlb,
  UserBudget,
} from './api'
import type { CachedReport } from './reportCache'
import type { UserAicAggregate } from './usageReport'

/**
 * Generate N synthetic user budgets for UI scale testing. Distribution is
 * weighted toward visible states that matter for the demo story:
 *   - ~8%  capped/over (>=100% of budget) — blocked, needs intervention
 *   - ~10% nearing limit (85-100%)        — likely to block this cycle
 *   - ~14% mid-burn (60-85%)              — healthy but watch list
 *   - ~22% moderate (30-60%)
 *   - ~46% low (0-30%)
 * Mirrors what an admin would see ~5 days before month end with the default
 * demo asof: a meaningful tail of capped and about-to-cap users plus a
 * background of healthy ones.
 */
export function generateDemoBudgets(count: number, seed = 42): UserBudget[] {
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }

  const tiers: Array<{ budget: number; weight: number }> = [
    { budget: 10, weight: 0.15 },
    { budget: 25, weight: 0.25 },
    { budget: 50, weight: 0.3 },
    { budget: 100, weight: 0.2 },
    { budget: 200, weight: 0.08 },
    { budget: 500, weight: 0.02 },
  ]

  const pickTier = () => {
    const r = rand()
    let acc = 0
    for (const t of tiers) {
      acc += t.weight
      if (r <= acc) return t.budget
    }
    return tiers[tiers.length - 1].budget
  }

  const out: UserBudget[] = []
  for (let i = 0; i < count; i += 1) {
    const budget = pickTier()
    const bucket = rand()
    let consumed: number
    if (bucket < 0.08) {
      // 100-120% — capped / blocked (preventFurtherUsage is true on all
      // demo users, so anything >= 100 surfaces as "already over").
      consumed = budget * (1 + rand() * 0.2)
    } else if (bucket < 0.18) {
      // 85-100% — about to block this cycle
      consumed = budget * (0.85 + rand() * 0.15)
    } else if (bucket < 0.32) {
      // 60-85% — watch list; projection at 5 days left often shows over
      consumed = budget * (0.6 + rand() * 0.25)
    } else if (bucket < 0.54) {
      // 30-60% — moderate
      consumed = budget * (0.3 + rand() * 0.3)
    } else {
      // 0-30% — low
      consumed = budget * rand() * 0.3
    }
    consumed = Math.round(consumed * 100) / 100
    out.push({
      id: `demo-${i}`,
      user: `demo-user-${String(i + 1).padStart(4, '0')}`,
      budgetAmount: budget,
      consumedAmount: consumed,
      preventFurtherUsage: true,
      willAlert: rand() < 0.3,
      alertRecipients: [],
    })
  }
  return out
}

export function readDemoCountFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const v = params.get('demo')
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, 50_000)
}


/**
 * Optional `?pool=N` query param (0-100) — target % drawn from the shared
 * AI credit pool for the demo. When set, demo individual-budget and
 * universal-ULB consumed amounts are scaled so total ULB consumption
 * matches `N%` of the seat-derived pool value, and `aiCreditsNet` is
 * forced to 0 (no metered overflow yet) when `N` is below 100.
 */
export function readDemoPoolPctFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const v = params.get('pool')
  if (v === null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}


/**
 * Demo "as of" date for projections. When set via `?asof=YYYY-MM-DD`,
 * projection helpers treat that date as today so the projected trail
 * is visible even when the real calendar date is the last day of the
 * month (where projected == MTD by definition). Returns null when the
 * param is missing or not a valid date.
 */
export function readDemoAsofFromUrl(): Date | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const v = params.get('asof')
  if (!v) return null
  const d = new Date(v + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Resolve the effective "as of" date for demo projections. Priority:
 *   1. Explicit `?asof=YYYY-MM-DD` URL param.
 *   2. When demo mode is active (`?demo=...` is set) but no asof was given,
 *      default to "5 days before month end" so the hero, table, and CC
 *      projections show a meaningful runway by default.
 *   3. Otherwise null (real-mode callers continue to use `new Date()`).
 */
export function getEffectiveDemoAsof(): Date | null {
  const fromUrl = readDemoAsofFromUrl()
  if (fromUrl) return fromUrl
  if (readDemoCountFromUrl() === null) return null
  const now = new Date()
  // Last day of current month at noon (noon avoids any DST/TZ edge weirdness).
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0)
  lastDay.setDate(lastDay.getDate() - 5)
  return lastDay
}

/**
 * Demo seats: a superset of the demo budget users so the "Add ULB" autocomplete
 * can suggest users who don't yet have an individual cap. Every seat reports
 * the same `orgLogin` since the org-variant audience is a single organization.
 */
export function generateDemoSeats(count: number) {
  const totalSeats = Math.ceil(count * 1.5)
  const out: Array<{ login: string; orgLogin: string | null; lastActivityAt: string | null; planType: string | null }> = []
  for (let i = 0; i < totalSeats; i += 1) {
    const idx = i + 1
    out.push({
      login: `demo-user-${String(idx).padStart(4, '0')}`,
      orgLogin: 'demo-org',
      lastActivityAt: null,
      planType: 'business',
    })
  }
  return out
}


export function generateDemoOrgBudget(): OrgBudget {
  return {
    id: 'demo-org',
    budgetAmount: 9000,
    preventFurtherUsage: true,
    willAlert: true,
    alertRecipients: ['finance@demo.test'],
  }
}

export function generateDemoUniversalUlb(budgets?: UserBudget[]): UniversalUlb {
  // Mirror the universal share assumed by generateDemoUsageSummary (18% of
  // individual consumption). Without this, the Forecast Breakdown card
  // shows Universal ULB at $0 in default demo mode, which contradicts the
  // pool drawdown the usage summary reports.
  const indivConsumed = (budgets ?? []).reduce((s, b) => s + b.consumedAmount, 0)
  const consumed = Math.round(indivConsumed * 0.18 * 100) / 100
  return {
    id: 'demo-uulb',
    budgetAmount: 50,
    consumedAmount: consumed,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

/**
 * Scale the consumed amounts on demo budgets + universal ULB so that their
 * sum matches `targetDollars`. Mutates inputs in place. Used when the demo
 * is told (via `?pool=N`) to show a partially-drawn pool.
 *
 * Preserves users who are already at/over their budget at exactly their
 * budget amount or above. The scale factor is applied only to under-budget
 * users so the demo keeps a meaningful "blocked" / "projected over" tail
 * regardless of the pool fill %, while the total still lands near
 * targetDollars.
 */
export function scaleDemoConsumptionTo(
  targetDollars: number,
  budgets: UserBudget[],
  universal: UniversalUlb,
) {
  if (targetDollars <= 0) {
    universal.consumedAmount = 0
    for (const b of budgets) b.consumedAmount = 0
    return
  }
  // Hold universal at ~18% of total (matches generateDemoUsageSummary mix).
  const targetUniv = Math.round(targetDollars * 0.18 * 100) / 100
  const targetInd = Math.max(0, targetDollars - targetUniv)
  universal.consumedAmount = targetUniv

  // Split users into those at/over budget (preserved) and under-budget
  // (scaled). "At/over" means consumed >= 0.95 of budget so the
  // about-to-block tail is also kept.
  const overUsers = budgets.filter(b => b.consumedAmount >= b.budgetAmount * 0.95)
  const underUsers = budgets.filter(b => b.consumedAmount < b.budgetAmount * 0.95)
  const preservedInd = overUsers.reduce((s, b) => s + b.consumedAmount, 0)
  const currentUnder = underUsers.reduce((s, b) => s + b.consumedAmount, 0)
  const remainingTarget = Math.max(0, targetInd - preservedInd)
  if (currentUnder <= 0) return
  const scale = remainingTarget / currentUnder
  for (const b of underUsers) {
    b.consumedAmount = Math.round(b.consumedAmount * scale * 100) / 100
  }
}




export function generateDemoUsageSummary(
  budgets: UserBudget[],
  opts?: { poolExhausted?: boolean },
): CopilotUsageSummary {
  const poolExhausted = opts?.poolExhausted ?? true
  const indivConsumed = budgets.reduce((s, b) => s + b.consumedAmount, 0)
  const universalConsumed = Math.round(indivConsumed * 0.18 * 100) / 100
  const ccRouted = Math.round(indivConsumed * 0.12 * 100) / 100
  const totalPoolDraw = Math.round((indivConsumed + universalConsumed + ccRouted) * 100) / 100
  const aiCreditsNet = poolExhausted ? totalPoolDraw : 0
  // Gross = full pool drawdown regardless of whether metering kicked in.
  // CC budgets cap gross draw, so this is what the per-CC bullets compare
  // against. After exhaustion, gross still includes the in-pool portion
  // plus the metered overage (modeled here as a 5% bump).
  const aiCreditsGross = poolExhausted
    ? Math.round(totalPoolDraw * 1.05 * 100) / 100
    : totalPoolDraw
  const now = new Date()
  // Org-variant audience has no enterprise account, so Copilot Enterprise
  // seats are impossible. Treat every demo seat as Copilot Business.
  const cbSeats = Math.max(budgets.length, 1)
  const ceSeats = 0
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    aiCreditsNet,
    aiCreditsGross,
    codingAgentNet: Math.round(aiCreditsNet * 0.08 * 100) / 100,
    cbLicenseNet: Math.round(cbSeats * 19 * 100) / 100,
    ceLicenseNet: Math.round(ceSeats * 39 * 100) / 100,
    raw: [],
  }
}

/**
 * Build 2 months of synthetic per-user AIC aggregates so demo mode lands on
 * the Universal ULB planner with usable data. Without this, the planner is
 * empty until the user manually uploads a CSV.
 *
 * The distribution mirrors the budget tiers used elsewhere in demo:
 *   ~5% heavy ($80-$200/mo), ~10% high ($30-$80), ~25% mid ($5-$30),
 *   ~35% low ($0-$5), ~25% idle. With ~75 universal-only seats (demo=150),
 *   the Top 5% threshold lands a proposed ULB in the $80-$200 band, which
 *   collides with the small demo org budget ($9k) and exercises the
 *   pre-flight envelope check end-to-end.
 *
 * The second month is jittered down so aggregateMaxMonth has a meaningful
 * choice to make per user.
 */
export function generateDemoCachedReports(
  org: string,
  seats: Array<{ login: string }>,
  seed = 99,
): CachedReport[] {
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const lastUsedFor = (monthKey: string): string =>
    `${monthKey}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`

  const monthRows = (monthKey: string, scale: number): UserAicAggregate[] => {
    const out: UserAicAggregate[] = []
    for (const seat of seats) {
      const bucket = rand()
      let dollars: number
      if (bucket < 0.05) dollars = 80 + rand() * 120
      else if (bucket < 0.15) dollars = 30 + rand() * 50
      else if (bucket < 0.4) dollars = 5 + rand() * 25
      else if (bucket < 0.75) dollars = rand() * 5
      else dollars = 0
      dollars = Math.round(dollars * scale * 100) / 100
      if (dollars <= 0) continue
      const aic = Math.round(dollars * 100)
      out.push({
        username: seat.login,
        aicConsumed: aic,
        grossAmount: dollars,
        lastUsedDate: lastUsedFor(monthKey),
        codingAgentAic: Math.round(aic * 0.15),
      })
    }
    return out
  }

  const now = new Date()
  const monthKeyAt = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const last = monthKeyAt(1)
  const prior = monthKeyAt(2)
  const ingestedAt = Date.now()
  return [
    {
      // CachedReport still uses `enterprise` as its opaque cache-key field;
      // kept to minimize churn from the parent repo (the value is a slug,
      // the field name is just historical).
      enterprise: org,
      monthKey: prior,
      reportId: null,
      ingestedAt,
      source: 'generated',
      rows: monthRows(prior, 0.7),
    },
    {
      enterprise: org,
      monthKey: last,
      reportId: null,
      ingestedAt,
      source: 'generated',
      rows: monthRows(last, 1.0),
    },
  ]
}
