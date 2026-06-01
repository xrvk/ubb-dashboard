import { describe, expect, it } from 'vitest'
import {
  computeBudgetConstraints,
  type ComputeBudgetConstraintsInput,
} from '../lib/budgetConstraints'
import {
  proposeRaiseEnt,
  proposeRaiseCc,
  proposeLowerUniversalUbb,
  computeRequiredMinimums,
} from '../lib/budgetAutoFix'
import type {
  CopilotSeat,
  CostCenter,
  CostCenterBudget,
  CostCenterIndex,
  EnterpriseBudget,
  UniversalUbb,
  UserBudget,
} from '../lib/api'

// --- Fixture builders (mirroring budgetConstraints.test.ts) ---

const seat = (login: string, orgLogin: string | null = 'org1'): CopilotSeat => ({
  login,
  orgLogin,
  lastActivityAt: null,
  planType: null,
})

const cc = (id: string, name: string): CostCenter => ({
  id,
  name,
  state: 'active',
  resources: [],
})

const ccBudget = (id: string, name: string, amount: number): CostCenterBudget => ({
  id,
  costCenterName: name,
  budgetAmount: amount,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

// Mutation-resistance: cent-boundary direction tests for proposeLower-
// UniversalUbb. The proposal must floor to the nearest cent so applying it
// never re-breaches. A mutation to `Math.ceil` or `Math.round` would still
// pass integer-only tests but ship a re-breaching proposal in production.
describe('proposeLowerUniversalUbb cent-boundary direction', () => {
  it('floors a sub-cent maxSafe to the nearest cent below (never up)', () => {
    const result = {
      mode: 'umbrella',
      maxSafeUniversalUbb: 10.999, // a `ceil`/`round` mutation would propose 11.00 and re-breach
      checks: { perCc: [] },
    } as unknown as Parameters<typeof proposeLowerUniversalUbb>[0]
    const proposal = proposeLowerUniversalUbb(result, 11.5)
    expect(proposal).not.toBeNull()
    expect(proposal!.newValue).toBe(10.99)
    expect(proposal!.label).toBe('Lower universal ULB to $10.99')
    expect(proposal!.scope).toBe('universal_ubb')
  })

  it('returns null when current is already at or below the safe value', () => {
    const result = {
      mode: 'umbrella',
      maxSafeUniversalUbb: 10.99,
      checks: { perCc: [] },
    } as unknown as Parameters<typeof proposeLowerUniversalUbb>[0]
    expect(proposeLowerUniversalUbb(result, 10.99)).toBeNull()
    expect(proposeLowerUniversalUbb(result, 5)).toBeNull()
  })

  it('returns null when the safe value is zero (turning the knob off is not a fix)', () => {
    const result = {
      mode: 'umbrella',
      maxSafeUniversalUbb: 0,
      checks: { perCc: [] },
    } as unknown as Parameters<typeof proposeLowerUniversalUbb>[0]
    expect(proposeLowerUniversalUbb(result, 50)).toBeNull()
  })

  it('returns null when maxSafeUniversalUbb is Infinity (nothing binds)', () => {
    const result = {
      mode: 'umbrella',
      maxSafeUniversalUbb: Infinity,
      checks: { perCc: [] },
    } as unknown as Parameters<typeof proposeLowerUniversalUbb>[0]
    expect(proposeLowerUniversalUbb(result, 50)).toBeNull()
  })
})

const entBudget = (amount: number, excludeCostCenterUsage = false): EnterpriseBudget => ({
  id: 'ent-1',
  budgetAmount: amount,
  excludeCostCenterUsage,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const universal = (amount: number): UniversalUbb => ({
  id: 'uni-1',
  budgetAmount: amount,
  consumedAmount: 0,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const userBudget = (login: string, amount: number): UserBudget => ({
  id: `ub-${login}`,
  user: login,
  budgetAmount: amount,
  consumedAmount: 0,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const idx = (
  userToCC: Array<[string, CostCenter]> = [],
  orgToCC: Array<[string, CostCenter]> = [],
): CostCenterIndex => ({
  userToCC: new Map(userToCC.map(([k, v]) => [k.toLowerCase(), v])),
  orgToCC: new Map(orgToCC.map(([k, v]) => [k.toLowerCase(), v])),
  orgBudgetedCollisions: [],
})

const baseInput = (
  overrides: Partial<ComputeBudgetConstraintsInput> = {},
): ComputeBudgetConstraintsInput => ({
  enterpriseBudget: null,
  universalUbb: null,
  costCenters: [],
  costCenterIndex: idx(),
  ccBudgetsByName: new Map(),
  seats: [],
  userBudgets: [],
  ...overrides,
})

describe('proposeRaiseEnt', () => {
  it('returns null when there is no enterprise budget', () => {
    const r = computeBudgetConstraints(baseInput())
    expect(proposeRaiseEnt(r)).toBeNull()
  })

  it('returns null when ent already covers everything (umbrella)', () => {
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000),
        universalUbb: universal(10),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    expect(proposeRaiseEnt(r)).toBeNull()
  })

  it('proposes the sum of CC budgets + unassigned ULBs (umbrella)', () => {
    // CC "foo" with $50 budget; alice routed to it with universal ULB $10.
    // bob is unassigned with universal ULB $10. Ent budget too low at $40.
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(40),
        universalUbb: universal(10),
        costCenters: [ccFoo],
        costCenterIndex: idx([['alice', ccFoo]]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 50)]]),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    const proposal = proposeRaiseEnt(r)
    // Required = sum CC budgets ($50) + unassigned ULBs (bob $10) = $60.
    expect(proposal).not.toBeNull()
    expect(proposal!.newValue).toBe(60)
    expect(proposal!.scope).toBe('enterprise')
  })

  it('proposes only Σ unassigned ULBs in independent mode', () => {
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(5, /* excludeCostCenterUsage */ true),
        universalUbb: universal(10),
        costCenters: [ccFoo],
        costCenterIndex: idx([['alice', ccFoo]]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 50)]]),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    const proposal = proposeRaiseEnt(r)
    // independent mode: only bob ($10) counts against ent.
    expect(proposal!.newValue).toBe(10)
  })

  it('rounds up to the next cent', () => {
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1),
        universalUbb: universal(3.333),
        seats: [seat('a'), seat('b'), seat('c')],
      }),
    )
    const proposal = proposeRaiseEnt(r)
    // 3.333 * 3 = 9.999 → ceil to 10.00.
    expect(proposal!.newValue).toBe(10)
  })
})

describe('proposeRaiseCc', () => {
  it('returns null when CC is ok', () => {
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000),
        universalUbb: universal(10),
        costCenters: [ccFoo],
        costCenterIndex: idx([['alice', ccFoo]]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 50)]]),
        seats: [seat('alice')],
      }),
    )
    expect(proposeRaiseCc(r, 'cc1')).toBeNull()
  })

  it('proposes the sum of member ULBs when CC is over', () => {
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000),
        universalUbb: universal(25),
        costCenters: [ccFoo],
        costCenterIndex: idx([
          ['alice', ccFoo],
          ['bob', ccFoo],
        ]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 10)]]),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    const proposal = proposeRaiseCc(r, 'cc1')
    expect(proposal).not.toBeNull()
    expect(proposal!.newValue).toBe(50) // 25 + 25
    expect(proposal!.scope).toBe('cost_center')
    expect(proposal!.targetId).toBe('cc1')
  })

  it('returns null for an unknown CC id', () => {
    const r = computeBudgetConstraints(baseInput({ enterpriseBudget: entBudget(100) }))
    expect(proposeRaiseCc(r, 'nope')).toBeNull()
  })
})

describe('proposeLowerUniversalUbb', () => {
  it('returns null when no current universal', () => {
    const r = computeBudgetConstraints(baseInput({ enterpriseBudget: entBudget(100) }))
    expect(proposeLowerUniversalUbb(r, null)).toBeNull()
  })

  it('returns null when nothing binds the universal', () => {
    // No envelope binds universal because no seats / no enterprise.
    const r = computeBudgetConstraints(baseInput({ universalUbb: universal(10) }))
    expect(proposeLowerUniversalUbb(r, 10)).toBeNull()
  })

  it('proposes the floor-cent of maxSafeUniversalUbb when current exceeds it', () => {
    // Ent $30, 3 seats, universal $20 → max safe = 10. Currently $20.
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(30),
        universalUbb: universal(20),
        seats: [seat('a'), seat('b'), seat('c')],
      }),
    )
    expect(r.maxSafeUniversalUbb).toBe(10)
    const proposal = proposeLowerUniversalUbb(r, 20)
    expect(proposal!.newValue).toBe(10)
    expect(proposal!.scope).toBe('universal_ubb')
  })

  it('returns null when already at or below safe max', () => {
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(30),
        universalUbb: universal(10),
        seats: [seat('a'), seat('b'), seat('c')],
      }),
    )
    expect(proposeLowerUniversalUbb(r, 10)).toBeNull()
  })

  it('returns null when safe max would be $0 (no real fix)', () => {
    // Ent $0.01, 3 seats, universal $1. Max safe universal ≈ $0.003, floors
    // to $0 → lowering to $0 isn't a real fix, so the proposal should be
    // suppressed and the caller should suggest raising the enterprise budget
    // (or setting per-CC budgets) instead.
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(0.01),
        universalUbb: universal(1),
        seats: [seat('a'), seat('b'), seat('c')],
      }),
    )
    expect(proposeLowerUniversalUbb(r, 1)).toBeNull()
  })
})

describe('computeRequiredMinimums', () => {
  it('returns null enterprise when no ent budget', () => {
    const r = computeBudgetConstraints(baseInput())
    expect(computeRequiredMinimums(r).enterprise).toBeNull()
  })

  it('sums CC budgets + unassigned ULBs in umbrella', () => {
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000),
        universalUbb: universal(7),
        costCenters: [ccFoo],
        costCenterIndex: idx([['alice', ccFoo]]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 50)]]),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    const min = computeRequiredMinimums(r)
    expect(min.enterprise).toBe(57) // 50 + 7
    expect(min.perCc.get('cc1')).toBe(7) // alice's UBB
  })

  it('only Σ unassigned ULBs in independent', () => {
    const ccFoo = cc('cc1', 'foo')
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000, true),
        universalUbb: universal(7),
        costCenters: [ccFoo],
        costCenterIndex: idx([['alice', ccFoo]]),
        ccBudgetsByName: new Map([['foo', ccBudget('b1', 'foo', 50)]]),
        seats: [seat('alice'), seat('bob')],
      }),
    )
    expect(computeRequiredMinimums(r).enterprise).toBe(7)
  })

  it('individual ULBs override universal when computing required', () => {
    const r = computeBudgetConstraints(
      baseInput({
        enterpriseBudget: entBudget(1000),
        universalUbb: universal(10),
        seats: [seat('a'), seat('b')],
        userBudgets: [userBudget('a', 50)], // a overrides universal
      }),
    )
    expect(computeRequiredMinimums(r).enterprise).toBe(60) // 50 + 10
  })
})
