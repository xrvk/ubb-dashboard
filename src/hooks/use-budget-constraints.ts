import { useMemo } from 'react'
import { computeBudgetConstraints, type BudgetConstraintsResult } from '@/lib/budgetConstraints'
import { useCredentials } from '@/hooks/use-credentials'

/**
 * Shared computation of the BudgetConstraintsResult from the credentials
 * context. Components that need to read/show constraint state (banner, help
 * page, planner surfaces) all use this so they stay in sync.
 */
export function useBudgetConstraints(): BudgetConstraintsResult {
  const { orgBudget, universalUlb, seats, budgets } = useCredentials()

  return useMemo(
    () =>
      computeBudgetConstraints({
        orgBudget,
        universalUlb,
        seats,
        userBudgets: budgets,
      }),
    [orgBudget, universalUlb, seats, budgets],
  )
}
