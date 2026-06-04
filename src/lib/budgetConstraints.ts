/**
 * Pure constraint calculator that enforces the "golden rule": Σ effective per-user ULBs
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
  UniversalUlb,
  UserBudget,
} from './api'
import { resolveCostCenter } from './api'

// --- Inputs ---

export interface ComputeBudgetConstraintsInput {
  enterpriseBudget: EnterpriseBudget | null
  universalUlb: UniversalUlb | null
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
  /**
   * Dollar value of the shared AI-credit pool for this billing cycle. ULBs cap
   * gross pool draw per user, while CC and enterprise budgets only meter the
   * post-pool (net) spend. The engine subtracts each bucket's per-seat share
   * of this pool from its gross ULB sum before comparing to the bucket's net
   * envelope, so the two ledgers stay comparable. Defaults to 0 when the
   * caller doesn't know — that recovers the legacy gross-vs-net comparison.
   */
  poolDollars?: number
}

// --- Outputs ---

/**
 * Result of one of the three hard checks. `ok=true` means the check passes.
 * `actual ≤ allowed` always when `ok=true`. When `ok=false`, `overBy = actual - allowed`.
 *
 * For checks that compare ULB exposure (gross) to a net budget envelope
 * (`perCc`, `unassignedLeftover`), `actual` is the **post-pool** ULB sum:
 * `max(0, Σ effectiveUlb − bucketPoolShare)`. `grossUlbs` and `poolShare`
 * carry the unadjusted numbers so the UI can explain the math. For
 * `ccVsEnterprise` (budget-vs-budget) the pool fields are 0 and `actual`
 * already equals `grossUlbs`.
 */
export interface BudgetCheck {
  ok: boolean
  /** Post-pool ULB sum (or Σ CC budgets, for ccVsEnterprise). */
  actual: number
  /** The envelope being checked against. */
  allowed: number
  /** How far over `allowed` we are. 0 when `ok=true`. */
  overBy: number
  /** Σ effective ULBs before subtracting the bucket's pool share. */
  grossUlbs: number
  /** Bucket's per-seat share of the shared AI-credit pool. */
  poolShare: number
}

export interface PerCcCheck {
  costCenterId: string
  costCenterName: string
  memberCount: number
  /** Effective ULBs of all members of this CC (or members routed via org). */
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
    /** Per-cost-center-with-budget: Σ members' ULBs ≤ CC budget. */
    perCc: PerCcCheck[]
    /**
     * Umbrella mode only: Σ CC budgets ≤ enterprise budget. `null` in
     * independent mode (vacuous) or when there is no enterprise budget.
     */
    ccVsEnterprise: BudgetCheck | null
    /**
     * Leftover for users not in a budgeted CC:
     *   - umbrella: Σ ULBs ≤ ent − Σ CC budgets
     *   - independent: Σ ULBs ≤ ent
     * `null` when there is no enterprise budget.
     */
    unassignedLeftover: BudgetCheck | null
  }
  warnings: BudgetWarning[]
  /**
   * The max universal ULB value that would keep ALL hard checks passing,
   * holding everything else (individual ULBs, ent budget, CC budgets,
   * memberships) constant. Useful as a "Step 1" hint. May be `Infinity`
   * if no envelope binds, or `0` if even a universal ULB of 0 fails.
   */
  maxSafeUniversalUlb: number
}

// --- Helpers ---

function checkLe(actual: number, allowed: number): BudgetCheck {
  const ok = actual <= allowed
  return { ok, actual, allowed, overBy: ok ? 0 : actual - allowed, grossUlbs: actual, poolShare: 0 }
}

/**
 * Build a BudgetCheck for a bucket whose LHS is gross ULB exposure compared
 * against a net (post-pool) envelope. The pool share is subtracted from the
 * gross sum before comparison, but both raw numbers are echoed back so the UI
 * can render "$grossUlbs in caps − $poolShare from the pool = $actual against
 * a $allowed envelope".
 */
function checkLeNet(grossUlbs: number, poolShare: number, allowed: number): BudgetCheck {
  const actual = Math.max(0, grossUlbs - poolShare)
  const ok = actual <= allowed
  return {
    ok,
    actual,
    allowed,
    overBy: ok ? 0 : actual - allowed,
    grossUlbs,
    poolShare,
  }
}

function effectiveUlbFor(
  login: string,
  individualByLogin: ReadonlyMap<string, UserBudget>,
  universal: UniversalUlb | null,
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
    universalUlb,
    costCenters,
    costCenterIndex,
    ccBudgetsByName,
    seats,
    userBudgets,
    poolDollars = 0,
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

  // --- Per-seat: which CC (if any) and what is the effective ULB.
  // The seat universe is what we constrain. CC membership is derived via the
  // index; this respects the user > org priority documented in resolveCostCenter.
  interface SeatRouting {
    login: string
    effectiveUlb: number
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
      effectiveUlb: effectiveUlbFor(seat.login, individualByLogin, universalUlb),
      cc,
      isInBudgetedCc,
    }
  })

  // --- Pool attribution: every seat gets the same dollar share of the
  // shared AI-credit pool, regardless of plan. ULBs cap gross pool draw
  // but CC + enterprise budgets only meter post-pool spend, so each bucket
  // (per-CC member set, leftover) gets its seat-share offset before the
  // gross ULB sum is compared to the bucket's budget. `ccVsEnterprise` is
  // budget-vs-budget and stays pool-agnostic.
  const totalSeats = routings.length
  const poolPerSeat = totalSeats > 0 ? poolDollars / totalSeats : 0

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
    const grossUlbs = members.reduce((s, m) => s + m.effectiveUlb, 0)
    const ccPoolShare = poolPerSeat * members.length
    perCc.push({
      costCenterId: cc.id,
      costCenterName: cc.name,
      memberCount: members.length,
      check: checkLeNet(grossUlbs, ccPoolShare, budget.budgetAmount),
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
  const sumLeftoverUlbs = leftoverUsers.reduce((s, r) => s + r.effectiveUlb, 0)
  const leftoverPoolShare = poolPerSeat * leftoverUsers.length
  let unassignedLeftover: BudgetCheck | null = null
  if (enterpriseBudget) {
    const allowed =
      mode === 'umbrella'
        ? Math.max(0, enterpriseBudget.budgetAmount - sumCcBudgets)
        : enterpriseBudget.budgetAmount
    unassignedLeftover = checkLeNet(sumLeftoverUlbs, leftoverPoolShare, allowed)
  }

  // --- Warnings.

  // prevent_further_usage off on any ULB-bearing budget means the cap is informational.
  if (universalUlb && !universalUlb.preventFurtherUsage) {
    warnings.push({
      code: 'prevent_further_usage_off',
      message: 'Universal ULB has prevent_further_usage=false; users will not be hard-stopped at the cap.',
      context: { budgetId: universalUlb.id },
    })
  }
  for (const ub of userBudgets) {
    if (!ub.preventFurtherUsage) {
      warnings.push({
        code: 'prevent_further_usage_off',
        message: `User "${ub.user}" ULB has prevent_further_usage=false; they will not be hard-stopped at $${ub.budgetAmount}.`,
        context: { budgetId: ub.id, login: ub.user },
      })
    }
  }

  // Unbounded coverage: a user with no individual ULB, no universal ULB, no
  // enclosing budgeted CC, and no enterprise budget. They have no hard cap.
  if (!universalUlb || !enterpriseBudget) {
    for (const r of routings) {
      const hasIndividual = individualByLogin.has(r.login.toLowerCase())
      if (hasIndividual) continue
      if (universalUlb) continue
      if (r.isInBudgetedCc) continue
      if (enterpriseBudget) continue
      warnings.push({
        code: 'unbounded_user_coverage',
        message: `User "${r.login}" has no individual ULB, no universal ULB, no budgeted cost center, and no enterprise budget. Their Copilot AI Credit spend is unbounded.`,
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

  // --- maxSafeUniversalUlb derivation.
  // Find the largest universal value U such that all checks still pass when
  // every seat WITHOUT an individual ULB uses U as its effective ULB.
  // Closed-form per check; take the min over all binding ones.
  const seatsWithoutIndividual = (filter: (r: SeatRouting) => boolean): number =>
    routings.filter(filter).filter(r => !individualByLogin.has(r.login.toLowerCase())).length
  const sumIndividualWhere = (filter: (r: SeatRouting) => boolean): number =>
    routings
      .filter(filter)
      .filter(r => individualByLogin.has(r.login.toLowerCase()))
      .reduce((s, r) => s + r.effectiveUlb, 0)

  const caps: number[] = []
  // Per-CC binding: for each budgeted CC,
  //   max(0, sumIndividual(members) + n_universal_members * U − ccPoolShare) ≤ ccBudget
  // ⇒ U ≤ (ccBudget + ccPoolShare − sumIndividual) / n_universal_members
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
    const ccMembers = routings.filter(isMember).length
    const ccPoolShare = poolPerSeat * ccMembers
    caps.push(Math.max(0, (budget.budgetAmount + ccPoolShare - fixed) / n))
  }
  // Leftover binding: same shape with the "not in budgeted CC" filter. The
  // pool share is added to the allowance because the inequality is
  // `max(0, ΣULBs − leftoverPoolShare) ≤ allowed`, i.e.
  // `ΣULBs ≤ allowed + leftoverPoolShare`.
  if (unassignedLeftover) {
    const isLeftover = (r: SeatRouting) => !r.isInBudgetedCc
    const n = seatsWithoutIndividual(isLeftover)
    const fixed = sumIndividualWhere(isLeftover)
    if (n > 0) {
      caps.push(
        Math.max(0, (unassignedLeftover.allowed + unassignedLeftover.poolShare - fixed) / n),
      )
    }
  }
  // ccVsEnterprise does NOT depend on U — it's budget vs budget.
  const maxSafeUniversalUlb = caps.length === 0 ? Infinity : Math.min(...caps)

  return {
    mode,
    checks: { perCc, ccVsEnterprise, unassignedLeftover },
    warnings,
    maxSafeUniversalUlb,
  }
}

// --- Preview helper ---

/**
 * Recompute the constraint report as if a different universal ULB were in
 * effect. Used by the Universal-ULB planner to show admins, before they
 * apply, whether the proposed cap would breach the enterprise envelope or a
 * per-CC budget. Pure — same inputs always yield same outputs.
 *
 * `proposedBudgetAmount` is in dollars (the same unit as `UniversalUlb.budgetAmount`).
 * Forces `preventFurtherUsage=true` on the proposed ULB regardless of the
 * caller-supplied value because `patchUniversalULB` / `createUniversalULB`
 * both apply with that flag, so the preview should reflect the post-apply
 * state instead of carrying over a stale `prevent_further_usage_off` warning.
 */
export function previewConstraintsWithProposedUlb(
  input: ComputeBudgetConstraintsInput,
  proposedBudgetAmount: number,
): BudgetConstraintsResult {
  const base: UniversalUlb = input.universalUlb ?? {
    id: '__preview_universal_ulb__',
    budgetAmount: 0,
    consumedAmount: 0,
    preventFurtherUsage: true,
    willAlert: false,
    alertRecipients: [],
  }
  const proposed: UniversalUlb = {
    ...base,
    budgetAmount: proposedBudgetAmount,
    preventFurtherUsage: true,
  }
  return computeBudgetConstraints({ ...input, universalUlb: proposed })
}
