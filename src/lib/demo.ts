import type {
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
    { budget: 1, weight: 0.05 },
    { budget: 5, weight: 0.1 },
    { budget: 25, weight: 0.3 },
    { budget: 100, weight: 0.3 },
    { budget: 500, weight: 0.15 },
    { budget: 2000, weight: 0.07 },
    { budget: 9001, weight: 0.03 },
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
 * Demo seats: a superset of the demo budget users so the "Add ULB" autocomplete
 * can suggest users who don't yet have an individual cap.
 */
export function generateDemoSeats(count: number) {
  // Mirror the same naming scheme used by generateDemoBudgets, but pad with
  // extra users (50% more) so there are valid candidates without budgets.
  const orgs = ['platform-eng', 'data-platform', 'devx', 'security', 'mobile-apps', 'web', 'gaming-studio']
  const total = Math.ceil(count * 1.5)
  const out: Array<{ login: string; orgLogin: string | null; lastActivityAt: string | null; planType: string | null }> = []
  for (let i = 0; i < total; i += 1) {
    out.push({
      login: `demo-user-${String(i + 1).padStart(4, '0')}`,
      orgLogin: orgs[i % orgs.length],
      lastActivityAt: null,
      planType: 'business',
    })
  }
  return out
}

/**
 * Build a deterministic set of cost centers whose member sums + budgets are
 * deliberately calibrated to trip two common constraint failures, so demo
 * mode shows the Overview banner with real action items:
 *
 *   1. per_cc — both capped CCs (platform-eng, data-platform) have effective
 *      ULB sums (~$500 default × member count) that exceed their cost-center
 *      budgets, so they over-allocate.
 *   2. cc_vs_enterprise — sum of capped CC budgets + leftover users at the
 *      universal ULB exceeds the enterprise cap.
 *
 * Membership is keyed off the same `demo-user-NNNN` login scheme used by
 * generateDemoSeats so loginToCostCenter resolves cleanly.
 */
export function generateDemoCostCenters(count: number): CostCenter[] {
  const totalSeats = Math.ceil(count * 1.5)
  // Split the active seat pool four ways with one slice intentionally left
  // unassigned so the cc_vs_enterprise leftover branch is exercised.
  const peSize = Math.min(Math.round(totalSeats * 0.4), totalSeats)
  const dpSize = Math.min(Math.round(totalSeats * 0.27), totalSeats - peSize)
  const dxSize = Math.min(Math.round(totalSeats * 0.2), totalSeats - peSize - dpSize)
  const secSize = Math.min(Math.round(totalSeats * 0.07), totalSeats - peSize - dpSize - dxSize)
  const range = (start: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      type: 'User' as const,
      name: `demo-user-${String(start + i).padStart(4, '0')}`,
    }))

  let cursor = 1
  const platformEng = range(cursor, peSize); cursor += peSize
  const dataPlatform = range(cursor, dpSize); cursor += dpSize
  const devx = range(cursor, dxSize); cursor += dxSize
  const security = range(cursor, secSize)
  // Anything past cursor + secSize stays unassigned (leftover users).

  return [
    { id: 'demo-cc-pe', name: 'platform-eng', state: 'active', resources: platformEng },
    { id: 'demo-cc-dp', name: 'data-platform', state: 'active', resources: dataPlatform },
    { id: 'demo-cc-dx', name: 'devx', state: 'active', resources: devx },
    { id: 'demo-cc-sec', name: 'security', state: 'active', resources: security },
  ]
}

export function generateDemoEnterpriseBudget(): EnterpriseBudget {
  return {
    id: 'demo-ent',
    budgetAmount: 5000,
    excludeCostCenterUsage: false,
    preventFurtherUsage: true,
    willAlert: true,
    alertRecipients: ['finance@demo.test'],
  }
}

export function generateDemoUniversalUlb(): UniversalUlb {
  return {
    id: 'demo-uulb',
    budgetAmount: 500,
    consumedAmount: 0,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

/**
 * Two of the four CCs get budgets; the remaining two stay uncapped so the
 * uncapped-CC affordances ("at least $X", Set budget) also appear in demo.
 * Budgets are intentionally too low for the membership × universal-ULB math
 * to satisfy them — that's what produces the per_cc failures.
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
  add('data-platform', 3000, true, false)
  return out
}
