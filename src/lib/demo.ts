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
