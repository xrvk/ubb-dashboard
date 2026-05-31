/**
 * Copilot seat-license list pricing.
 *
 * These are the public list prices per seat per month. Real customer
 * contracts often differ (volume discounts, EA pricing, promo credits),
 * so the dashboard surfaces an explicit "list pricing" caveat next to any
 * number derived from these constants.
 *
 * Reference: https://github.com/features/copilot/plans
 */
export const COPILOT_BUSINESS_LIST_PRICE = 19
export const COPILOT_ENTERPRISE_LIST_PRICE = 39

import type { CopilotSeat } from './api'

export interface SeatCostBreakdown {
  business: number
  enterprise: number
  other: number
  /** Sum of business + enterprise + other counts. */
  total: number
  /** business * $19 + enterprise * $39 (other contributes $0 since we don't know their plan). */
  monthlyCost: number
}

/**
 * Group seats by plan type and compute the monthly license cost at list
 * pricing. `planType` strings are matched permissively because the API
 * has used variants like `business`, `copilot_business`, `enterprise`,
 * `copilot_enterprise` over time.
 */
export function seatCostBreakdown(seats: CopilotSeat[]): SeatCostBreakdown {
  let business = 0
  let enterprise = 0
  let other = 0
  for (const s of seats) {
    const plan = (s.planType ?? '').toLowerCase()
    if (plan.includes('enterprise')) {
      enterprise += 1
    } else if (plan.includes('business')) {
      business += 1
    } else {
      other += 1
    }
  }
  return {
    business,
    enterprise,
    other,
    total: business + enterprise + other,
    monthlyCost:
      business * COPILOT_BUSINESS_LIST_PRICE + enterprise * COPILOT_ENTERPRISE_LIST_PRICE,
  }
}
