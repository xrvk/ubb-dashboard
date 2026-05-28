import type { UserBudget } from './api'

export type Status = 'over' | 'near' | 'ok'

export const NEAR_THRESHOLD = 0.8

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
