import { describe, it, expect } from 'vitest'
import { classifyStatus, forecastSummary, summarize, utilization } from '@/lib/status'
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

describe('forecastSummary', () => {
  // Pick day 15 of a 30-day month so projection math is trivial (rate × 2).
  const NOW = new Date(2025, 5, 15) // June 15 2025 → 30-day month

  it('classifies users into alreadyOver vs projectedOver and rolls up totals', () => {
    const f = forecastSummary(
      [
        ub(150, 100), // already over
        ub(60, 100),  // proj = 120 > cap → projected over
        ub(20, 100),  // proj = 40 < cap → safe
        ub(0, 0),     // no consumption, no cap → ignored
      ],
      NOW,
    )
    expect(f.alreadyOver).toBe(1)
    expect(f.projectedOver).toBe(1)
    expect(f.total).toBe(4)
    expect(f.spendMtd).toBe(230)
    expect(f.projectedEom).toBeCloseTo(300 + 120 + 40 + 0) // each consumption doubles at day 15/30
    expect(f.totalBudgeted).toBe(300)
    expect(f.daysElapsed).toBe(15)
    expect(f.daysInMonth).toBe(30)
    expect(f.lowConfidence).toBe(false)
  })

  it('marks low confidence early in the month', () => {
    const f = forecastSummary([ub(10, 100)], new Date(2025, 5, 2))
    expect(f.lowConfidence).toBe(true)
  })

  it('treats positive consumption against a zero cap as already over, not projected', () => {
    const f = forecastSummary([ub(5, 0)], NOW)
    expect(f.alreadyOver).toBe(1)
    expect(f.projectedOver).toBe(0)
  })
})

describe('parseEnterpriseUrl', () => {
  it('parses GHE.com URLs and adds api. subdomain', () => {
    expect(parseEnterpriseUrl('https://acme.ghe.com/enterprises/acme')).toEqual({
      base: 'https://api.acme.ghe.com',
      ent: 'acme',
    })
  })
  it('parses github.com URLs', () => {
    expect(parseEnterpriseUrl('https://github.com/enterprises/foo')).toEqual({
      base: 'https://api.github.com',
      ent: 'foo',
    })
  })
  it('accepts GHE.com API URLs (api. prefix) with trailing slash', () => {
    // Some GHE.com docs use the API form; make sure pasting it works.
    expect(parseEnterpriseUrl('https://api.acme.ghe.com/enterprises/acme/')).toEqual({
      base: 'https://api.acme.ghe.com',
      ent: 'acme',
    })
  })
  it('returns null on bad URL', () => {
    expect(parseEnterpriseUrl('not a url')).toBeNull()
  })
})
