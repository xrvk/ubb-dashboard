import { describe, it, expect, vi } from 'vitest'
import { fetchUserBudgets, type ApiFetch, type RawBudget } from '@/lib/api'

function fakeBudget(i: number, scope: 'user' | 'enterprise' = 'user'): RawBudget {
  return {
    id: `b${i}`,
    budget_type: 'BundlePricing',
    budget_product_sku: 'ai_credits',
    budget_scope: scope,
    budget_amount: 10,
    prevent_further_usage: true,
    budget_entity_name: `user${i}`,
    budget_alerting: { will_alert: false, alert_recipients: [] },
    consumed_amount: 0,
    user: `user${i}`,
  }
}

describe('fetchUserBudgets pagination', () => {
  it('pages through the full list when the API returns 10 per page (10k budgets)', async () => {
    const TOTAL = 10_000
    const PAGE_SIZE = 10 // server-side cap
    // 9 of every 10 are user-scope, 1 is enterprise (just to vary)
    const all: RawBudget[] = []
    for (let i = 0; i < TOTAL; i += 1) {
      all.push(fakeBudget(i, i % 10 === 0 ? 'enterprise' : 'user'))
    }
    const fetchMock: ApiFetch = vi.fn(async path => {
      const m = String(path).match(/page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      const start = (page - 1) * PAGE_SIZE
      return {
        total_count: TOTAL,
        budgets: all.slice(start, start + PAGE_SIZE),
      }
    })

    const progress: Array<[number, number | undefined]> = []
    const result = await fetchUserBudgets(fetchMock, (loaded, total) => progress.push([loaded, total]))

    // 10k total / 10 per page = 1000 calls
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL / PAGE_SIZE)
    // 9 of every 10 are user-scope
    expect(result.userBudgets).toHaveLength(TOTAL * 0.9)
    // Total budget count reflects the API's total_count (all scopes/types)
    expect(result.totalBudgetCount).toBe(TOTAL)
    // Progress was reported
    expect(progress[progress.length - 1]).toEqual([TOTAL, TOTAL])
  })

  it('stops at total_count even if it is hit before an empty page', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      total_count: 5,
      budgets: [fakeBudget(1), fakeBudget(2), fakeBudget(3), fakeBudget(4), fakeBudget(5)],
    }))
    const result = await fetchUserBudgets(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.userBudgets).toHaveLength(5)
    expect(result.totalBudgetCount).toBe(5)
  })

  it('stops on an empty page when total_count is missing', async () => {
    let calls = 0
    const fetchMock: ApiFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { budgets: [fakeBudget(1), fakeBudget(2)] }
      return { budgets: [] }
    })
    const result = await fetchUserBudgets(fetchMock)
    expect(result.userBudgets).toHaveLength(2)
    // Falls back to the number of raw budgets paginated through
    expect(result.totalBudgetCount).toBe(2)
    expect(calls).toBe(2)
  })
})
