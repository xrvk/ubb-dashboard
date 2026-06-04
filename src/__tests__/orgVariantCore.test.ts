/**
 * Smoke tests for the org-variant core: parseOrgUrl, computePoolSplit,
 * computeBudgetConstraints, and the budget auto-fix proposals.
 *
 * Replaces the deleted GHEC-era tests (budgetConstraints.test, poolSplit.test,
 * budgetAutoFix.test, api.test). These cover the single golden-rule
 * invariant and the 3-layer hierarchy collapse.
 */

import { describe, it, expect } from 'vitest'
import { parseOrgUrl } from '@/lib/api'
import type { CopilotSeat, OrgBudget, UniversalUlb, UserBudget } from '@/lib/api'
import { computePoolSplit } from '@/lib/poolSplit'
import { computeBudgetConstraints } from '@/lib/budgetConstraints'
import { proposeRaiseOrgBudget, proposeLowerUniversalUlb } from '@/lib/budgetAutoFix'

// --- Fixtures ---

function seat(login: string): CopilotSeat {
  return {
    login,
    assignee_type: 'User',
    plan_type: 'business',
  } as unknown as CopilotSeat
}

function orgBudget(amount: number, preventFurtherUsage = true): OrgBudget {
  return {
    id: 'b-org',
    budgetAmount: amount,
    preventFurtherUsage,
    willAlert: false,
    alertRecipients: [],
  }
}

function universal(amount: number): UniversalUlb {
  return {
    id: 'b-univ',
    budgetAmount: amount,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  } as unknown as UniversalUlb
}

function userBudget(login: string, amount: number): UserBudget {
  return {
    id: `b-${login}`,
    user: login,
    budgetAmount: amount,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  } as unknown as UserBudget
}

// --- parseOrgUrl ---

describe('parseOrgUrl', () => {
  it('accepts a bare org slug', () => {
    expect(parseOrgUrl('logans-lounge')).toEqual({
      base: 'https://api.github.com',
      org: 'logans-lounge',
    })
  })

  it('accepts a github.com URL', () => {
    expect(parseOrgUrl('https://github.com/logans-lounge')).toEqual({
      base: 'https://api.github.com',
      org: 'logans-lounge',
    })
  })

  it('accepts a github.com URL with trailing slash', () => {
    expect(parseOrgUrl('https://github.com/logans-lounge/')).toEqual({
      base: 'https://api.github.com',
      org: 'logans-lounge',
    })
  })

  it('rejects non-github.com hosts (GHES is out of scope for the org variant)', () => {
    expect(parseOrgUrl('https://ghes.example.com/some-org')).toBeNull()
  })

  it('rejects deeper paths (e.g. org/repo)', () => {
    expect(parseOrgUrl('https://github.com/logans-lounge/some-repo')).toBeNull()
  })

  it('rejects reserved single-segment paths', () => {
    expect(parseOrgUrl('https://github.com/settings')).toBeNull()
    expect(parseOrgUrl('settings')).toBeNull()
  })

  it('returns null for empty/whitespace input', () => {
    expect(parseOrgUrl('')).toBeNull()
    expect(parseOrgUrl('   ')).toBeNull()
  })
})

// --- computePoolSplit ---

describe('computePoolSplit', () => {
  it('returns null orgBudget and zero headroom when no org budget', () => {
    const r = computePoolSplit({
      orgBudget: null,
      universalUlb: universal(10),
      seats: [seat('a'), seat('b')],
      userBudgets: [],
    })
    expect(r.orgBudget).toBeNull()
    expect(r.headroom).toBe(0)
    expect(r.overAllocated).toBe(false)
    expect(r.universalUlbDraw).toBe(20) // 10 × 2 uncovered seats
  })

  it('subtracts individual-ULB seats from the universal pool draw', () => {
    const r = computePoolSplit({
      orgBudget: orgBudget(1000),
      universalUlb: universal(10),
      seats: [seat('alice'), seat('bob'), seat('carol')],
      userBudgets: [userBudget('alice', 50)],
    })
    expect(r.individualUlbTotal).toBe(50)
    expect(r.universalUlbDraw).toBe(20) // 10 × 2 (bob, carol)
    expect(r.headroom).toBe(930)
    expect(r.overAllocated).toBe(false)
  })

  it('flags over-allocation when committed > org budget', () => {
    const r = computePoolSplit({
      orgBudget: orgBudget(50),
      universalUlb: universal(40),
      seats: [seat('a'), seat('b')],
      userBudgets: [],
    })
    expect(r.universalUlbDraw).toBe(80)
    expect(r.headroom).toBe(0)
    expect(r.overAllocated).toBe(true)
  })

  it('treats login matches as case-insensitive', () => {
    const r = computePoolSplit({
      orgBudget: orgBudget(1000),
      universalUlb: universal(10),
      seats: [seat('Alice'), seat('bob')],
      userBudgets: [userBudget('ALICE', 50)],
    })
    expect(r.universalUlbDraw).toBe(10) // only bob
  })
})

// --- computeBudgetConstraints (the golden rule) ---

describe('computeBudgetConstraints', () => {
  it('reports no-org-budget mode with Infinity max-safe when no org budget', () => {
    const r = computeBudgetConstraints({
      orgBudget: null,
      universalUlb: universal(5),
      seats: [seat('a')],
      userBudgets: [],
    })
    expect(r.mode).toBe('no-org-budget')
    expect(r.mainCheck).toBeNull()
    expect(r.maxSafeUniversalUlb).toBe(Infinity)
  })

  it('passes the golden rule when Σ effective ULBs ≤ org budget', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(100),
      universalUlb: universal(10),
      seats: [seat('a'), seat('b'), seat('c')],
      userBudgets: [userBudget('a', 40)],
    })
    expect(r.mode).toBe('org-budget')
    expect(r.mainCheck?.ok).toBe(true)
    expect(r.mainCheck?.actual).toBe(60) // 40 + 10 × 2
    expect(r.mainCheck?.allowed).toBe(100)
    expect(r.mainCheck?.overBy).toBe(0)
    expect(r.universalSeatCount).toBe(2)
  })

  it('fails with overBy when Σ effective ULBs > org budget', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(50),
      universalUlb: universal(40),
      seats: [seat('a'), seat('b')],
      userBudgets: [],
    })
    expect(r.mainCheck?.ok).toBe(false)
    expect(r.mainCheck?.actual).toBe(80)
    expect(r.mainCheck?.overBy).toBe(30)
  })

  it('maxSafeUniversalUlb = (org − Σind) / universalSeatCount', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(100),
      universalUlb: universal(40),
      seats: [seat('a'), seat('b'), seat('c')],
      userBudgets: [userBudget('a', 40)],
    })
    // (100 − 40) / 2 = 30
    expect(r.maxSafeUniversalUlb).toBe(30)
  })

  it('maxSafeUniversalUlb is Infinity when every seat has an individual ULB', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(100),
      universalUlb: universal(10),
      seats: [seat('a')],
      userBudgets: [userBudget('a', 50)],
    })
    expect(r.maxSafeUniversalUlb).toBe(Infinity)
    expect(r.universalSeatCount).toBe(0)
  })

  it('warns when prevent_further_usage is off on the org budget', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(100, false),
      universalUlb: universal(10),
      seats: [seat('a')],
      userBudgets: [],
    })
    expect(r.warnings.some(w => w.code === 'prevent_further_usage_off')).toBe(true)
  })

  it('warns when seats have no individual nor universal ULB coverage', () => {
    const r = computeBudgetConstraints({
      orgBudget: orgBudget(100),
      universalUlb: null,
      seats: [seat('a'), seat('b')],
      userBudgets: [userBudget('a', 10)],
    })
    const w = r.warnings.find(w => w.code === 'unbounded_user_coverage')
    expect(w).toBeTruthy()
    expect(w?.context?.unboundedSeatCount).toBe(1)
  })
})

// --- Auto-fix proposals ---

describe('budgetAutoFix', () => {
  it('returns null when nothing is broken', () => {
    const ok = computeBudgetConstraints({
      orgBudget: orgBudget(100),
      universalUlb: universal(10),
      seats: [seat('a')],
      userBudgets: [],
    })
    expect(proposeRaiseOrgBudget(ok)).toBeNull()
    expect(proposeLowerUniversalUlb(ok)).toBeNull()
  })

  it('proposes raising the org budget to the current actual', () => {
    const broken = computeBudgetConstraints({
      orgBudget: orgBudget(50),
      universalUlb: universal(40),
      seats: [seat('a'), seat('b')],
      userBudgets: [],
    })
    const p = proposeRaiseOrgBudget(broken)
    expect(p?.scope).toBe('org')
    expect(p?.newValue).toBe(80)
  })

  it('proposes lowering universal ULB to max-safe (floored)', () => {
    const broken = computeBudgetConstraints({
      orgBudget: orgBudget(50),
      universalUlb: universal(40),
      seats: [seat('a'), seat('b')],
      userBudgets: [],
    })
    const p = proposeLowerUniversalUlb(broken)
    expect(p?.scope).toBe('universal_ulb')
    expect(p?.newValue).toBe(25) // 50 / 2
  })

  it('returns null for lower-universal when individual ULBs alone exceed the cap', () => {
    const broken = computeBudgetConstraints({
      orgBudget: orgBudget(50),
      universalUlb: universal(10),
      seats: [seat('a')],
      userBudgets: [userBudget('a', 100)], // already over; universalSeatCount = 0
    })
    expect(proposeLowerUniversalUlb(broken)).toBeNull()
  })

  it('returns null for lower-universal when individual ULBs exceed the cap even with universal-only seats present (clamped to 0)', () => {
    // Mirrors the demo: individual ULBs alone already overshoot the org cap,
    // so the engine clamps maxSafeUniversalUlb to 0. Setting universal to $0
    // would not bring totals into compliance AND would strip the safety net
    // from universal-only seats, so the banner must not offer it as a fix.
    const broken = computeBudgetConstraints({
      orgBudget: orgBudget(50),
      universalUlb: universal(10),
      seats: [seat('a'), seat('b'), seat('c')], // b, c draw from universal
      userBudgets: [userBudget('a', 100)],
    })
    expect(broken.maxSafeUniversalUlb).toBe(0)
    expect(broken.universalSeatCount).toBe(2)
    expect(proposeLowerUniversalUlb(broken)).toBeNull()
  })
})
