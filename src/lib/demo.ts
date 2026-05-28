import type { UserBudget } from './api'

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
