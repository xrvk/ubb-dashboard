import type {
  CopilotUsageSummary,
  CostCenter,
  CostCenterBudget,
  EnterpriseBudget,
  UniversalUlb,
  UserBudget,
} from './api'

/**
 * Generate N synthetic user budgets for UI scale testing.
 * Distribution: ~10% over budget, ~15% near limit, ~75% ok.
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
    if (bucket < 0.03) {
      // 100%+ (blocked / over): a small tail, mostly 100-115%
      consumed = budget * (1 + rand() * 0.15)
    } else if (bucket < 0.08) {
      // 90-100% (about to block)
      consumed = budget * (0.9 + rand() * 0.1)
    } else if (bucket < 0.15) {
      // 80-90% (getting close)
      consumed = budget * (0.8 + rand() * 0.1)
    } else if (bucket < 0.3) {
      // 50-80% (moderate)
      consumed = budget * (0.5 + rand() * 0.3)
    } else {
      // 0-50% (low)
      consumed = budget * rand() * 0.5
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
 * Demo seats: a superset of the demo budget users so the "Add ULB" autocomplete
 * can suggest users who don't yet have an individual cap. The org assignment
 * mirrors the CC layout in generateDemoCostCenters so seats line up cleanly
 * with the User and Org based CC resources.
 */
export function generateDemoSeats(count: number) {
  const totalSeats = Math.ceil(count * 1.5)
  // Match the split used by generateDemoCostCenters: platform-eng (User-based,
  // override-bearing), then data-platform / devx / security (Org-based).
  const peSize = Math.min(Math.round(totalSeats * 0.44), totalSeats)
  const dpSize = Math.min(Math.round(totalSeats * 0.36), totalSeats - peSize)
  const dxSize = Math.min(Math.round(totalSeats * 0.13), totalSeats - peSize - dpSize)
  // security gets the remainder so every seat lands somewhere
  const out: Array<{ login: string; orgLogin: string | null; lastActivityAt: string | null; planType: string | null }> = []
  for (let i = 0; i < totalSeats; i += 1) {
    const idx = i + 1
    let orgLogin: string
    if (i < peSize) orgLogin = 'platform-eng'
    else if (i < peSize + dpSize) orgLogin = 'data-platform'
    else if (i < peSize + dpSize + dxSize) orgLogin = 'devx'
    else orgLogin = 'security'
    out.push({
      login: `demo-user-${String(idx).padStart(4, '0')}`,
      orgLogin,
      lastActivityAt: null,
      planType: 'business',
    })
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
export function generateDemoCostCenters(count: number): CostCenter[] {
  const totalSeats = Math.ceil(count * 1.5)
  const peSize = Math.min(Math.round(totalSeats * 0.44), totalSeats)

  const platformEngUsers = Array.from({ length: peSize }, (_, i) => ({
    type: 'User' as const,
    name: `demo-user-${String(i + 1).padStart(4, '0')}`,
  }))

  return [
    { id: 'demo-cc-pe', name: 'platform-eng', state: 'active', resources: platformEngUsers },
    { id: 'demo-cc-dp', name: 'data-platform', state: 'active', resources: [{ type: 'Org', name: 'data-platform' }] },
    { id: 'demo-cc-dx', name: 'devx', state: 'active', resources: [{ type: 'Org', name: 'devx' }] },
    { id: 'demo-cc-sec', name: 'security', state: 'active', resources: [{ type: 'Org', name: 'security' }] },
  ]
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

export function generateDemoUniversalUlb(): UniversalUlb {
  return {
    id: 'demo-uulb',
    budgetAmount: 50,
    consumedAmount: 0,
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
export function generateDemoCostCenterBudgets(): Map<string, CostCenterBudget> {
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
  const seatCount = Math.max(budgets.length, 1)
  const cbSeats = Math.round(seatCount * 0.7)
  const ceSeats = seatCount - cbSeats
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
