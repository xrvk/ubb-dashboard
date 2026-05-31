import type { TableFilters } from '@/components/BudgetsTable'

/**
 * Cross-component navigation events. Used so deeply-nested components (like
 * ConstraintsBanner inside the Overview tab) can ask App.tsx to switch tabs
 * with some context, without lifting tab state into a dedicated context.
 */

export const NAV_TO_INDIVIDUAL_EVENT = 'ulb:nav-to-individual'

/**
 * Task context attached to a deep-link nav. Rendered as a contextual banner at
 * the top of the destination page so the user remembers what they came to fix
 * and what "done" looks like.
 */
export interface NavToIndividualTask {
  /** Stable id so re-applying the same task is a no-op. */
  id: string
  /** Which failing check sent the user here. */
  kind: 'cc-over'
  costCenterId: string
  costCenterName: string
  memberCount: number
  /** Σ of effective ULBs of the CC members at the time of the click. */
  actualUlbSum: number
  /** Current CC budget the members must fit under. */
  ccBudget: number
  /** actualUlbSum − ccBudget. */
  overBy: number
}

export interface NavToIndividualDetail {
  filter: TableFilters
  task?: NavToIndividualTask
}

/** Navigate to the in-app budget constraint model explainer page. */
export const NAV_TO_BUDGET_MODEL_EVENT = 'ulb:nav-to-budget-model'

