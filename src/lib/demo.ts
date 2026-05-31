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
 * Build a deterministic set of cost centers that, combined with the demo
 * budgets above, trip exactly two common constraint failures in the banner:
 *
 *   1. per_cc — platform-eng's members' effective ULBs exceed its CC budget.
 *   2. cc_vs_enterprise — the sum of all four CC budgets exceeds the
 *      enterprise envelope.
 *
 * All seats are assigned to a CC so the unassignedLeftover check passes
 * trivially (it would otherwise piggyback on the cc_vs_enterprise breach
 * and surface as a third banner item).
 *
 * Membership is keyed off the same `demo-user-NNNN` login scheme used by
 * generateDemoSeats so loginToCostCenter resolves cleanly.
 */
export function generateDemoCostCenters(count: number): CostCenter[] {
  const totalSeats = Math.ceil(count * 1.5)
  // Split the entire seat pool across four CCs — no leftover users.
  // platform-eng is intentionally largest and biased toward the override-bearing
  // user range (1..count) so its effective ULB sum overshoots its budget.
  const peSize = Math.min(Math.round(totalSeats * 0.44), totalSeats)
  const dpSize = Math.min(Math.round(totalSeats * 0.36), totalSeats - peSize)
  const dxSize = Math.min(Math.round(totalSeats * 0.13), totalSeats - peSize - dpSize)
  const secSize = Math.max(0, totalSeats - peSize - dpSize - dxSize)
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
    budgetAmount: 9000,
    excludeCostCenterUsage: false,
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
