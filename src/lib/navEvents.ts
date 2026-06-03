/**
 * Cross-component navigation events. Used so deeply-nested components (like
 * ConstraintsBanner inside the Org Budget tab) can ask App.tsx to switch
 * tabs with some context, without lifting tab state into a dedicated context.
 *
 * In the org variant there are no cost-center deep-links — every nav target
 * is a simple tab switch.
 */

export const NAV_TO_INDIVIDUAL_EVENT = 'ubb:nav-to-individual'

/** Navigate to the Universal ULB tab. */
export const NAV_TO_UNIVERSAL_EVENT = 'ubb:nav-to-universal'

/** Navigate to the Org Budget tab. */
export const NAV_TO_ORG_BUDGET_EVENT = 'ubb:nav-to-org-budget'

/** Navigate to the in-app budget constraint model explainer page. */
export const NAV_TO_BUDGET_MODEL_EVENT = 'ubb:nav-to-budget-model'
