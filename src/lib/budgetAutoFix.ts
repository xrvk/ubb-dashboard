/**
 * Auto-fix proposal helpers for the "close the loop" Org Budget UX.
 *
 * Given a `BudgetConstraintsResult`, derive one-click proposals that bring a
 * failing check back to ok by either raising the org budget or lowering the
 * universal ULB to the max-safe value.
 *
 * These helpers are pure and return `null` when no fix applies — either
 * because nothing is broken, or because the proposal would create a new breach.
 */

import type { BudgetConstraintsResult } from './budgetConstraints'

export interface AutoFixProposal {
  /** Short, action-phrased label e.g. "Raise to $612.34". */
  label: string
  /** The new dollar amount to set. */
  newValue: number
  /** Which knob the caller should turn. */
  scope: 'org' | 'universal_ulb'
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Round up to the nearest cent so the proposal definitively covers actuals. */
function ceilCent(n: number): number {
  return Math.ceil(n * 100) / 100
}

/** Round down to the nearest cent so the proposal stays strictly within bounds. */
function floorCent(n: number): number {
  return Math.floor(n * 100) / 100
}

/**
 * Raise the org budget to cover the current Σ ULBs.
 * Returns null when the main check is null (no org budget) or passing.
 */
export function proposeRaiseOrgBudget(
  result: BudgetConstraintsResult,
): AutoFixProposal | null {
  if (!result.mainCheck || result.mainCheck.ok) return null
  const target = ceilCent(result.mainCheck.actual)
  return {
    label: `Raise org budget to ${fmt(target)}`,
    newValue: target,
    scope: 'org',
  }
}

/**
 * Lower the universal ULB to the max value that satisfies the org cap.
 * Returns null when no universal-ULB adjustment can bring things into
 * compliance (e.g. when individual ULBs alone already exceed the cap), or
 * when the main check is already passing.
 */
export function proposeLowerUniversalUlb(
  result: BudgetConstraintsResult,
): AutoFixProposal | null {
  if (!result.mainCheck || result.mainCheck.ok) return null
  const max = result.maxSafeUniversalUlb
  if (!Number.isFinite(max)) return null
  if (max <= 0) return null
  const target = floorCent(max)
  if (target <= 0) return null
  return {
    label: `Lower universal ULB to ${fmt(target)}`,
    newValue: target,
    scope: 'universal_ulb',
  }
}
