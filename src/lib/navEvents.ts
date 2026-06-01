import type { TableFilters } from '@/components/BudgetsTable'

/**
 * Cross-component navigation events. Used so deeply-nested components (like
 * ConstraintsBanner inside the Overview tab) can ask App.tsx to switch tabs
 * with some context, without lifting tab state into a dedicated context.
 */

export const NAV_TO_INDIVIDUAL_EVENT = 'ubb:nav-to-individual'

/** Navigate to the Universal UBB tab. No payload needed today. */
export const NAV_TO_UNIVERSAL_EVENT = 'ubb:nav-to-universal'

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
  /** Σ of effective UBBs of the CC members at the time of the click. */
  actualUbbSum: number
  /** Current CC budget the members must fit under. */
  ccBudget: number
  /** actualUbbSum − ccBudget. */
  overBy: number
}

export interface NavToIndividualDetail {
  filter: TableFilters
  task?: NavToIndividualTask
}

/** Navigate to the in-app budget constraint model explainer page. */
export const NAV_TO_BUDGET_MODEL_EVENT = 'ubb:nav-to-budget-model'

/**
 * Ask the BudgetPlanner to highlight a section and show a transient banner
 * explaining what adjustment to make. Fired by ConstraintsBanner when the user
 * clicks an abstract action like "Lower cost-center budgets by $X" — the
 * action knows the goal but not which specific row(s) to change, so the
 * planner card shows a contextual hint to guide the manual edit.
 */
export const PLANNER_HIGHLIGHT_EVENT = 'ubb:planner-highlight'

export interface PlannerHighlightDetail {
  /** Which planner section to highlight + banner. */
  target: 'cc-card' | 'ent'
  /** Message rendered in the transient banner. */
  message: string
}

