/**
 * Pure helpers for projecting monthly Copilot spend and recommending a new
 * individual UBB cap. Used by the bulk "Unblock for month" flow.
 */

export interface MonthlyProjection {
  daysInMonth: number
  daysElapsed: number
  daysRemaining: number
  dailyRate: number
  projectedMonthTotal: number
  recommendedBudget: number
  /**
   * True when the elapsed window is too short for the daily rate to be a
   * reliable signal. The UI surfaces this so admins can sanity-check
   * recommendations made off 1-4 days of data.
   */
  lowConfidence: boolean
}

const LOW_CONFIDENCE_THRESHOLD_DAYS = 5

/**
 * Project a user's full-month consumption based on what they've already used
 * this month, then recommend a budget cap that includes a growth buffer.
 *
 * Math:
 *   dailyRate         = consumed / daysElapsed
 *   projectedMonth    = consumed + dailyRate * daysRemaining
 *   recommendedBudget = projectedMonth * (1 + growthBuffer)
 *
 * The recommendation is rounded to the nearest whole dollar (always rounding
 * up so the user is never blocked because of cents).
 *
 * Inputs are defensively sanitized: a non-finite or negative `consumed` or
 * `growthBuffer` is clamped to 0 rather than allowed to produce a NaN /
 * Infinity recommendation that the UI would render as "$NaN" or "$Infinity"
 * to a customer.
 */
export function projectMonthlyBudget(
  consumed: number,
  growthBuffer: number,
  now: Date = new Date(),
): MonthlyProjection {
  const safeConsumed = Number.isFinite(consumed) && consumed > 0 ? consumed : 0
  const safeGrowth = Number.isFinite(growthBuffer) && growthBuffer > 0 ? growthBuffer : 0
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysElapsed = Math.max(1, dayOfMonth)
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth)
  const dailyRate = safeConsumed / daysElapsed
  const projectedMonthTotal = safeConsumed + dailyRate * daysRemaining
  const raw = projectedMonthTotal * (1 + safeGrowth)
  const recommendedBudget = Math.max(1, Math.ceil(raw))
  return {
    daysInMonth,
    daysElapsed,
    daysRemaining,
    dailyRate,
    projectedMonthTotal,
    recommendedBudget,
    lowConfidence: dayOfMonth < LOW_CONFIDENCE_THRESHOLD_DAYS,
  }
}
