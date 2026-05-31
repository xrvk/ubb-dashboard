import type { UserBudget } from './api'
import { projectMonthlyBudget } from './projection'

export type Status = 'over' | 'near' | 'ok'

const NEAR_THRESHOLD = 0.8

export function classifyStatus(budget: UserBudget): Status {
  if (budget.budgetAmount <= 0) return budget.consumedAmount > 0 ? 'over' : 'ok'
  const ratio = budget.consumedAmount / budget.budgetAmount
  if (ratio >= 1) return 'over'
  if (ratio >= NEAR_THRESHOLD) return 'near'
  return 'ok'
}

export function utilization(budget: UserBudget): number {
  if (budget.budgetAmount <= 0) return budget.consumedAmount > 0 ? Infinity : 0
  return budget.consumedAmount / budget.budgetAmount
}

export interface Summary {
  total: number
  over: number
  near: number
  ok: number
  totalBudgeted: number
  totalConsumed: number
}

export function summarize(budgets: UserBudget[]): Summary {
  const summary: Summary = {
    total: budgets.length,
    over: 0,
    near: 0,
    ok: 0,
    totalBudgeted: 0,
    totalConsumed: 0,
  }
  for (const b of budgets) {
    const s = classifyStatus(b)
    summary[s] += 1
    summary.totalBudgeted += b.budgetAmount
    summary.totalConsumed += b.consumedAmount
  }
  return summary
}

export interface Forecast {
  /** Number of budgets summed (matches Summary.total). */
  total: number
  /** Sum of consumedAmount across all budgets (= Summary.totalConsumed). */
  spendMtd: number
  /** Sum of each user's projected end-of-month total at current burn. */
  projectedEom: number
  /** Users currently over budget — already blocked / overspending. */
  alreadyOver: number
  /** Users on track to exceed their cap by EoM at current burn (not yet over). */
  projectedOver: number
  /** Same as Summary.totalBudgeted; convenient for "projected vs cap" framing. */
  totalBudgeted: number
  /** Days elapsed in the current billing cycle; useful for "Day N of M" copy. */
  daysElapsed: number
  daysInMonth: number
  /** True when daysElapsed is low enough that projections are noisy. */
  lowConfidence: boolean
}

/**
 * Roll up per-user end-of-month spend projections for the forecast hero
 * tiles. Uses the same `projectMonthlyBudget` helper that powers the bulk
 * unblock recommendations, so the numbers stay consistent across surfaces.
 */
export function forecastSummary(
  budgets: UserBudget[],
  now: Date = new Date(),
): Forecast {
  let spendMtd = 0
  let projectedEom = 0
  let alreadyOver = 0
  let projectedOver = 0
  for (const b of budgets) {
    spendMtd += b.consumedAmount
    const proj = projectMonthlyBudget(b.consumedAmount, 0, now)
    projectedEom += proj.projectedMonthTotal
    const currentlyOver = b.budgetAmount > 0
      ? b.consumedAmount >= b.budgetAmount
      : b.consumedAmount > 0
    if (currentlyOver) {
      alreadyOver += 1
    } else if (b.budgetAmount > 0 && proj.projectedMonthTotal > b.budgetAmount) {
      projectedOver += 1
    }
  }
  const sample = projectMonthlyBudget(0, 0, now)
  let totalBudgeted = 0
  for (const b of budgets) totalBudgeted += b.budgetAmount
  return {
    total: budgets.length,
    spendMtd,
    projectedEom,
    alreadyOver,
    projectedOver,
    totalBudgeted,
    daysElapsed: sample.daysElapsed,
    daysInMonth: sample.daysInMonth,
    lowConfidence: sample.lowConfidence,
  }
}
