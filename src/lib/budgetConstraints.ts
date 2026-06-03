/**
 * Pure constraint calculator that enforces the "golden rule" for the org
 * variant: Σ effective per-user ULBs must remain the binding constraint, not
 * the org-level envelope.
 *
 * The org variant collapses to a single hard check:
 *
 *   Σ over all seats of effectiveUlb(seat) ≤ org budget
 *
 * where `effectiveUlb` is the user's individual ULB if set, otherwise the
 * universal ULB amount (or 0 when neither is configured).
 *
 * See docs/budget-constraints.md for the model, vocabulary, and justification.
 *
 * This module is intentionally dependency-free apart from the data types in
 * `./api`. Inputs are normalized values (no fetch I/O). Output is a structured
 * report of which check passes/fails plus soft warnings.
 */

import type {
  CopilotSeat,
  OrgBudget,
  UniversalUlb,
  UserBudget,
} from './api'

// --- Inputs ---

export interface ComputeBudgetConstraintsInput {
  orgBudget: OrgBudget | null
  universalUlb: UniversalUlb | null
  /** All Copilot seats — the universe of users we constrain. */
  seats: CopilotSeat[]
  /** User-scope ai_credits budgets. Keyed-by-login lookup is built internally. */
  userBudgets: UserBudget[]
}

// --- Outputs ---

/**
 * Result of the hard check. `ok=true` means the check passes.
 * `actual ≤ allowed` always when `ok=true`. When `ok=false`,
 * `overBy = actual - allowed`.
 */
export interface BudgetCheck {
  ok: boolean
  /** Σ effective ULBs across seats. */
  actual: number
  /** The org-budget envelope being checked against. */
  allowed: number
  /** How far over `allowed` we are. 0 when `ok=true`. */
  overBy: number
}

export type ConstraintMode = 'org-budget' | 'no-org-budget'

export interface BudgetWarning {
  /** Machine-readable code. */
  code:
    | 'prevent_further_usage_off'
    | 'unbounded_user_coverage'
  message: string
  /** Optional details (e.g. login). */
  context?: Record<string, unknown>
}

export interface BudgetConstraintsResult {
  mode: ConstraintMode
  /**
   * Σ effective ULBs ≤ org budget. `null` when there is no org budget
   * (mode === 'no-org-budget') — in that case the org has no top-level cap
   * and the only thing bounding spend is the universal/individual ULBs
   * themselves.
   */
  mainCheck: BudgetCheck | null
  warnings: BudgetWarning[]
  /**
   * The max universal ULB value that would keep the hard check passing,
   * holding everything else (individual ULBs, org budget) constant. May be
   * `Infinity` when no envelope binds, or `0` when even a universal ULB of
   * 0 fails.
   */
  maxSafeUniversalUlb: number
  /**
   * Convenience: count of seats that effectively draw from the universal
   * pool (i.e. don't have an individual ULB). Surfaces in the help page
   * and constraints banner.
   */
  universalSeatCount: number
}

// --- Helpers ---

function checkLe(actual: number, allowed: number): BudgetCheck {
  const ok = actual <= allowed
  return { ok, actual, allowed, overBy: ok ? 0 : actual - allowed }
}

// --- Main ---

export function computeBudgetConstraints(
  input: ComputeBudgetConstraintsInput,
): BudgetConstraintsResult {
  const { orgBudget, universalUlb, seats, userBudgets } = input

  const individualByLogin = new Map<string, UserBudget>()
  let individualTotal = 0
  for (const ub of userBudgets) {
    if (ub.user) {
      individualByLogin.set(ub.user.toLowerCase(), ub)
      individualTotal += ub.budgetAmount
    }
  }

  // Effective draw from the universal pool: number of seats that don't have
  // an individual ULB override.
  let universalSeatCount = 0
  for (const seat of seats) {
    if (!individualByLogin.has(seat.login.toLowerCase())) {
      universalSeatCount += 1
    }
  }
  const universalAmount = universalUlb?.budgetAmount ?? 0
  const universalTotal = universalAmount * universalSeatCount

  const ulbTotal = individualTotal + universalTotal

  const warnings: BudgetWarning[] = []
  if (orgBudget && !orgBudget.preventFurtherUsage) {
    warnings.push({
      code: 'prevent_further_usage_off',
      message:
        'The organization budget is configured as a soft cap (alerts only). Turn on “Prevent further usage” to enforce a hard ceiling.',
    })
  }
  if (!universalUlb && seats.length > 0) {
    // Without a universal ULB, anyone without an individual ULB is unbounded.
    const unboundedSeats = seats.filter(s => !individualByLogin.has(s.login.toLowerCase()))
    if (unboundedSeats.length > 0) {
      warnings.push({
        code: 'unbounded_user_coverage',
        message: `${unboundedSeats.length} Copilot seat${
          unboundedSeats.length === 1 ? ' has' : 's have'
        } no individual ULB and no universal ULB to fall back on.`,
        context: { unboundedSeatCount: unboundedSeats.length },
      })
    }
  }

  if (!orgBudget) {
    return {
      mode: 'no-org-budget',
      mainCheck: null,
      warnings,
      // With no org cap, any universal ULB is mathematically "safe"; surfacing
      // Infinity here lets callers fall back to a per-user heuristic.
      maxSafeUniversalUlb: Infinity,
      universalSeatCount,
    }
  }

  const mainCheck = checkLe(ulbTotal, orgBudget.budgetAmount)

  // maxSafeUniversalUlb = (orgBudget − individualTotal) / universalSeatCount
  // — held to >= 0. If everyone has an individual ULB, the universal value
  // doesn't affect the sum, so any value is safe (Infinity).
  let maxSafeUniversalUlb: number
  if (universalSeatCount === 0) {
    maxSafeUniversalUlb = Infinity
  } else {
    const remaining = orgBudget.budgetAmount - individualTotal
    maxSafeUniversalUlb = Math.max(0, remaining / universalSeatCount)
  }

  return {
    mode: 'org-budget',
    mainCheck,
    warnings,
    maxSafeUniversalUlb,
    universalSeatCount,
  }
}
