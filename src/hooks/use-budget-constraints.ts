import { useMemo } from 'react'
import { buildCostCenterIndex } from '@/lib/api'
import { computeBudgetConstraints, type BudgetConstraintsResult } from '@/lib/budgetConstraints'
import { useCredentials } from '@/hooks/use-credentials'

/**
 * Shared computation of the BudgetConstraintsResult from the credentials
 * context. Components that need to read/show constraint state (banner,
 * planner, diagram) all use this so they stay in sync.
 */
export function useBudgetConstraints(): BudgetConstraintsResult {
  const {
    enterpriseBudget,
    universalUbb,
    costCenters,
    costCenterBudgetsByName,
    seats,
    budgets,
  } = useCredentials()

  return useMemo(() => {
    const index = buildCostCenterIndex(costCenters, costCenterBudgetsByName)
    return computeBudgetConstraints({
      enterpriseBudget,
      universalUbb,
      costCenters,
      costCenterIndex: index,
      ccBudgetsByName: costCenterBudgetsByName,
      seats,
      userBudgets: budgets,
    })
  }, [enterpriseBudget, universalUbb, costCenters, costCenterBudgetsByName, seats, budgets])
}
