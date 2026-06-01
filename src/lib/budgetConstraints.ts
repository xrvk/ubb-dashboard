/**
 * Pure constraint calculator that enforces the "golden rule": Σ effective per-user UBBs
 * must remain the binding constraint, never the enterprise or cost-center envelope.
 *
 * See docs/budget-constraints.md for the model, vocabulary, and justification.
 *
 * This module is intentionally dependency-free apart from the data types in
 * `./api`. Inputs are normalized values (no fetch I/O). Output is a structured
 * report of which checks pass/fail plus soft warnings.
 */

import type {
  CostCenter,
  CostCenterBudget,
  CostCenterIndex,
  CopilotSeat,
  EnterpriseBudget,
  UniversalUbb,
  UserBudget,
} from './api'
import { resolveCostCenter } from './api'

// --- Inputs ---

export interface ComputeBudgetConstraintsInput {
  enterpriseBudget: EnterpriseBudget | null
  universalUbb: UniversalUbb | null
  /** Active cost centers in the enterprise. */
  costCenters: CostCenter[]
  /** Cost-center index built from the same `costCenters` and (ideally) ccBudgets. */
  costCenterIndex: CostCenterIndex
  /** Lowercased CC-name → CostCenterBudget map (from `fetchCostCenterBudgets`). */
  ccBudgetsByName: ReadonlyMap<string, CostCenterBudget>
  /** All Copilot seats — the universe of users we constrain. */
  seats: CopilotSeat[]
  /** User-scope ai_credits budgets. Keyed-by-login lookup is built internally. */
  userBudgets: UserBudget[]
}

// --- Outputs ---

/**
 * Result of one of the three hard checks. `ok=true` means the check passes.
 * `actual ≤ allowed` always when `ok=true`. When `ok=false`, `overBy = actual - allowed`.
 */
export interface BudgetCheck {
  ok: boolean
  /** Σ effective UBBs (or Σ CC budgets, for ccVsEnterprise). */
  actual: number
  /** The envelope being checked against. */
  allowed: number
  /** How far over `allowed` we are. 0 when `ok=true`. */
  overBy: number
}

export interface PerCcCheck {
  costCenterId: string
  costCenterName: string
  memberCount: number
  /** Effective UBBs of all members of this CC (or members routed via org). */
  check: BudgetCheck
  /** Member logins (lowercased) for diagnostics. */
  memberLogins: string[]
}

export type ConstraintMode = 'umbrella' | 'independent' | 'no-enterprise-budget'

export interface BudgetWarning {
  /** Machine-readable code. */
  code:
    | 'prevent_further_usage_off'
    | 'unbounded_user_coverage'
    | 'org_in_multi_budgeted_ccs'
    | 'cc_member_unresolved'
    | 'cc_budget_without_cc'
  message: string
  /** Optional details (e.g. login, CC name). */
  context?: Record<string, unknown>
}

export interface BudgetConstraintsResult {
  mode: ConstraintMode
  checks: {
    /** Per-cost-center-with-budget: Σ members' UBBs ≤ CC budget. */
    perCc: PerCcCheck[]
    /**
     * Umbrella mode only: Σ CC budgets ≤ enterprise budget. `null` in
     * independent mode (vacuous) or when there is no enterprise budget.
     */
    ccVsEnterprise: BudgetCheck | null
    /**
     * Leftover for users not in a budgeted CC:
     *   - umbrella: Σ UBBs ≤ ent − Σ CC budgets
     *   - independent: Σ UBBs ≤ ent
     * `null` when there is no enterprise budget.
     */
    unassignedLeftover: BudgetCheck | null
  }
  warnings: BudgetWarning[]
  /**
   * The max universal UBB value that would keep ALL hard checks passing,
   * holding everything else (individual UBBs, ent budget, CC budgets,
   * memberships) constant. Useful as a "Step 1" hint. May be `Infinity`
   * if no envelope binds, or `0` if even a universal UBB of 0 fails.
   */
  maxSafeUniversalUbb: number
}

// --- Helpers ---

function checkLe(actual: number, allowed: number): BudgetCheck {
  const ok = actual <= allowed
  return { ok, actual, allowed, overBy: ok ? 0 : actual - allowed }
}

function effectiveUbbFor(
  login: string,
  individualByLogin: ReadonlyMap<string, UserBudget>,
  universal: UniversalUbb | null,
): number {
  const ind = individualByLogin.get(login.toLowerCase())
  if (ind) return ind.budgetAmount
  return universal?.budgetAmount ?? 0
}

function lower(s: string): string {
  return s.toLowerCase()
}

// --- Main ---

/**
 * Compute the full constraint report. Pure — same inputs always yield same outputs.
 */
export function computeBudgetConstraints(
  input: ComputeBudgetConstraintsInput,
): BudgetConstraintsResult {
  const {
    enterpriseBudget,
    universalUbb,
    costCenters,
    costCenterIndex,
    ccBudgetsByName,
    seats,
    userBudgets,
  } = input

  const warnings: BudgetWarning[] = []
  const mode: ConstraintMode = enterpriseBudget
    ? enterpriseBudget.excludeCostCenterUsage
      ? 'independent'
      : 'umbrella'
    : 'no-enterprise-budget'

  // --- Index user budgets by lowercased login.
  const individualByLogin = new Map<string, UserBudget>()
  for (const ub of userBudgets) {
    individualByLogin.set(ub.user.toLowerCase(), ub)
  }

  // --- Per-seat: which CC (if any) and what is the effective UBB.
  // The seat universe is what we constrain. CC membership is derived via the
  // index; this respects the user > org priority documented in resolveCostCenter.
  interface SeatRouting {
    login: string
    effectiveUbb: number
    /** CC the user resolves to, or null if unassigned. */
    cc: CostCenter | null
    /** True if the resolved CC has its own ai_credits budget. */
    isInBudgetedCc: boolean
  }
  const ccByName = new Map<string, CostCenter>()
  for (const cc of costCenters) ccByName.set(lower(cc.name), cc)

  const routings: SeatRouting[] = seats.map(seat => {
    const resolution = resolveCostCenter(seat.login, seat.orgLogin, costCenterIndex)
    const cc = resolution?.cc ?? null
    const isInBudgetedCc = cc ? ccBudgetsByName.has(lower(cc.name)) : false
    return {
      login: seat.login,
      effectiveUbb: effectiveUbbFor(seat.login, individualByLogin, universalUbb),
      cc,
      isInBudgetedCc,
    }
  })

  // --- B: per-CC check.
  const ccIdToMembers = new Map<string, SeatRouting[]>()
  for (const r of routings) {
    if (!r.isInBudgetedCc || !r.cc) continue
    const arr = ccIdToMembers.get(r.cc.id) ?? []
    arr.push(r)
    ccIdToMembers.set(r.cc.id, arr)
  }
  const perCc: PerCcCheck[] = []
  for (const cc of costCenters) {
    const budget = ccBudgetsByName.get(lower(cc.name))
    if (!budget) continue
    const members = ccIdToMembers.get(cc.id) ?? []
    const actual = members.reduce((s, m) => s + m.effectiveUbb, 0)
    perCc.push({
      costCenterId: cc.id,
      costCenterName: cc.name,
      memberCount: members.length,
      check: checkLe(actual, budget.budgetAmount),
      memberLogins: members.map(m => m.login),
    })
  }

  // Warn: any CC budget that targets a name we couldn't find among active CCs.
  for (const [nameKey, budget] of ccBudgetsByName.entries()) {
    if (!ccByName.has(nameKey)) {
      warnings.push({
        code: 'cc_budget_without_cc',
        message: `Cost-center budget targets "${budget.costCenterName}" but no active cost center with that name exists. The budget will be ignored.`,
        context: { budgetId: budget.id, costCenterName: budget.costCenterName },
      })
    }
  }

  // --- C: ccVsEnterprise (umbrella only).
  const sumCcBudgets = [...ccBudgetsByName.values()].reduce((s, b) => s + b.budgetAmount, 0)
  let ccVsEnterprise: BudgetCheck | null = null
  if (enterpriseBudget && mode === 'umbrella') {
    ccVsEnterprise = checkLe(sumCcBudgets, enterpriseBudget.budgetAmount)
  }

  // --- D: leftover for users not in a budgeted CC.
  const leftoverUsers = routings.filter(r => !r.isInBudgetedCc)
  const sumLeftoverUbbs = leftoverUsers.reduce((s, r) => s + r.effectiveUbb, 0)
  let unassignedLeftover: BudgetCheck | null = null
  if (enterpriseBudget) {
    const allowed =
      mode === 'umbrella'
        ? Math.max(0, enterpriseBudget.budgetAmount - sumCcBudgets)
        : enterpriseBudget.budgetAmount
    unassignedLeftover = checkLe(sumLeftoverUbbs, allowed)
  }

  // --- Warnings.

  // prevent_further_usage off on any UBB-bearing budget means the cap is informational.
  if (universalUbb && !universalUbb.preventFurtherUsage) {
    warnings.push({
      code: 'prevent_further_usage_off',
      message: 'Universal UBB has prevent_further_usage=false; users will not be hard-stopped at the cap.',
      context: { budgetId: universalUbb.id },
    })
  }
  for (const ub of userBudgets) {
    if (!ub.preventFurtherUsage) {
      warnings.push({
        code: 'prevent_further_usage_off',
        message: `User "${ub.user}" UBB has prevent_further_usage=false; they will not be hard-stopped at $${ub.budgetAmount}.`,
        context: { budgetId: ub.id, login: ub.user },
      })
    }
  }

  // Unbounded coverage: a user with no individual UBB, no universal UBB, no
  // enclosing budgeted CC, and no enterprise budget. They have no hard cap.
  if (!universalUbb || !enterpriseBudget) {
    for (const r of routings) {
      const hasIndividual = individualByLogin.has(r.login.toLowerCase())
      if (hasIndividual) continue
      if (universalUbb) continue
      if (r.isInBudgetedCc) continue
      if (enterpriseBudget) continue
      warnings.push({
        code: 'unbounded_user_coverage',
        message: `User "${r.login}" has no individual UBB, no universal UBB, no budgeted cost center, and no enterprise budget. Their Copilot AI Credit spend is unbounded.`,
        context: { login: r.login },
      })
    }
  }

  // Org-in-multi-budgeted-CCs (forwarded from the index).
  for (const c of costCenterIndex.orgBudgetedCollisions) {
    warnings.push({
      code: 'org_in_multi_budgeted_ccs',
      message: `Org "${c.org}" is in multiple ai-credits-budgeted cost centers (${c.costCenterNames.join(', ')}). Routing is first-wins by CC id.`,
      context: { org: c.org, costCenterNames: c.costCenterNames },
    })
  }

  // --- maxSafeUniversalUbb derivation.
  // Find the largest universal value U such that all checks still pass when
  // every seat WITHOUT an individual UBB uses U as its effective UBB.
  // Closed-form per check; take the min over all binding ones.
  const seatsWithoutIndividual = (filter: (r: SeatRouting) => boolean): number =>
    routings.filter(filter).filter(r => !individualByLogin.has(r.login.toLowerCase())).length
  const sumIndividualWhere = (filter: (r: SeatRouting) => boolean): number =>
    routings
      .filter(filter)
      .filter(r => individualByLogin.has(r.login.toLowerCase()))
      .reduce((s, r) => s + r.effectiveUbb, 0)

  const caps: number[] = []
  // Per-CC binding: for each budgeted CC,
  // sumIndividual(members) + n_universal_members * U ≤ ccBudget
  for (const cc of costCenters) {
    const budget = ccBudgetsByName.get(lower(cc.name))
    if (!budget) continue
    const isMember = (r: SeatRouting) => r.cc?.id === cc.id && r.isInBudgetedCc
    const n = seatsWithoutIndividual(isMember)
    const fixed = sumIndividualWhere(isMember)
    if (n === 0) {
      // No universal-reliant members; this CC doesn't constrain U. Skip.
      continue
    }
    caps.push(Math.max(0, (budget.budgetAmount - fixed) / n))
  }
  // Leftover binding: same shape with the "not in budgeted CC" filter.
  if (unassignedLeftover) {
    const isLeftover = (r: SeatRouting) => !r.isInBudgetedCc
    const n = seatsWithoutIndividual(isLeftover)
    const fixed = sumIndividualWhere(isLeftover)
    if (n > 0) {
      caps.push(Math.max(0, (unassignedLeftover.allowed - fixed) / n))
    }
  }
  // ccVsEnterprise does NOT depend on U — it's budget vs budget.
  const maxSafeUniversalUbb = caps.length === 0 ? Infinity : Math.min(...caps)

  return {
    mode,
    checks: { perCc, ccVsEnterprise, unassignedLeftover },
    warnings,
    maxSafeUniversalUbb,
  }
}
