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

/**
 * Monthly included AI credits per assigned Copilot license, pooled at the
 * billing-entity level. 1 AI credit = $0.01 USD, so the dollar-equivalent
 * pool size is `(cb_seats × cb_credits + ce_seats × ce_credits) × 0.01`.
 *
 * Existing CB/CE customers get a higher promotional amount during the first
 * three months of usage-based billing (June 1 – September 1, 2026):
 *   • CB: 3,000 credits ($30) instead of 1,900 ($19)
 *   • CE: 7,000 credits ($70) instead of 3,900 ($39)
 *
 * After Sept 1, 2026 the standard amounts apply.
 *
 * Reference: https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises#how-do-ai-credits-work
 */
export const COPILOT_BUSINESS_CREDITS_STANDARD = 1_900
export const COPILOT_ENTERPRISE_CREDITS_STANDARD = 3_900
export const COPILOT_BUSINESS_CREDITS_PROMO = 3_000
export const COPILOT_ENTERPRISE_CREDITS_PROMO = 7_000

const PROMO_START = new Date('2026-06-01T00:00:00Z').getTime()
const PROMO_END = new Date('2026-09-01T00:00:00Z').getTime()

/** Whether the included-credits promotional window is currently active. */
export function isCreditPromoActive(now: Date = new Date()): boolean {
  const t = now.getTime()
  return t >= PROMO_START && t < PROMO_END
}

export interface IncludedCredits {
  /** Per-CB-seat included AI credits this month. */
  perBusiness: number
  /** Per-CE-seat included AI credits this month. */
  perEnterprise: number
  /** Total pooled AI credits across business + enterprise seats. */
  totalCredits: number
  /** USD value of the pool (1 AI credit = $0.01). */
  totalDollars: number
  /** True when the higher promotional amounts are in effect. */
  promoActive: boolean
}

/**
 * Compute the included AI credit pool for a given seat mix. Returns the
 * per-seat rate alongside the pooled totals so callers can render either
 * the unit price or the rolled-up dollar value.
 *
 * `overrides.promoActive` lets callers force the promo on or off — useful
 * for customers who signed up after the transition and so don't qualify
 * for the bumped allowance, and for previewing the post-promo experience.
 * When omitted, the value is derived from the calendar window.
 */
export function includedAiCredits(
  business: number,
  enterprise: number,
  now: Date = new Date(),
  overrides?: { promoActive?: boolean },
): IncludedCredits {
  const promoActive = overrides?.promoActive ?? isCreditPromoActive(now)
  const perBusiness = promoActive
    ? COPILOT_BUSINESS_CREDITS_PROMO
    : COPILOT_BUSINESS_CREDITS_STANDARD
  const perEnterprise = promoActive
    ? COPILOT_ENTERPRISE_CREDITS_PROMO
    : COPILOT_ENTERPRISE_CREDITS_STANDARD
  const totalCredits = business * perBusiness + enterprise * perEnterprise
  return {
    perBusiness,
    perEnterprise,
    totalCredits,
    totalDollars: totalCredits * 0.01,
    promoActive,
  }
}

import type { CopilotSeat, OrgPlanType } from './api'

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
 * pricing.
 *
 * When `orgPlans` is provided, classification uses the per-org Copilot plan
 * (the same data source the GHEC admin UI's CB/CE counts derive from): a
 * user is CE if any org they appear in is on the enterprise plan, otherwise
 * CB. Orgs with `'unknown'` plan and enterprise-team-only seats (no orgs)
 * default to CB since CE seats come only from CE-plan orgs and enterprise
 * teams hold CB licenses. This is the accurate path and what callers should
 * use whenever per-org plans are available.
 *
 * When `orgPlans` is omitted (e.g. the per-org rollup failed to load),
 * falls back to matching the per-seat `planType` string permissively
 * (`'enterprise'` ⊂ → CE, `'business'` ⊂ → CB). This is the legacy path;
 * it under-counts CE in mixed enterprises because the per-seat field
 * reflects the granting org's plan as reported on the seat object, which
 * disagrees with the actual billed tier in some configurations.
 */
export function seatCostBreakdown(
  seats: CopilotSeat[],
  orgPlans?: ReadonlyMap<string, OrgPlanType>,
): SeatCostBreakdown {
  let business = 0
  let enterprise = 0
  let other = 0
  // An empty `orgPlans` map means the rollup never loaded (demo mode, or
  // every call failed). Treat that the same as omitted so callers don't
  // need a sentinel check at every call site.
  const useOrgPlans = orgPlans !== undefined && orgPlans.size > 0
  for (const s of seats) {
    if (useOrgPlans) {
      let hasEnterprise = false
      for (const org of s.orgLogins) {
        if (orgPlans!.get(org.toLowerCase()) === 'enterprise') {
          hasEnterprise = true
          break
        }
      }
      if (hasEnterprise) enterprise += 1
      else business += 1
    } else {
      const plan = (s.planType ?? '').toLowerCase()
      if (plan.includes('enterprise')) enterprise += 1
      else if (plan.includes('business')) business += 1
      else other += 1
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
