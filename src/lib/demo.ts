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
    if (bucket < 0.1) {
      // over
      consumed = budget * (1 + rand() * 0.9)
    } else if (bucket < 0.25) {
      // near
      consumed = budget * (0.8 + rand() * 0.19)
    } else {
      // ok
      consumed = budget * rand() * 0.7
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
