import { describe, expect, it } from 'vitest'
import {
  computeBudgetConstraints,
  type ComputeBudgetConstraintsInput,
} from '../lib/budgetConstraints'
import type {
  CopilotSeat,
  CostCenter,
  CostCenterBudget,
  CostCenterIndex,
  EnterpriseBudget,
  UniversalUlb,
  UserBudget,
} from '../lib/api'

// --- Fixture builders ---

const seat = (login: string, orgLogin: string | null = 'org1'): CopilotSeat => ({
  login,
  orgLogin,
  lastActivityAt: null,
  planType: null,
})

const cc = (id: string, name: string, resources: CostCenter['resources'] = []): CostCenter => ({
  id,
  name,
  state: 'active',
  resources,
})

const ccBudget = (id: string, name: string, amount: number): CostCenterBudget => ({
  id,
  costCenterName: name,
  budgetAmount: amount,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const entBudget = (
  amount: number,
  excludeCostCenterUsage = false,
  preventFurtherUsage = true,
): EnterpriseBudget => ({
  id: 'ent-1',
  budgetAmount: amount,
  excludeCostCenterUsage,
  preventFurtherUsage,
  willAlert: false,
  alertRecipients: [],
})

const universalUlb = (amount: number, preventFurtherUsage = true): UniversalUlb => ({
  id: 'uni-1',
  budgetAmount: amount,
  consumedAmount: 0,
  preventFurtherUsage,
  willAlert: false,
  alertRecipients: [],
})

const userBudget = (login: string, amount: number, preventFurtherUsage = true): UserBudget => ({
  id: `ub-${login}`,
  user: login,
  budgetAmount: amount,
  consumedAmount: 0,
  preventFurtherUsage,
  willAlert: false,
  alertRecipients: [],
})

const buildIndex = (overrides: Partial<CostCenterIndex> = {}): CostCenterIndex => ({
  userToCC: new Map(),
  orgToCC: new Map(),
  orgBudgetedCollisions: [],
  ...overrides,
})

const baseInput = (
  overrides: Partial<ComputeBudgetConstraintsInput> = {},
): ComputeBudgetConstraintsInput => ({
  enterpriseBudget: null,
  universalUlb: null,
  costCenters: [],
  costCenterIndex: buildIndex(),
  ccBudgetsByName: new Map(),
  seats: [],
  userBudgets: [],
  ...overrides,
})

describe('computeBudgetConstraints', () => {
  describe('mode detection', () => {
    it('is no-enterprise-budget when ent is missing', () => {
      const r = computeBudgetConstraints(baseInput())
      expect(r.mode).toBe('no-enterprise-budget')
    })
    it('is umbrella when ent exists and excludeCostCenterUsage=false', () => {
      const r = computeBudgetConstraints(baseInput({ enterpriseBudget: entBudget(100, false) }))
      expect(r.mode).toBe('umbrella')
    })
    it('is independent when excludeCostCenterUsage=true', () => {
      const r = computeBudgetConstraints(baseInput({ enterpriseBudget: entBudget(100, true) }))
      expect(r.mode).toBe('independent')
    })
  })

  describe('per-CC check (B)', () => {
    it('passes when Σ effective ULBs ≤ CC budget', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(1000),
          universalUlb: universalUlb(10),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 50)]]),
          seats: [seat('alice')],
        }),
      )
      expect(r.checks.perCc).toHaveLength(1)
      expect(r.checks.perCc[0]?.check.ok).toBe(true)
      expect(r.checks.perCc[0]?.check.actual).toBe(10)
      expect(r.checks.perCc[0]?.memberCount).toBe(1)
    })

    it('fails and reports overBy when Σ ULBs > CC budget', () => {
      const ccA = cc('cc1', 'ccA', [
        { type: 'User', name: 'alice' },
        { type: 'User', name: 'bob' },
      ])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(1000),
          universalUlb: universalUlb(30),
          costCenters: [ccA],
          costCenterIndex: buildIndex({
            userToCC: new Map([
              ['alice', ccA],
              ['bob', ccA],
            ]),
          }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 50)]]),
          seats: [seat('alice'), seat('bob')],
        }),
      )
      expect(r.checks.perCc[0]?.check.ok).toBe(false)
      expect(r.checks.perCc[0]?.check.actual).toBe(60)
      expect(r.checks.perCc[0]?.check.allowed).toBe(50)
      expect(r.checks.perCc[0]?.check.overBy).toBe(10)
    })

    it('CC with no ai_credits budget is not included in perCc and members fall through to leftover', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100),
          universalUlb: universalUlb(20),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map(),
          seats: [seat('alice')],
        }),
      )
      expect(r.checks.perCc).toHaveLength(0)
      expect(r.checks.unassignedLeftover?.actual).toBe(20)
    })

    it('CC with budget_amount=0 fails check when members have positive ULB', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100),
          universalUlb: universalUlb(5),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 0)]]),
          seats: [seat('alice')],
        }),
      )
      expect(r.checks.perCc[0]?.check.ok).toBe(false)
      expect(r.checks.perCc[0]?.check.overBy).toBe(5)
    })

    it('individual ULB wins over universal for member effective ULB', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(1000),
          universalUlb: universalUlb(10),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 100)]]),
          seats: [seat('alice')],
          userBudgets: [userBudget('alice', 75)],
        }),
      )
      expect(r.checks.perCc[0]?.check.actual).toBe(75)
    })
  })

  describe('ccVsEnterprise (C)', () => {
    it('umbrella mode: passes when Σ CC budgets ≤ ent', () => {
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(200, false),
          costCenters: [cc('cc1', 'ccA'), cc('cc2', 'ccB')],
          ccBudgetsByName: new Map([
            ['cca', ccBudget('ccb1', 'ccA', 80)],
            ['ccb', ccBudget('ccb2', 'ccB', 50)],
          ]),
        }),
      )
      expect(r.checks.ccVsEnterprise?.ok).toBe(true)
      expect(r.checks.ccVsEnterprise?.actual).toBe(130)
      expect(r.checks.ccVsEnterprise?.allowed).toBe(200)
    })

    it('umbrella: fails when Σ CC budgets > ent', () => {
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, false),
          costCenters: [cc('cc1', 'ccA')],
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 150)]]),
        }),
      )
      expect(r.checks.ccVsEnterprise?.ok).toBe(false)
      expect(r.checks.ccVsEnterprise?.overBy).toBe(50)
    })

    it('independent mode: ccVsEnterprise is null (vacuous)', () => {
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, true),
          costCenters: [cc('cc1', 'ccA')],
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 500)]]),
        }),
      )
      expect(r.checks.ccVsEnterprise).toBeNull()
    })

    it('no enterprise budget: ccVsEnterprise is null', () => {
      const r = computeBudgetConstraints(
        baseInput({
          costCenters: [cc('cc1', 'ccA')],
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 100)]]),
        }),
      )
      expect(r.checks.ccVsEnterprise).toBeNull()
    })
  })

  describe('unassigned leftover (D)', () => {
    it('umbrella: leftover users vs (ent - Σ CC budgets)', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, false),
          universalUlb: universalUlb(30),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 40)]]),
          seats: [seat('alice'), seat('bob'), seat('carol')],
        }),
      )
      expect(r.checks.unassignedLeftover?.allowed).toBe(60)
      expect(r.checks.unassignedLeftover?.actual).toBe(60)
      expect(r.checks.unassignedLeftover?.ok).toBe(true)
    })

    it('umbrella: leftover allowed clamped at 0 when CC budgets exceed ent', () => {
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(50, false),
          universalUlb: universalUlb(1),
          costCenters: [cc('cc1', 'ccA')],
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 100)]]),
          seats: [seat('bob')],
        }),
      )
      expect(r.checks.unassignedLeftover?.allowed).toBe(0)
      expect(r.checks.unassignedLeftover?.ok).toBe(false)
    })

    it('independent: leftover users vs full ent', () => {
      const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, true),
          universalUlb: universalUlb(40),
          costCenters: [ccA],
          costCenterIndex: buildIndex({ userToCC: new Map([['alice', ccA]]) }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 500)]]),
          seats: [seat('alice'), seat('bob')],
        }),
      )
      expect(r.checks.unassignedLeftover?.allowed).toBe(100)
      expect(r.checks.unassignedLeftover?.actual).toBe(40)
    })

    it('overflow: leftover Σ ULBs > allowance reports overBy', () => {
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(50, false),
          universalUlb: universalUlb(20),
          seats: [seat('a'), seat('b'), seat('c')],
        }),
      )
      expect(r.checks.unassignedLeftover?.actual).toBe(60)
      expect(r.checks.unassignedLeftover?.ok).toBe(false)
      expect(r.checks.unassignedLeftover?.overBy).toBe(10)
    })

    it('no ent budget: unassignedLeftover is null', () => {
      const r = computeBudgetConstraints(baseInput({ seats: [seat('a')], universalUlb: universalUlb(5) }))
      expect(r.checks.unassignedLeftover).toBeNull()
    })
  })

  describe('warnings', () => {
    it('warns when universal ULB has prevent_further_usage=false', () => {
      const r = computeBudgetConstraints(
        baseInput({ universalUlb: universalUlb(10, false), seats: [seat('a')] }),
      )
      expect(r.warnings.some(w => w.code === 'prevent_further_usage_off')).toBe(true)
    })

    it('warns when a user budget has prevent_further_usage=false', () => {
      const r = computeBudgetConstraints(
        baseInput({
          seats: [seat('alice')],
          userBudgets: [userBudget('alice', 25, false)],
        }),
      )
      expect(r.warnings.some(w => w.code === 'prevent_further_usage_off' && w.context?.login === 'alice')).toBe(true)
    })

    it('warns when user has no individual, no universal, no CC, no ent', () => {
      const r = computeBudgetConstraints(baseInput({ seats: [seat('alice')] }))
      expect(r.warnings.some(w => w.code === 'unbounded_user_coverage' && w.context?.login === 'alice')).toBe(true)
    })

    it('does NOT warn unbounded when user has individual ULB', () => {
      const r = computeBudgetConstraints(
        baseInput({
          seats: [seat('alice')],
          userBudgets: [userBudget('alice', 5)],
        }),
      )
      expect(r.warnings.some(w => w.code === 'unbounded_user_coverage')).toBe(false)
    })

    it('does NOT warn unbounded when ent budget present', () => {
      const r = computeBudgetConstraints(
        baseInput({ enterpriseBudget: entBudget(100), seats: [seat('alice')] }),
      )
      expect(r.warnings.some(w => w.code === 'unbounded_user_coverage')).toBe(false)
    })

    it('forwards orgBudgetedCollisions from the index', () => {
      const r = computeBudgetConstraints(
        baseInput({
          costCenterIndex: buildIndex({
            orgBudgetedCollisions: [{ org: 'octo-org', costCenterNames: ['ccA', 'ccB'] }],
          }),
        }),
      )
      expect(r.warnings.some(w => w.code === 'org_in_multi_budgeted_ccs')).toBe(true)
    })

    it('warns when a CC budget targets a non-existent CC name', () => {
      const r = computeBudgetConstraints(
        baseInput({
          costCenters: [cc('cc1', 'realCC')],
          ccBudgetsByName: new Map([['ghost', ccBudget('ccb-x', 'ghost', 10)]]),
        }),
      )
      expect(r.warnings.some(w => w.code === 'cc_budget_without_cc')).toBe(true)
    })
  })

  describe('maxSafeUniversalUlb', () => {
    it('Infinity when no envelope binds (no ent, no CC budgets)', () => {
      const r = computeBudgetConstraints(baseInput({ seats: [seat('a')] }))
      expect(r.maxSafeUniversalUlb).toBe(Infinity)
    })

    it('umbrella: bound by leftover allowance / leftover user count', () => {
      // ent=100, no CC budgets, 4 leftover seats, no individuals → max U = 25
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, false),
          seats: [seat('a'), seat('b'), seat('c'), seat('d')],
        }),
      )
      expect(r.maxSafeUniversalUlb).toBe(25)
    })

    it('respects individual ULBs in the fixed sum', () => {
      // ent=100, no CCs, 3 seats: alice has $40 individual, b+c rely on U.
      // leftover allowed = 100; fixed = 40; n = 2 → max U = (100 - 40)/2 = 30
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, false),
          seats: [seat('alice'), seat('b'), seat('c')],
          userBudgets: [userBudget('alice', 40)],
        }),
      )
      expect(r.maxSafeUniversalUlb).toBe(30)
    })

    it('bound by tightest per-CC constraint', () => {
      // ccA budget 20, 4 members on U → bound at 5. Leftover 1 seat, ent 1000 → bound at 1000.
      const ccA = cc('cc1', 'ccA', [
        { type: 'User', name: 'a' },
        { type: 'User', name: 'b' },
        { type: 'User', name: 'c' },
        { type: 'User', name: 'd' },
      ])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(1000, false),
          costCenters: [ccA],
          costCenterIndex: buildIndex({
            userToCC: new Map([
              ['a', ccA],
              ['b', ccA],
              ['c', ccA],
              ['d', ccA],
            ]),
          }),
          ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 20)]]),
          seats: [seat('a'), seat('b'), seat('c'), seat('d'), seat('e')],
        }),
      )
      expect(r.maxSafeUniversalUlb).toBe(5)
    })

    it('returns 0 when fixed individuals already exceed an envelope', () => {
      // CC budget 10, alice individual=20, no universal members → cap skipped.
      // Leftover ent=100, all consumed by alice not via leftover. So leftover cap = (100-10)/0 → skipped.
      // → Infinity. Adjust to ensure cap=0 case:
      // ent=100, no CC. 2 seats: alice ind=120, bob on U. fixed=120, n=1 → max(0, (100-120)/1) = 0.
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(100, false),
          seats: [seat('alice'), seat('bob')],
          userBudgets: [userBudget('alice', 120)],
        }),
      )
      expect(r.maxSafeUniversalUlb).toBe(0)
    })
  })

  describe('user > org CC resolution', () => {
    it('user-level binding overrides org-level for routing', () => {
      const ccUser = cc('cc-user', 'ccUser', [{ type: 'User', name: 'alice' }])
      const ccOrg = cc('cc-org', 'ccOrg', [{ type: 'Org', name: 'org1' }])
      const r = computeBudgetConstraints(
        baseInput({
          enterpriseBudget: entBudget(1000),
          universalUlb: universalUlb(10),
          costCenters: [ccUser, ccOrg],
          costCenterIndex: buildIndex({
            userToCC: new Map([['alice', ccUser]]),
            orgToCC: new Map([['org1', ccOrg]]),
          }),
          ccBudgetsByName: new Map([
            ['ccuser', ccBudget('ub1', 'ccUser', 50)],
            ['ccorg', ccBudget('ub2', 'ccOrg', 50)],
          ]),
          seats: [seat('alice', 'org1')],
        }),
      )
      // alice should only count under ccUser, not ccOrg
      const userCc = r.checks.perCc.find(c => c.costCenterName === 'ccUser')
      const orgCc = r.checks.perCc.find(c => c.costCenterName === 'ccOrg')
      expect(userCc?.memberCount).toBe(1)
      expect(orgCc?.memberCount).toBe(0)
    })
  })
})

describe('previewConstraintsWithProposedUlb', () => {
  it('flags the small-ent / no-CC / aggressive-ULB scenario as over', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    // 100 seats, $500 ent budget, no CCs, no individual ULBs. Sizing the
    // universal ULB from "top 5%" usage at $20/user proposes $2000 of
    // projected leftover spend — $1500 over a $500 envelope.
    const seats: CopilotSeat[] = Array.from({ length: 100 }, (_, i) => seat(`u${i}`))
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats,
    })
    const r = previewConstraintsWithProposedUlb(input, 20)
    expect(r.checks.unassignedLeftover?.ok).toBe(false)
    expect(r.checks.unassignedLeftover?.actual).toBe(2000)
    expect(r.checks.unassignedLeftover?.allowed).toBe(500)
    expect(r.checks.unassignedLeftover?.overBy).toBe(1500)
    // The engine should also surface the matching max-safe value the snap
    // action will offer: floor(500/100) = $5.
    expect(r.maxSafeUniversalUlb).toBe(5)
  })

  it('passes when the proposed ULB fits under the leftover allowance', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    const seats: CopilotSeat[] = Array.from({ length: 10 }, (_, i) => seat(`u${i}`))
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats,
    })
    const r = previewConstraintsWithProposedUlb(input, 10)
    expect(r.checks.unassignedLeftover?.ok).toBe(true)
    expect(r.checks.unassignedLeftover?.actual).toBe(100)
    expect(r.checks.unassignedLeftover?.allowed).toBe(500)
  })

  it('reports maxSafeUniversalUlb=0 when individual ULBs alone fill the envelope', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    // 1 seat with an individual ULB at $500 already saturates the $500 ent
    // budget. Any universal ULB > 0 covering additional seats would breach.
    const seats: CopilotSeat[] = [seat('alice'), seat('bob')]
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats,
      userBudgets: [userBudget('alice', 500)],
    })
    const r = previewConstraintsWithProposedUlb(input, 1)
    expect(r.checks.unassignedLeftover?.ok).toBe(false)
    expect(r.maxSafeUniversalUlb).toBe(0)
  })

  it('does not mutate the caller-supplied universalUlb reference', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    const live = universalUlb(5)
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: live,
      seats: [seat('alice')],
    })
    previewConstraintsWithProposedUlb(input, 999)
    expect(live.budgetAmount).toBe(5)
  })

  it('drives the snap-button proposal the EnvelopeCheckCard renders', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    const { proposeLowerUniversalUlb } = await import('../lib/budgetAutoFix')
    const seats: CopilotSeat[] = Array.from({ length: 100 }, (_, i) => seat(`u${i}`))
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats,
    })
    // Aggressive proposal → preview fails → snap proposal is the max-safe.
    const overPreview = previewConstraintsWithProposedUlb(input, 20)
    expect(proposeLowerUniversalUlb(overPreview, 20)).toEqual({
      label: expect.any(String),
      newValue: 5,
      scope: 'universal_ulb',
    })
    // When the envelope is fully consumed by individual ULBs, the snap is
    // suppressed (safe=0) and the card must rely on the raise-ent action.
    const noHeadroomInput = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats: [seat('alice'), seat('bob')],
      userBudgets: [userBudget('alice', 500)],
    })
    const noHeadroomPreview = previewConstraintsWithProposedUlb(noHeadroomInput, 1)
    expect(proposeLowerUniversalUlb(noHeadroomPreview, 1)).toBeNull()
  })

  it('returns a non-integer max-safe value when seats × dollars does not divide evenly', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    // 90 seats, $500 ent → max safe = $5.555…. The card floors to whole
    // dollars ($5) before calling onSnapToMaxSafe so the apply path
    // (which ceils AICs/100 → whole USD) does not bounce the value back
    // above the safe threshold.
    const seats: CopilotSeat[] = Array.from({ length: 90 }, (_, i) => seat(`u${i}`))
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: null,
      seats,
    })
    const overPreview = previewConstraintsWithProposedUlb(input, 10)
    expect(overPreview.maxSafeUniversalUlb).toBeCloseTo(5.555, 2)
    // Sanity-check that flooring to whole dollars and re-previewing passes.
    const safePreview = previewConstraintsWithProposedUlb(input, 5)
    expect(safePreview.checks.unassignedLeftover?.ok).toBe(true)
  })

  it('forces preventFurtherUsage=true even when the live ULB has it off', async () => {
    const { previewConstraintsWithProposedUlb } = await import('../lib/budgetConstraints')
    const live = universalUlb(5, /* preventFurtherUsage */ false)
    const input = baseInput({
      enterpriseBudget: entBudget(500),
      universalUlb: live,
      seats: [seat('alice')],
    })
    const r = previewConstraintsWithProposedUlb(input, 10)
    // The preview should not carry over the prevent_further_usage_off
    // warning because patch/createUniversalULB both apply with the flag on.
    expect(r.warnings.some(w => w.code === 'prevent_further_usage_off')).toBe(false)
  })
})
