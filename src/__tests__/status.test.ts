import { describe, it, expect } from 'vitest'
import { classifyStatus, summarize, utilization } from '@/lib/status'
import { parseEnterpriseUrl } from '@/lib/api'
import type { UserBudget } from '@/lib/api'

function ub(over: number, budget: number): UserBudget {
  return {
    id: 'x',
    user: 'u',
    budgetAmount: budget,
    consumedAmount: over,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
}

describe('classifyStatus', () => {
  it('returns ok when consumed is below the near threshold', () => {
    expect(classifyStatus(ub(5, 100))).toBe('ok')
  })
  it('returns near at 80%', () => {
    expect(classifyStatus(ub(80, 100))).toBe('near')
  })
  it('returns over at 100%', () => {
    expect(classifyStatus(ub(100, 100))).toBe('over')
  })
  it('returns over above 100%', () => {
    expect(classifyStatus(ub(150, 100))).toBe('over')
  })
  it('handles zero budget with no consumption', () => {
    expect(classifyStatus(ub(0, 0))).toBe('ok')
  })
  it('handles zero budget with consumption', () => {
    expect(classifyStatus(ub(1, 0))).toBe('over')
  })
})

describe('utilization', () => {
  it('returns Infinity when zero budget and positive consumption', () => {
    expect(utilization(ub(1, 0))).toBe(Infinity)
  })
  it('returns ratio', () => {
    expect(utilization(ub(50, 100))).toBe(0.5)
  })
})

describe('summarize', () => {
  it('aggregates counts and totals', () => {
    const s = summarize([ub(0, 100), ub(80, 100), ub(150, 100)])
    expect(s).toEqual({
      total: 3,
      over: 1,
      near: 1,
      ok: 1,
      totalBudgeted: 300,
      totalConsumed: 230,
    })
  })
})

describe('parseEnterpriseUrl', () => {
  it('parses GHE.com URLs and adds api. subdomain', () => {
    expect(parseEnterpriseUrl('https://tbb-staffship.ghe.com/enterprises/tbb-staffship')).toEqual({
      base: 'https://api.tbb-staffship.ghe.com',
      ent: 'tbb-staffship',
    })
  })
  it('parses github.com URLs', () => {
    expect(parseEnterpriseUrl('https://github.com/enterprises/foo')).toEqual({
      base: 'https://api.github.com',
      ent: 'foo',
    })
  })
  it('returns null on bad URL', () => {
    expect(parseEnterpriseUrl('not a url')).toBeNull()
  })
})
