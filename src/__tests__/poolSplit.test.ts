import { describe, it, expect } from 'vitest'
import { computePoolSplit } from '@/lib/poolSplit'
import type {
  CopilotSeat,
  CostCenter,
  CostCenterBudget,
  EnterpriseBudget,
  UniversalUlb,
  UserBudget,
} from '@/lib/api'

function cc(id: string, name: string, resources: { type: string; name: string }[] = []): CostCenter {
  return { id, name, state: 'active', resources }
}

function ccBudget(name: string, amount: number): CostCenterBudget {
  return {
    id: `b-${name}`,
    costCenterName: name,
    budgetAmount: amount,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

function ccBudgetMap(...budgets: CostCenterBudget[]): Map<string, CostCenterBudget> {
  const m = new Map<string, CostCenterBudget>()
  for (const b of budgets) m.set(b.costCenterName.toLowerCase(), b)
  return m
}

function seat(login: string, orgLogin: string | null = null): CopilotSeat {
  return { login, orgLogin, lastActivityAt: null, planType: 'business' }
}

function entBudget(amount: number, exclude = false): EnterpriseBudget {
  return {
    id: 'ent',
    budgetAmount: amount,
    excludeCostCenterUsage: exclude,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

// Mutation-resistance: exact-boundary tests. The existing suite tends to
// use values that are comfortably away from the boundary (e.g. budget 1000
// with committed 600); without explicit equality cases, a `>` ↔ `>=` flip
// in `overAllocated` or a sign swap in `headroom` slips through silently.
describe('computePoolSplit boundaries', () => {
  it('committed exactly equal to enterprise budget: headroom=0, NOT overAllocated', () => {
    // 2 unassigned seats × $50 ULB = $100 committed; ent budget $100.
    // Tests the strict `>` in overAllocated (a `>=` mutation flips this).
    const result = computePoolSplit({
      enterpriseBudget: entBudget(100),
      universalUlb: null,
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice'), seat('bob')],
      userBudgets: [userBudget('alice', 50), userBudget('bob', 50)],
    })
    expect(result.unassignedTotal).toBe(100)
    expect(result.headroom).toBe(0)
    expect(result.overAllocated).toBe(false) // strict `>`, not `>=`
  })

  it('committed one cent over enterprise budget: headroom=0 (clamped), overAllocated=true', () => {
    const result = computePoolSplit({
      enterpriseBudget: entBudget(100),
      universalUlb: null,
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice')],
      userBudgets: [userBudget('alice', 100.01)],
    })
    expect(result.unassignedTotal).toBeCloseTo(100.01, 10)
    expect(result.headroom).toBe(0) // clamped at 0, never negative
    expect(result.overAllocated).toBe(true)
  })

  it('null enterprise budget: headroom=0 and never reports over-allocated', () => {
    const result = computePoolSplit({
      enterpriseBudget: null,
      universalUlb: null,
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice')],
      userBudgets: [userBudget('alice', 100)],
    })
    expect(result.headroom).toBe(0)
    expect(result.overAllocated).toBe(false)
  })
})

function universal(amount: number): UniversalUlb {
  return {
    id: 'u',
    budgetAmount: amount,
    consumedAmount: 0,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

function userBudget(user: string, amount: number): UserBudget {
  return {
    id: `ub-${user}`,
    user,
    budgetAmount: amount,
    consumedAmount: 0,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

describe('computePoolSplit', () => {
  it('returns an all-zero split for an empty input', () => {
    const r = computePoolSplit({
      enterpriseBudget: null,
      universalUlb: null,
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [],
      userBudgets: [],
    })
    expect(r).toEqual({
      enterpriseBudget: null,
      costCenters: [],
      cappedTotal: 0,
      uncappedTotal: 0,
      unassignedTotal: 0,
      headroom: 0,
      overAllocated: false,
    })
  })

  it('puts seats not routed to any CC into the unassigned bucket', () => {
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(20),
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice'), seat('bob')],
      userBudgets: [],
    })
    expect(r.unassignedTotal).toBe(40) // 2 seats × $20 universal
    expect(r.cappedTotal).toBe(0)
    expect(r.uncappedTotal).toBe(0)
    expect(r.headroom).toBe(960)
    expect(r.overAllocated).toBe(false)
  })

  it('uses an individual ULB amount instead of the universal when one is set', () => {
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(20),
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice'), seat('bob')],
      userBudgets: [userBudget('alice', 100)],
    })
    // alice = 100 (individual), bob = 20 (universal fallback)
    expect(r.unassignedTotal).toBe(120)
  })

  it('routes user-direct CC members and matches login case-insensitively', () => {
    const ccs = [cc('cc1', 'Engineering', [{ type: 'User', name: 'Alice' }])]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(50),
      costCenters: ccs,
      ccBudgetsByName: new Map(),
      seats: [seat('alice'), seat('bob')], // 'alice' lower-case matches CC's 'Alice'
      userBudgets: [],
    })
    // alice routed → CC1 (ulbCeiling 50), bob unassigned (50)
    expect(r.unassignedTotal).toBe(50)
    expect(r.costCenters).toHaveLength(1)
    expect(r.costCenters[0]).toMatchObject({
      costCenterId: 'cc1',
      ulbCeiling: 50,
      seatCount: 1,
      budgetAmount: null,
      effectiveDraw: 50, // uncapped, bounded only by ulbCeiling
    })
    expect(r.uncappedTotal).toBe(50)
    expect(r.cappedTotal).toBe(0)
  })

  it('caps effectiveDraw at the CC budget when budget < ulbCeiling', () => {
    const ccs = [
      cc('cc1', 'Engineering', [
        { type: 'User', name: 'alice' },
        { type: 'User', name: 'bob' },
      ]),
    ]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(100),
      costCenters: ccs,
      ccBudgetsByName: ccBudgetMap(ccBudget('Engineering', 150)),
      seats: [seat('alice'), seat('bob')],
      userBudgets: [],
    })
    // ulbCeiling = 200, budget = 150 → effectiveDraw = 150
    expect(r.costCenters[0].ulbCeiling).toBe(200)
    expect(r.costCenters[0].budgetAmount).toBe(150)
    expect(r.costCenters[0].effectiveDraw).toBe(150)
    expect(r.cappedTotal).toBe(150)
    expect(r.uncappedTotal).toBe(0)
  })

  it('binds effectiveDraw to ulbCeiling when budget > ulbCeiling (ULBs are the real cap)', () => {
    const ccs = [cc('cc1', 'Engineering', [{ type: 'User', name: 'alice' }])]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(50),
      costCenters: ccs,
      ccBudgetsByName: ccBudgetMap(ccBudget('Engineering', 500)),
      seats: [seat('alice')],
      userBudgets: [],
    })
    expect(r.costCenters[0].effectiveDraw).toBe(50) // min(500, 50)
    expect(r.cappedTotal).toBe(50)
  })

  it('omits CCs that have a budget but no Copilot seats today', () => {
    const ccs = [
      cc('cc1', 'Engineering', [{ type: 'User', name: 'alice' }]),
      cc('cc2', 'Empty', [{ type: 'User', name: 'ghost' }]),
    ]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(50),
      costCenters: ccs,
      ccBudgetsByName: ccBudgetMap(ccBudget('Empty', 999)),
      seats: [seat('alice')], // 'ghost' has no seat
      userBudgets: [],
    })
    expect(r.costCenters.map(s => s.costCenterId)).toEqual(['cc1'])
  })

  it('sorts CC slices by effectiveDraw descending', () => {
    const ccs = [
      cc('cc-small', 'Small', [{ type: 'User', name: 'alice' }]),
      cc('cc-big', 'Big', [
        { type: 'User', name: 'bob' },
        { type: 'User', name: 'carol' },
      ]),
      cc('cc-mid', 'Mid', [{ type: 'User', name: 'dave' }]),
    ]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(10_000),
      universalUlb: universal(50),
      costCenters: ccs,
      ccBudgetsByName: ccBudgetMap(ccBudget('Mid', 75)),
      seats: [seat('alice'), seat('bob'), seat('carol'), seat('dave')],
      userBudgets: [],
    })
    expect(r.costCenters[0].costCenterId).toBe('cc-big')
    expect(r.costCenters[0].effectiveDraw).toBe(100) // big: 2 × 50
    // mid and small both have effectiveDraw=50; order between equals is
    // an implementation detail of the stable sort. Assert as a set.
    expect(new Set(r.costCenters.slice(1).map(s => s.costCenterId))).toEqual(
      new Set(['cc-mid', 'cc-small']),
    )
    expect(r.costCenters[1].effectiveDraw).toBe(50)
    expect(r.costCenters[2].effectiveDraw).toBe(50)
  })

  it('marks overAllocated and clamps headroom to 0 when committed > enterprise budget', () => {
    const ccs = [cc('cc1', 'Big', [{ type: 'User', name: 'alice' }])]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(100),
      universalUlb: universal(500),
      costCenters: ccs,
      ccBudgetsByName: new Map(),
      seats: [seat('alice')],
      userBudgets: [],
    })
    expect(r.uncappedTotal).toBe(500)
    expect(r.headroom).toBe(0)
    expect(r.overAllocated).toBe(true)
  })

  it('treats a null enterprise budget as "no headroom info" without ever reporting overAllocated', () => {
    const r = computePoolSplit({
      enterpriseBudget: null,
      universalUlb: universal(50),
      costCenters: [],
      ccBudgetsByName: new Map(),
      seats: [seat('alice')],
      userBudgets: [],
    })
    expect(r.enterpriseBudget).toBeNull()
    expect(r.headroom).toBe(0)
    expect(r.overAllocated).toBe(false)
  })

  it('falls back to org membership when the user is not directly assigned to any CC', () => {
    const ccs = [cc('cc1', 'Acme', [{ type: 'Org', name: 'acme-inc' }])]
    const r = computePoolSplit({
      enterpriseBudget: entBudget(1_000),
      universalUlb: universal(40),
      costCenters: ccs,
      ccBudgetsByName: new Map(),
      seats: [seat('alice', 'acme-inc')],
      userBudgets: [],
    })
    expect(r.costCenters).toHaveLength(1)
    expect(r.costCenters[0].seatCount).toBe(1)
    expect(r.costCenters[0].ulbCeiling).toBe(40)
    expect(r.unassignedTotal).toBe(0)
  })
})
