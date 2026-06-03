/**
 * Typed helpers for cross-page navigation. Wraps the CustomEvent bus in
 * `navEvents.ts` so callers don't have to assemble payloads or remember
 * event constants — every deep-link site goes through one of these
 * functions.
 *
 * Today the destination tab lives in App.tsx's useState, so navigation is
 * imperative (dispatch event → App's effect switches tab). If we ever move
 * tab state into the URL, this is the one module that needs to change.
 */
import { EMPTY_FILTERS, type TableFilters } from '@/components/BudgetsTable'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
  PLANNER_HIGHLIGHT_EVENT,
  type NavToIndividualDetail,
  type NavToIndividualTask,
  type PlannerHighlightDetail,
} from '@/lib/navEvents'

/**
 * Navigate to the Individual ULBs tab. Any subset of TableFilters fields
 * can be provided; unspecified fields fall back to EMPTY_FILTERS so callers
 * don't have to think about the unrelated parts of the filter shape.
 */
export function navigateToIndividual(opts: {
  filter?: Partial<TableFilters>
  task?: NavToIndividualTask
} = {}): void {
  const detail: NavToIndividualDetail = {
    filter: { ...EMPTY_FILTERS, ...(opts.filter ?? {}) },
    task: opts.task,
  }
  window.dispatchEvent(new CustomEvent<NavToIndividualDetail>(NAV_TO_INDIVIDUAL_EVENT, { detail }))
}

/** Navigate to the Universal ULB tab. App flashes the cap card on arrival. */
export function navigateToUniversal(): void {
  window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT))
}

/** Navigate to the in-app budget constraint model explainer. */
export function navigateToBudgetModel(): void {
  window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT))
}

/**
 * Navigate to the Budget model page and highlight a specific section with a
 * transient banner explaining what the user should adjust.
 */
export function highlightBudgetPlanner(detail: PlannerHighlightDetail): void {
  window.dispatchEvent(
    new CustomEvent<PlannerHighlightDetail>(PLANNER_HIGHLIGHT_EVENT, { detail }),
  )
}
