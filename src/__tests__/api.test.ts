import { describe, it, expect, vi } from 'vitest'
import {
  buildCostCenterIndex,
  createApiFetch,
  fetchCostCenters,
  fetchUserBudgets,
  resolveCostCenter,
  type ApiFetch,
  type CostCenter,
  type RawBudget,
} from '@/lib/api'

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

function fakeCC(id: string, name: string, resources: Array<{ type: string; name: string }> = [], state = 'active'): CostCenter {
  return { id, name, state, resources }
}

describe('fetchCostCenters', () => {
  it('returns active cost centers from a single page', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      costCenters: [
        fakeCC('cc1', 'Eng', [{ type: 'User', name: 'alice' }]),
        fakeCC('cc2', 'Old', [], 'deleted'),
      ],
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.map(c => c.id)).toEqual(['cc1'])
  })

  it('paginates until a short page is returned', async () => {
    const PER_PAGE = 100
    const totalActive = PER_PAGE + 3
    const fetchMock: ApiFetch = vi.fn(async (path: string) => {
      const m = path.match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      if (page === 1) {
        return {
          costCenters: Array.from({ length: PER_PAGE }, (_, i) =>
            fakeCC(`cc-p1-${i}`, `n${i}`),
          ),
        }
      }
      if (page === 2) {
        return {
          costCenters: Array.from({ length: 3 }, (_, i) =>
            fakeCC(`cc-p2-${i}`, `n2-${i}`),
          ),
        }
      }
      return { costCenters: [] }
    })
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(totalActive)
  })

  it('handles empty enterprise', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({ costCenters: [] }))
    const result = await fetchCostCenters(fetchMock)
    expect(result).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates API errors (e.g. 403) so the caller can choose to swallow', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => {
      throw new Error('403: forbidden')
    })
    await expect(fetchCostCenters(fetchMock)).rejects.toThrow(/forbidden/)
  })

  it('accepts the snake_case cost_centers shape too', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      cost_centers: [fakeCC('cc1', 'A')],
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(result.map(c => c.id)).toEqual(['cc1'])
  })

  it('stops after one page when the server ignores pagination and returns >PER_PAGE', async () => {
    // Repros the octodemo bug where omitting state=active makes the API
    // return the full set on every page request, ignoring page/per_page.
    const fetchMock: ApiFetch = vi.fn(async () => ({
      costCenters: Array.from({ length: 155 }, (_, i) => fakeCC(`cc${i}`, `n${i}`)),
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(155)
  })
})

describe('createApiFetch host allowlist', () => {
  it('accepts api.github.com', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.github.com', ent: 'octodemo', token: 't' }),
    ).not.toThrow()
  })

  it('accepts ghe.com tenants', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.tbb-staffship.ghe.com', ent: 'x', token: 't' }),
    ).not.toThrow()
  })

  it('rejects non-github hosts', () => {
    expect(() =>
      createApiFetch({ base: 'https://attacker.com', ent: 'x', token: 't' }),
    ).toThrow(/untrusted host/)
  })

  it('rejects http (non-TLS) base URLs', () => {
    expect(() =>
      createApiFetch({ base: 'http://api.github.com', ent: 'x', token: 't' }),
    ).toThrow(/https/)
  })

  it('rejects malformed base URLs', () => {
    expect(() =>
      createApiFetch({ base: 'not a url', ent: 'x', token: 't' }),
    ).toThrow(/Invalid API base/)
  })

  it('rejects look-alike hosts (ghe.com suffix only)', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.evil.com.ghe.example', ent: 'x', token: 't' }),
    ).toThrow(/untrusted host/)
  })
})

describe('buildCostCenterIndex', () => {
  it('indexes users and orgs lowercased', () => {
    const ccs = [
      fakeCC('cc1', 'Eng', [
        { type: 'User', name: 'Alice' },
        { type: 'Org', name: 'GitHub' },
      ]),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.get('alice')?.id).toBe('cc1')
    expect(idx.userToCC.has('Alice')).toBe(false)
    expect(idx.orgToCC.get('github')?.id).toBe('cc1')
  })

  it('warns and reports collisions when an org is in multiple ai-credits-budgeted CCs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ccs = [
        fakeCC('cc1', 'First', [{ type: 'Org', name: 'octo' }]),
        fakeCC('cc2', 'Second', [{ type: 'Org', name: 'octo' }]),
      ]
      // Both CCs have ai_credits budgets (keys lowercased).
      const budgets = new Map([
        ['first', { id: 'b1', costCenterName: 'First', budgetAmount: 10, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
        ['second', { id: 'b2', costCenterName: 'Second', budgetAmount: 20, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
      ])
      const idx = buildCostCenterIndex(ccs, budgets)
      // Sorted-by-id first-wins puts cc1 ahead of cc2.
      expect(idx.orgToCC.get('octo')?.id).toBe('cc1')
      expect(idx.orgBudgetedCollisions).toEqual([{ org: 'octo', costCenterNames: ['First', 'Second'] }])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('does NOT flag org collisions when only one of the colliding CCs has a budget', () => {
    const ccs = [
      fakeCC('cc1', 'First', [{ type: 'Org', name: 'octo' }]),
      fakeCC('cc2', 'Second', [{ type: 'Org', name: 'octo' }]),
    ]
    const budgets = new Map([
      ['first', { id: 'b1', costCenterName: 'First', budgetAmount: 10, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
    ])
    const idx = buildCostCenterIndex(ccs, budgets)
    expect(idx.orgBudgetedCollisions).toEqual([])
  })

  it('skips non-active cost centers', () => {
    const ccs = [
      fakeCC('cc1', 'Old', [{ type: 'User', name: 'alice' }], 'deleted'),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.size).toBe(0)
  })

  it('ignores unsupported resource types', () => {
    const ccs = [
      fakeCC('cc1', 'X', [{ type: 'Repository', name: 'owner/repo' }]),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.size).toBe(0)
    expect(idx.orgToCC.size).toBe(0)
  })
})

describe('resolveCostCenter', () => {
  const ccs = [
    fakeCC('ccu', 'User CC', [{ type: 'User', name: 'alice' }]),
    fakeCC('cco', 'Org CC', [{ type: 'Org', name: 'github' }]),
  ]
  const idx = buildCostCenterIndex(ccs)

  it('prefers direct user membership over org membership', () => {
    // alice is in both: direct user CC, and her org's CC. User wins.
    const r = resolveCostCenter('alice', 'github', idx)
    expect(r?.cc.id).toBe('ccu')
    expect(r?.via).toBe('user')
  })

  it('falls back to org membership when user is not directly assigned', () => {
    const r = resolveCostCenter('bob', 'github', idx)
    expect(r?.cc.id).toBe('cco')
    expect(r?.via).toBe('org')
    expect(r?.viaOrg).toBe('github')
  })

  it('returns null when neither user nor org match', () => {
    expect(resolveCostCenter('bob', 'unknown-org', idx)).toBeNull()
  })

  it('returns null when orgLogin is null and user has no direct membership', () => {
    expect(resolveCostCenter('bob', null, idx)).toBeNull()
  })

  it('lookups are case-insensitive on login and org', () => {
    expect(resolveCostCenter('ALICE', null, idx)?.cc.id).toBe('ccu')
    expect(resolveCostCenter('bob', 'GitHub', idx)?.cc.id).toBe('cco')
  })
})
