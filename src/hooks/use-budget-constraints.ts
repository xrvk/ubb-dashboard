import { useMemo } from 'react'
import { buildCostCenterIndex } from '@/lib/api'
import { computeBudgetConstraints, type BudgetConstraintsResult } from '@/lib/budgetConstraints'
import { useCredentials } from '@/hooks/use-credentials'
import { includedAiCredits, seatCostBreakdown } from '@/lib/pricing'

/**
 * Shared computation of the BudgetConstraintsResult from the credentials
 * context. Components that need to read/show constraint state (banner,
 * planner, diagram) all use this so they stay in sync.
 */
export function useBudgetConstraints(): BudgetConstraintsResult {
  const {
    enterpriseBudget,
    universalUlb,
    costCenters,
    costCenterBudgetsByName,
    seats,
    budgets,
  } = useCredentials()

  return useMemo(() => {
    const index = buildCostCenterIndex(costCenters, costCenterBudgetsByName)
    const breakdown = seatCostBreakdown(seats)
    const pool = includedAiCredits(breakdown.business, breakdown.enterprise)
    return computeBudgetConstraints({
      enterpriseBudget,
      universalUlb,
      costCenters,
      costCenterIndex: index,
      ccBudgetsByName: costCenterBudgetsByName,
      seats,
      userBudgets: budgets,
      poolDollars: pool.totalDollars,
    })
  }, [enterpriseBudget, universalUlb, costCenters, costCenterBudgetsByName, seats, budgets])
}
