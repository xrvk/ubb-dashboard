import type { TableFilters } from '@/components/BudgetsTable'

/**
 * Cross-component navigation events. Used so deeply-nested components (like
 * ConstraintsBanner inside the Overview tab) can ask App.tsx to switch tabs
 * with some context, without lifting tab state into a dedicated context.
 */

export const NAV_TO_INDIVIDUAL_EVENT = 'ulb:nav-to-individual'

export interface NavToIndividualDetail {
  filter: TableFilters
}

/** Navigate to the in-app budget constraint model explainer page. */
export const NAV_TO_BUDGET_MODEL_EVENT = 'ulb:nav-to-budget-model'

