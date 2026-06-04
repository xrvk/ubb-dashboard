import type {
  CopilotUsageSummary,
  CostCenter,
  CostCenterBudget,
  EnterpriseBudget,
  UniversalUlb,
  UserBudget,
} from './api'
import { fillerBudgetFor, rollFillerHealth, rollFillerSeatCount } from './demoRng'
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
 * Optional `?cc=N` query param. Generates N total cost centers in demo
 * mode (clamped to 1..5000). The first 4 remain the "story" CCs
 * (platform-eng / data-platform / devx / security) so the constraint
 * banner still demonstrates per_cc + cc_vs_enterprise breaches; any
 * additional CCs are generic `team-NNN` Org resources with no seats and
 * a small budget, intended for stress-testing CC list rendering. Returns
 * null when the param is absent — callers fall back to the default 4-CC
 * layout.
 */
export function readDemoCcCountFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const v = params.get('cc')
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(Math.floor(n), 5000)
}

/**
 * Toggle for the "cost center exclusion" mode in demo. When set
 * (`?exclude=1`), the demo enterprise budget is created with
 * excludeCostCenterUsage=true so CCs become independent pools instead of
 * sub-allocations of the umbrella.
 */
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

export function readDemoExcludeCcFromUrl(): boolean {
  if (typeof window === 'undefined') return true
  const params = new URLSearchParams(window.location.search)
  const v = params.get('exclude')
  // Default ON in demo mode: independent CC pools is the more interesting
  // story for the dashboard. Pass `?exclude=0` to opt out.
  if (v === null) return true
  return v !== '0' && v !== 'false'
}

/**
 * Optional `?cb=N` / `?ce=M` overrides for the demo seat license split.
 *
 * When either param is present, the seat generator uses these exact counts
 * (defaulting the missing one to 0) instead of the default 70/30 CB/CE
 * derivation from `?demo=`. Useful for showcasing a pure-CE or pure-CB
 * enterprise. Returns null when neither param is set.
 */
export function readDemoSeatSplitFromUrl(): { cb: number; ce: number } | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const cbRaw = params.get('cb')
  const ceRaw = params.get('ce')
  if (cbRaw === null && ceRaw === null) return null
  const parse = (v: string | null): number => {
    if (v === null) return 0
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.floor(n)
  }
  return { cb: parse(cbRaw), ce: parse(ceRaw) }
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
 * can suggest users who don't yet have an individual cap. The org assignment
 * mirrors the CC layout in generateDemoCostCenters so seats line up cleanly
 * with the User and Org based CC resources.
 */
export function generateDemoSeats(
  count: number,
  ccCount?: number,
  split?: { cb: number; ce: number },
) {
  const totalSeats = split ? split.cb + split.ce : Math.ceil(count * 1.5)
  // Match the split used by generateDemoCostCenters: platform-eng (User-based,
  // override-bearing), then data-platform / devx / security (Org-based).
  const peSize = Math.min(Math.round(totalSeats * 0.44), totalSeats)
  const dpSize = Math.min(Math.round(totalSeats * 0.36), totalSeats - peSize)
  const dxSize = Math.min(Math.round(totalSeats * 0.13), totalSeats - peSize - dpSize)
  // security gets the remainder so every seat lands somewhere
  const out: Array<{ login: string; orgLogin: string | null; lastActivityAt: string | null; planType: string | null }> = []
  // Default 70/30 CB/CE split mirrors generateDemoUsageSummary's
  // license-cost math (cbSeats = round(total * 0.7), ceSeats = total -
  // cbSeats) so the Dashboard seat table and the License MTD figures stay
  // consistent. When `split` is provided, those exact counts are used
  // instead. CE seats are interleaved across orgs via a deterministic
  // stride so every CC ends up with a realistic mix.
  const cbSeats = split ? split.cb : Math.round(totalSeats * 0.7)
  const ceSeats = split ? split.ce : totalSeats - cbSeats
  const ceStride = ceSeats > 0 ? totalSeats / ceSeats : Infinity
  let ceAssigned = 0
  let cbAssigned = 0
  for (let i = 0; i < totalSeats; i += 1) {
    const idx = i + 1
    let orgLogin: string
    if (i < peSize) orgLogin = 'platform-eng'
    else if (i < peSize + dpSize) orgLogin = 'data-platform'
    else if (i < peSize + dpSize + dxSize) orgLogin = 'devx'
    else orgLogin = 'security'
    let isEnterprise =
      ceAssigned < ceSeats && i >= Math.floor(ceAssigned * ceStride)
    // Guard against running out of the other plan when an explicit split
    // is in play (e.g. cb=0 forces every remaining seat to CE).
    if (!isEnterprise && cbAssigned >= cbSeats && ceAssigned < ceSeats) {
      isEnterprise = true
    }
    if (isEnterprise) ceAssigned += 1
    else cbAssigned += 1
    out.push({
      login: `demo-user-${String(idx).padStart(4, '0')}`,
      orgLogin,
      lastActivityAt: null,
      planType: isEnterprise ? 'enterprise' : 'business',
    })
  }
  // Filler seats for `team-NNN` CCs (when ?cc=N>4). Each filler CC needs at
  // least one seat to appear in pool-split surfaces (`computePoolSplit`
  // skips zero-seat CCs in poolSplit.ts), and on the Dashboard "CCs
  // routing Copilot" list. Logins are namespaced so they don't collide
  // with `demo-user-NNNN` — they have no individual ULB, so their
  // effective cap falls back to the universal ULB amount. Seat counts
  // are rolled deterministically from the CC name via `rollFillerSeatCount`
  // so a) every reload renders the same demo, and b) the Dashboard sort
  // dropdown has a meaningful spread of CC sizes to sort by (5–50 seats,
  // biased toward small teams ~ log-uniform).
  const baseCcCount = 4
  if (ccCount && ccCount > baseCcCount) {
    const extras = ccCount - baseCcCount
    for (let i = 1; i <= extras; i += 1) {
      const orgName = `team-${String(i).padStart(3, '0')}`
      const seats = rollFillerSeatCount(orgName)
      for (let s = 0; s < seats; s += 1) {
        out.push({
          login: `${orgName}-user-${s + 1}`,
          orgLogin: orgName,
          lastActivityAt: null,
          planType: 'business',
        })
      }
    }
  }
  return out
}

/**
 * Build a deterministic set of cost centers that, combined with the demo
 * budgets above, trip exactly two common constraint failures in the banner:
 *
 *   1. per_cc — platform-eng's members' effective ULBs exceed its CC budget.
 *   2. cc_vs_enterprise — the sum of all four CC budgets exceeds the
 *      enterprise envelope.
 *
 * The CCs are split deliberately across both resource kinds so the UI shows
 * seat counts resolving from both bases (User and Org are not mutually
 * exclusive in production data):
 *   - platform-eng: User resources (the override-bearing user range so
 *     per-user effective ULBs overrun the CC cap).
 *   - data-platform / devx / security: Org resources (seats whose orgLogin
 *     matches resolve via the org path).
 *
 * All seats land in exactly one CC so the unassignedLeftover check stays
 * vacuous and doesn't surface as a third banner item.
 */
export function generateDemoCostCenters(count: number, ccCount?: number): CostCenter[] {
  const totalSeats = Math.ceil(count * 1.5)
  const peSize = Math.min(Math.round(totalSeats * 0.44), totalSeats)

  const platformEngUsers = Array.from({ length: peSize }, (_, i) => ({
    type: 'User' as const,
    name: `demo-user-${String(i + 1).padStart(4, '0')}`,
  }))

  const baseCcs: CostCenter[] = [
    { id: 'demo-cc-pe', name: 'platform-eng', state: 'active', resources: platformEngUsers },
    { id: 'demo-cc-dp', name: 'data-platform', state: 'active', resources: [{ type: 'Org', name: 'data-platform' }] },
    { id: 'demo-cc-dx', name: 'devx', state: 'active', resources: [{ type: 'Org', name: 'devx' }] },
    { id: 'demo-cc-sec', name: 'security', state: 'active', resources: [{ type: 'Org', name: 'security' }] },
  ]
  if (!ccCount || ccCount <= baseCcs.length) return baseCcs

  // Generic `team-NNN` filler CCs to stress-test the CC list / structure
  // diagram. They bind to Orgs that no demo seat is in, so they show 0
  // seats and don't perturb the per_cc breach math on platform-eng.
  const extras: CostCenter[] = []
  for (let i = baseCcs.length; i < ccCount; i += 1) {
    const idx = i - baseCcs.length + 1
    const name = `team-${String(idx).padStart(3, '0')}`
    extras.push({
      id: `demo-cc-${name}`,
      name,
      state: 'active',
      resources: [{ type: 'Org', name }],
    })
  }
  return [...baseCcs, ...extras]
}

export function generateDemoEnterpriseBudget(opts?: { excludeCostCenterUsage?: boolean }): EnterpriseBudget {
  return {
    id: 'demo-ent',
    budgetAmount: 9000,
    excludeCostCenterUsage: opts?.excludeCostCenterUsage ?? false,
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

/**
 * Every CC carries a budget so the unassignedLeftover check stays vacuous.
 * Numbers sit in the realistic $3k–$8k per-CC band but their sum ($20k) is
 * deliberately above the $9k enterprise cap — that's the cc_vs_enterprise
 * breach. platform-eng's $5k cap is intentionally below the effective ULB
 * sum of its ~100 override-bearing members, which trips per_cc on it alone.
 */
export function generateDemoCostCenterBudgets(extraCcs?: CostCenter[]): Map<string, CostCenterBudget> {
  const out = new Map<string, CostCenterBudget>()
  const add = (name: string, amount: number, hard: boolean, alert: boolean) => {
    out.set(name.toLowerCase(), {
      id: `demo-ccb-${name}`,
      costCenterName: name,
      budgetAmount: amount,
      preventFurtherUsage: hard,
      willAlert: alert,
      alertRecipients: alert ? ['platform-leads@demo.test'] : [],
    })
  }
  add('platform-eng', 5000, true, true)
  add('data-platform', 7000, true, false)
  add('devx', 5000, true, false)
  add('security', 3000, true, false)
  // Stamp a varied, deterministic budget on every additional CC (e.g. when
  // ?cc=N>4) so the dashboard / planner / structure diagram have meaningful
  // signal to render — ~10% "over", ~15% "near", ~75% "healthy" rolled
  // from the CC name (see demoRng.ts). The 4 named "story" CCs above
  // remain intentionally undersized to keep the constraint banner's
  // narrative working; filler over-CCs trip per_cc with tiny overshoots
  // ($15–$150 each) so the Phase 1 top-N cap surfaces the story CCs first.
  if (extraCcs) {
    for (const cc of extraCcs) {
      const lname = cc.name.toLowerCase()
      if (out.has(lname)) continue
      const seats = rollFillerSeatCount(cc.name)
      const health = rollFillerHealth(cc.name)
      add(cc.name, fillerBudgetFor(seats, health), true, false)
    }
  }
  return out
}

/**
 * Synthesize a plausible billing-usage summary for demo mode. AIC spend is
 * derived from the demo individual budgets plus a small "untracked CC-direct"
 * bucket so the dashboard's 3-way breakdown has data in every slice. When
 * `poolExhausted` is false (caller scaled consumption below pool capacity),
 * we report `aiCreditsNet = 0` because metering only kicks in after the
 * pool is empty.
 */
/**
 * Hand-crafted per-CC pool drawdown for the demo cost centers, so the
 * Dashboard CC bullet chart lands each CC at a deliberately different
 * health state for review/testing:
 *   platform-eng  ~$5,750 / $5,000 -> 115% (over)
 *   data-platform ~$7,000 / $7,000 -> 100% (at)
 *   devx          ~$4,000 / $5,000 ->  80% (near)
 *   security      ~$1,500 / $3,000 ->  50% (well under)
 * Amounts represent gross AI credit pool draw, which is what CC budgets
 * cap (and what the billing usage API returns as `aiCreditsGross` when
 * filtered by `cost_center_id`). Unknown CC names fall back to a seat
 * proportional split of `totalUsage.aiCreditsGross` so non-demo CCs that
 * sneak in still get a non-zero row.
 */
const DEMO_CC_GROSS_TARGETS: Record<string, number> = {
  'platform-eng': 5750,
  'data-platform': 7000,
  devx: 4000,
  security: 1500,
}

export function generateDemoUsageByCostCenter(
  costCenters: CostCenter[],
  ccSeatCounts: ReadonlyMap<string, number>,
  totalUsage: CopilotUsageSummary,
): Map<string, CopilotUsageSummary> {
  const out = new Map<string, CopilotUsageSummary>()
  const totalSeats = Array.from(ccSeatCounts.values()).reduce((s, n) => s + n, 0)
  for (const cc of costCenters) {
    const seats = ccSeatCounts.get(cc.id) ?? 0
    const share = totalSeats > 0 ? seats / totalSeats : 0
    const targetGross = DEMO_CC_GROSS_TARGETS[cc.name.toLowerCase()]
    const gross =
      typeof targetGross === 'number'
        ? targetGross
        : Math.round(totalUsage.aiCreditsGross * share * 100) / 100
    // Metered overage is only the share of `aiCreditsNet`, which is 0
    // until the pool is exhausted. Keep the proportional split so the
    // numbers stay self-consistent with the top-line.
    const net = Math.round(totalUsage.aiCreditsNet * share * 100) / 100
    out.set(cc.id, {
      year: totalUsage.year,
      month: totalUsage.month,
      costCenterId: cc.id,
      aiCreditsNet: net,
      aiCreditsGross: gross,
      codingAgentNet: Math.round(totalUsage.codingAgentNet * share * 100) / 100,
      cbLicenseNet: Math.round(totalUsage.cbLicenseNet * share * 100) / 100,
      ceLicenseNet: Math.round(totalUsage.ceLicenseNet * share * 100) / 100,
      raw: [],
    })
  }
  return out
}

export function generateDemoUsageSummary(
  budgets: UserBudget[],
  opts?: { poolExhausted?: boolean; seatSplit?: { cb: number; ce: number } },
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
  const seatCount = Math.max(budgets.length, 1)
  const cbSeats = opts?.seatSplit ? opts.seatSplit.cb : Math.round(seatCount * 0.7)
  const ceSeats = opts?.seatSplit ? opts.seatSplit.ce : seatCount - Math.round(seatCount * 0.7)
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    costCenterId: null,
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
 *   collides with the small demo enterprise envelope ($9k) and exercises
 *   the new pre-flight envelope check end-to-end.
 *
 * The second month is jittered down so aggregateMaxMonth has a meaningful
 * choice to make per user.
 */
export function generateDemoCachedReports(
  enterprise: string,
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
      enterprise,
      monthKey: prior,
      reportId: null,
      ingestedAt,
      source: 'generated',
      rows: monthRows(prior, 0.7),
    },
    {
      enterprise,
      monthKey: last,
      reportId: null,
      ingestedAt,
      source: 'generated',
      rows: monthRows(last, 1.0),
    },
  ]
}
