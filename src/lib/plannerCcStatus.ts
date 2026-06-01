/**
 * Planner-specific cost-center status classification.
 *
 * Distinct from src/lib/ccStatus.ts (which classifies live budget health
 * for the read-only dashboard). Here we classify each CC row by the action
 * the operator needs to take in the Planner:
 *
 *   - uncapped: CC affects Copilot but has no per-CC budget. Highest
 *               priority — usage is only bounded by the enterprise pool.
 *   - under-min: CC has a budget, but it is less than the computed floor
 *                (sum of effective UBBs for its Copilot seats). Will block
 *                users before they reach their UBB ceilings.
 *   - ok: budget covers the floor, or no minimum is required.
 */

export type PlannerCcHealth = 'uncapped' | 'under-min' | 'ok'

export interface PlannerRowShape {
  affectsCopilot: boolean
  budgetId: string | null
  apiAmount: number
}

export function plannerCcHealth(
  row: PlannerRowShape,
  requiredMin: number | null,
  draftAmount: number | null,
): PlannerCcHealth {
  if (row.affectsCopilot && row.budgetId === null) return 'uncapped'
  const effective = draftAmount ?? row.apiAmount
  if (requiredMin !== null && requiredMin > 0 && effective < requiredMin) {
    return 'under-min'
  }
  return 'ok'
}

export const PLANNER_HEALTH_LABEL: Record<PlannerCcHealth, string> = {
  uncapped: 'Uncapped',
  'under-min': 'Under minimum',
  ok: 'OK',
}

export function countByPlannerHealth(
  classified: ReadonlyArray<PlannerCcHealth>,
): Record<PlannerCcHealth, number> {
  const out: Record<PlannerCcHealth, number> = { uncapped: 0, 'under-min': 0, ok: 0 }
  for (const h of classified) out[h] += 1
  return out
}
