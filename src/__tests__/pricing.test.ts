import { describe, it, expect } from 'vitest'
import {
  COPILOT_BUSINESS_CREDITS_PROMO,
  COPILOT_BUSINESS_CREDITS_STANDARD,
  COPILOT_BUSINESS_LIST_PRICE,
  COPILOT_ENTERPRISE_CREDITS_PROMO,
  COPILOT_ENTERPRISE_CREDITS_STANDARD,
  COPILOT_ENTERPRISE_LIST_PRICE,
  includedAiCredits,
  isCreditPromoActive,
  seatCostBreakdown,
} from '@/lib/pricing'
import type { CopilotSeat, OrgPlanType } from '@/lib/api'

function seat(planType: string | null, login = 'u'): CopilotSeat {
  return { login, orgLogin: null, orgLogins: [], lastActivityAt: null, planType }
}

function orgSeat(login: string, orgs: string[]): CopilotSeat {
  return {
    login,
    orgLogin: orgs[0] ?? null,
    orgLogins: orgs,
    lastActivityAt: null,
    // planType deliberately set to a misleading value so we can prove the
    // org-plan path is in use and ignoring it.
    planType: 'business',
  }
}

describe('isCreditPromoActive', () => {
  it('is false the millisecond before the promo opens', () => {
    expect(isCreditPromoActive(new Date('2026-05-31T23:59:59.999Z'))).toBe(false)
  })

  it('is true at the exact promo start instant', () => {
    expect(isCreditPromoActive(new Date('2026-06-01T00:00:00.000Z'))).toBe(true)
  })

  it('is true mid-promo', () => {
    expect(isCreditPromoActive(new Date('2026-07-15T12:00:00Z'))).toBe(true)
  })

  it('is true the millisecond before the promo closes', () => {
    expect(isCreditPromoActive(new Date('2026-08-31T23:59:59.999Z'))).toBe(true)
  })

  it('is false at the exact promo end instant (end is exclusive)', () => {
    expect(isCreditPromoActive(new Date('2026-09-01T00:00:00.000Z'))).toBe(false)
  })

  it('is false long after the promo window', () => {
    expect(isCreditPromoActive(new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('includedAiCredits', () => {
  const beforePromo = new Date('2026-01-01T00:00:00Z')
  const duringPromo = new Date('2026-07-15T00:00:00Z')

  it('uses standard rates outside the promo window', () => {
    const r = includedAiCredits(10, 5, beforePromo)
    expect(r.promoActive).toBe(false)
    expect(r.perBusiness).toBe(COPILOT_BUSINESS_CREDITS_STANDARD)
    expect(r.perEnterprise).toBe(COPILOT_ENTERPRISE_CREDITS_STANDARD)
    expect(r.totalCredits).toBe(10 * 1_900 + 5 * 3_900) // 38,500
    expect(r.totalDollars).toBeCloseTo(385, 6)
  })

  it('uses promo rates inside the promo window', () => {
    const r = includedAiCredits(10, 5, duringPromo)
    expect(r.promoActive).toBe(true)
    expect(r.perBusiness).toBe(COPILOT_BUSINESS_CREDITS_PROMO)
    expect(r.perEnterprise).toBe(COPILOT_ENTERPRISE_CREDITS_PROMO)
    expect(r.totalCredits).toBe(10 * 3_000 + 5 * 7_000) // 65,000
    expect(r.totalDollars).toBeCloseTo(650, 6)
  })

  it('returns zeroes when there are no seats', () => {
    const r = includedAiCredits(0, 0, duringPromo)
    expect(r.totalCredits).toBe(0)
    expect(r.totalDollars).toBe(0)
  })

  it('handles CB-only and CE-only mixes', () => {
    const cbOnly = includedAiCredits(7, 0, beforePromo)
    expect(cbOnly.totalCredits).toBe(7 * 1_900)
    const ceOnly = includedAiCredits(0, 4, beforePromo)
    expect(ceOnly.totalCredits).toBe(4 * 3_900)
  })

  it('honors overrides.promoActive=true even outside the window', () => {
    const r = includedAiCredits(1, 1, beforePromo, { promoActive: true })
    expect(r.promoActive).toBe(true)
    expect(r.perBusiness).toBe(COPILOT_BUSINESS_CREDITS_PROMO)
    expect(r.perEnterprise).toBe(COPILOT_ENTERPRISE_CREDITS_PROMO)
    expect(r.totalCredits).toBe(3_000 + 7_000)
  })

  it('honors overrides.promoActive=false even inside the window', () => {
    const r = includedAiCredits(1, 1, duringPromo, { promoActive: false })
    expect(r.promoActive).toBe(false)
    expect(r.perBusiness).toBe(COPILOT_BUSINESS_CREDITS_STANDARD)
    expect(r.perEnterprise).toBe(COPILOT_ENTERPRISE_CREDITS_STANDARD)
    expect(r.totalCredits).toBe(1_900 + 3_900)
  })

  it('converts AI credits to dollars at exactly 100 credits per dollar', () => {
    // 1,000 CB seats × 1,900 credits = 1,900,000 credits = $19,000
    const r = includedAiCredits(1_000, 0, beforePromo)
    expect(r.totalCredits).toBe(1_900_000)
    expect(r.totalDollars).toBe(19_000)
  })
})

describe('seatCostBreakdown', () => {
  it('returns all zeroes for an empty seat list', () => {
    const r = seatCostBreakdown([])
    expect(r).toEqual({ business: 0, enterprise: 0, other: 0, total: 0, monthlyCost: 0 })
  })

  it('classifies bare "business" and "enterprise" plan strings', () => {
    const r = seatCostBreakdown([seat('business'), seat('enterprise')])
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(1)
    expect(r.monthlyCost).toBe(COPILOT_BUSINESS_LIST_PRICE + COPILOT_ENTERPRISE_LIST_PRICE)
  })

  it('classifies the legacy "copilot_business" / "copilot_enterprise" variants', () => {
    const r = seatCostBreakdown([seat('copilot_business'), seat('copilot_enterprise')])
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(1)
  })

  it('is case-insensitive on plan strings', () => {
    const r = seatCostBreakdown([seat('Copilot Business'), seat('COPILOT_ENTERPRISE')])
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(1)
  })

  it('prefers enterprise when both keywords are present (e.g. "copilot_enterprise_business_addon")', () => {
    // Substring matcher: "enterprise" branch is checked first.
    const r = seatCostBreakdown([seat('copilot_enterprise_business')])
    expect(r.enterprise).toBe(1)
    expect(r.business).toBe(0)
  })

  it('counts null or unknown plan_type strings into "other" with zero cost', () => {
    const r = seatCostBreakdown([seat(null), seat('mystery_plan'), seat('')])
    expect(r.other).toBe(3)
    expect(r.business).toBe(0)
    expect(r.enterprise).toBe(0)
    expect(r.monthlyCost).toBe(0)
    expect(r.total).toBe(3)
  })

  it('computes monthlyCost as business*$19 + enterprise*$39', () => {
    const seats = [
      seat('business'),
      seat('business'),
      seat('business'),
      seat('enterprise'),
      seat('enterprise'),
      seat(null),
    ]
    const r = seatCostBreakdown(seats)
    expect(r.business).toBe(3)
    expect(r.enterprise).toBe(2)
    expect(r.other).toBe(1)
    expect(r.total).toBe(6)
    expect(r.monthlyCost).toBe(3 * 19 + 2 * 39)
  })
})

describe('seatCostBreakdown with per-org plan rollup', () => {
  const plans = new Map<string, OrgPlanType>([
    ['org-ce', 'enterprise'],
    ['org-cb', 'business'],
    ['org-unknown', 'unknown'],
  ])

  it('classifies seats by org plan, ignoring per-seat planType', () => {
    const r = seatCostBreakdown(
      [orgSeat('alice', ['org-ce']), orgSeat('bob', ['org-cb'])],
      plans,
    )
    expect(r.enterprise).toBe(1)
    expect(r.business).toBe(1)
    expect(r.other).toBe(0)
    expect(r.monthlyCost).toBe(19 + 39)
  })

  it('picks CE when a user is in both a CE and a CB org', () => {
    const r = seatCostBreakdown(
      [orgSeat('alice', ['org-cb', 'org-ce'])],
      plans,
    )
    expect(r.enterprise).toBe(1)
    expect(r.business).toBe(0)
  })

  it('defaults enterprise-team-only seats (no orgs) to CB', () => {
    const r = seatCostBreakdown([orgSeat('alice', [])], plans)
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(0)
    expect(r.other).toBe(0)
  })

  it('defaults seats whose orgs are all unknown to CB', () => {
    const r = seatCostBreakdown([orgSeat('alice', ['org-unknown'])], plans)
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(0)
  })

  it('defaults seats whose orgs are not in the map to CB', () => {
    const r = seatCostBreakdown([orgSeat('alice', ['mystery-org'])], plans)
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(0)
  })

  it('matches org plan lookups case-insensitively', () => {
    const r = seatCostBreakdown([orgSeat('alice', ['ORG-CE'])], plans)
    expect(r.enterprise).toBe(1)
  })

  it('never lands a seat in "other" when org plans are provided', () => {
    // Real customer parity: every seat is billed as either CB or CE.
    const r = seatCostBreakdown(
      [
        orgSeat('a', ['org-ce']),
        orgSeat('b', ['org-cb']),
        orgSeat('c', []),
        orgSeat('d', ['org-unknown']),
      ],
      plans,
    )
    expect(r.other).toBe(0)
    expect(r.total).toBe(4)
  })

  it('falls back to legacy planType path when orgPlans not supplied', () => {
    const r = seatCostBreakdown([orgSeat('a', ['org-ce'])])
    // planType is 'business' on the fixture; without orgPlans we trust it.
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(0)
  })

  it('treats an empty orgPlans map as "not supplied" (legacy path)', () => {
    // Guards against demo / pre-load state wiping out CE classification
    // when the rollup never ran.
    const r = seatCostBreakdown([orgSeat('a', ['org-ce'])], new Map())
    expect(r.business).toBe(1)
    expect(r.enterprise).toBe(0)
  })
})
