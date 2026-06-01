/**
 * Auto-fix proposal helpers for the "close the loop" Overview UX.
 *
 * Given a `BudgetConstraintsResult`, derive one-click proposals that bring a
 * failing check back to ok by adjusting the top side (raise a budget) or the
 * bottom side (lower the universal UBB to the max-safe value).
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
  scope: 'enterprise' | 'cost_center' | 'universal_ubb'
  /** For `cost_center`, the CC id (matches `PerCcCheck.costCenterId`). */
  targetId?: string
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Round up to the nearest cent so the proposal definitively covers actuals. */
function ceilCent(n: number): number {
  return Math.ceil(n * 100) / 100
}

/** Round down to the nearest cent so we don't propose a universal UBB that re-breaches. */
function floorCent(n: number): number {
  return Math.floor(n * 100) / 100
}

/**
 * Propose a new enterprise budget that covers current UBB allocation.
 * - umbrella: ent must cover Σ CC budgets + Σ unassigned UBBs (whichever sum is larger).
 * - independent: ent only needs to cover Σ unassigned UBBs (CC budgets are separate).
 * Returns `null` when there is no enterprise budget to PATCH, or when nothing is broken.
 */
export function proposeRaiseEnt(result: BudgetConstraintsResult): AutoFixProposal | null {
  const { mode, checks } = result
  if (mode === 'no-enterprise-budget') return null
  const leftover = checks.unassignedLeftover
  const ccVsEnt = checks.ccVsEnterprise
  if (!leftover && !ccVsEnt) return null

  // Required minimum to satisfy all ent-side checks.
  let required: number
  if (mode === 'umbrella') {
    // unassignedLeftover.actual is the Σ UBBs of unassigned users.
    // ccVsEnterprise.actual is Σ CC budgets.
    // Together they must fit under the ent budget.
    required = (ccVsEnt?.actual ?? 0) + (leftover?.actual ?? 0)
  } else {
    // independent: only unassigned UBBs hit the ent budget.
    required = leftover?.actual ?? 0
  }

  const allowed = leftover?.allowed ?? ccVsEnt?.allowed
  if (allowed == null) return null
  // In umbrella mode, leftover.allowed = ent - Σ CC budgets; the actual ent
  // budget is leftover.allowed + ccVsEnt.actual. In independent mode, allowed
  // already IS the ent budget.
  const currentEnt =
    mode === 'umbrella' ? (leftover?.allowed ?? 0) + (ccVsEnt?.actual ?? 0) : (leftover?.allowed ?? 0)

  const newValue = ceilCent(required)
  if (newValue <= currentEnt) return null

  return {
    label: `Raise to ${fmt(newValue)}`,
    newValue,
    scope: 'enterprise',
  }
}

/**
 * Propose a new per-CC budget that covers its members' current UBBs.
 * Returns `null` when the CC check is ok or when the CC isn't tracked.
 */
export function proposeRaiseCc(
  result: BudgetConstraintsResult,
  costCenterId: string,
): AutoFixProposal | null {
  const cc = result.checks.perCc.find(c => c.costCenterId === costCenterId)
  if (!cc || cc.check.ok) return null
  const newValue = ceilCent(cc.check.actual)
  if (newValue <= cc.check.allowed) return null
  return {
    label: `Raise CC budget to ${fmt(newValue)}`,
    newValue,
    scope: 'cost_center',
    targetId: costCenterId,
  }
}

/**
 * Propose lowering the universal UBB to the max-safe value when the current
 * universal is over it. Returns `null` when there's no universal UBB, when
 * the safe max is `Infinity` (nothing binds), or when we're already under it.
 *
 * Caller passes the current universal UBB amount (since the engine result
 * doesn't echo it back).
 */
export function proposeLowerUniversalUbb(
  result: BudgetConstraintsResult,
  currentUniversalUbb: number | null,
): AutoFixProposal | null {
  if (currentUniversalUbb == null) return null
  if (!Number.isFinite(result.maxSafeUniversalUbb)) return null
  const safe = floorCent(result.maxSafeUniversalUbb)
  if (currentUniversalUbb <= safe) return null
  // Suppress the proposal when the safe value would be $0 (or negative). At
  // that point "lower the universal UBB" effectively means "turn it off" —
  // which isn't a real fix, it just shifts the problem onto whatever still
  // needs an envelope (the enterprise budget or per-CC budgets). The caller
  // should surface a different action (raise enterprise, set per-CC budgets)
  // in that case.
  if (safe <= 0) return null
  return {
    label: `Lower universal UBB to ${fmt(safe)}`,
    newValue: safe,
    scope: 'universal_ubb',
  }
}

/**
 * Required minimums per scope, for use as read-only "Required: $X" chips.
 * Returns 0 when nothing currently consumes the envelope.
 */
export interface RequiredMinimums {
  enterprise: number | null
  perCc: Map<string, number>
}

export function computeRequiredMinimums(
  result: BudgetConstraintsResult,
): RequiredMinimums {
  const { mode, checks } = result

  let enterprise: number | null = null
  if (mode !== 'no-enterprise-budget') {
    if (mode === 'umbrella') {
      enterprise = (checks.ccVsEnterprise?.actual ?? 0) + (checks.unassignedLeftover?.actual ?? 0)
    } else {
      enterprise = checks.unassignedLeftover?.actual ?? 0
    }
  }

  const perCc = new Map<string, number>()
  for (const cc of checks.perCc) {
    perCc.set(cc.costCenterId, cc.check.actual)
  }

  return { enterprise, perCc }
}
