/**
 * Pure helpers for projecting monthly Copilot spend and recommending a new
 * individual ULB cap. Used by the bulk "Unblock for month" flow.
 */

export interface MonthlyProjection {
  daysInMonth: number
  daysElapsed: number
  daysRemaining: number
  dailyRate: number
  projectedMonthTotal: number
  recommendedBudget: number
}

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
 */
export function projectMonthlyBudget(
  consumed: number,
  growthBuffer: number,
  now: Date = new Date(),
): MonthlyProjection {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysElapsed = Math.max(1, dayOfMonth)
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth)
  const dailyRate = consumed / daysElapsed
  const projectedMonthTotal = consumed + dailyRate * daysRemaining
  const raw = projectedMonthTotal * (1 + growthBuffer)
  const recommendedBudget = Math.max(1, Math.ceil(raw))
  return {
    daysInMonth,
    daysElapsed,
    daysRemaining,
    dailyRate,
    projectedMonthTotal,
    recommendedBudget,
  }
}
