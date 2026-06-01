/**
 * Pool-allocation math shared between the Budget Planner and the Dashboard
 * donut. Without a single source these surfaces drift; the planner uses
 * `row.floor` (= Σ effective UBBs in the CC) while the donut needs the
 * same number framed as a "UBB ceiling" slice of the enterprise pool.
 */

import {
  buildCostCenterIndex,
  resolveCostCenter,
  type CopilotSeat,
  type CostCenter,
  type CostCenterBudget,
  type EnterpriseBudget,
  type UniversalUbb,
  type UserBudget,
} from './api'

export interface PoolSplitInput {
  enterpriseBudget: EnterpriseBudget | null
  universalUbb: UniversalUbb | null
  costCenters: CostCenter[]
  ccBudgetsByName: ReadonlyMap<string, CostCenterBudget>
  seats: CopilotSeat[]
  userBudgets: UserBudget[]
}

export interface CcSlice {
  costCenterId: string
  name: string
  /** Configured CC budget, or null if uncapped. */
  budgetAmount: number | null
  /** Σ effective UBBs of seats routed to this CC. The "UBB ceiling". */
  ubbCeiling: number
  seatCount: number
  /**
   * What this CC could realistically draw from the enterprise pool:
   *   - capped:   min(budget, ubbCeiling) — UBBs may bind below the budget
   *   - uncapped: ubbCeiling              — the only thing bounding it
   */
  effectiveDraw: number
}

export interface PoolSplit {
  enterpriseBudget: number | null
  /** Active CCs that actually route Copilot seats. Sorted by effectiveDraw desc. */
  costCenters: CcSlice[]
  /** Σ effectiveDraw of capped CCs. */
  cappedTotal: number
  /** Σ effectiveDraw of uncapped (but UBB-bounded) CCs. */
  uncappedTotal: number
  /** Σ effectiveDraw of seats not routed to any CC (consumed from ent pool directly). */
  unassignedTotal: number
  /** enterpriseBudget − (cappedTotal + uncappedTotal + unassignedTotal); 0 if negative or no budget. */
  headroom: number
  /** True when the sum of effective draws already exceeds the enterprise budget. */
  overAllocated: boolean
}

/**
 * Derive the enterprise-pool split: how much of the ent budget each CC is
 * committed to draw (capped by either its own budget or its UBB ceiling),
 * plus the un-assigned bucket and remaining headroom.
 */
export function computePoolSplit(input: PoolSplitInput): PoolSplit {
  const { enterpriseBudget, universalUbb, costCenters, ccBudgetsByName, seats, userBudgets } = input

  const individualByLogin = new Map<string, number>()
  for (const ub of userBudgets) {
    if (ub.user) individualByLogin.set(ub.user.toLowerCase(), ub.budgetAmount)
  }
  const universal = universalUbb?.budgetAmount ?? 0

  const index = buildCostCenterIndex(costCenters, ccBudgetsByName)

  const ubbByCcId = new Map<string, number>()
  const seatsByCcId = new Map<string, number>()
  let unassignedTotal = 0
  for (const seat of seats) {
    const login = seat.login.toLowerCase()
    const eff = individualByLogin.get(login) ?? universal
    const r = resolveCostCenter(seat.login, seat.orgLogin, index)
    if (!r) {
      unassignedTotal += eff
      continue
    }
    ubbByCcId.set(r.cc.id, (ubbByCcId.get(r.cc.id) ?? 0) + eff)
    seatsByCcId.set(r.cc.id, (seatsByCcId.get(r.cc.id) ?? 0) + 1)
  }

  const slices: CcSlice[] = []
  let cappedTotal = 0
  let uncappedTotal = 0
  for (const cc of costCenters) {
    const seatCount = seatsByCcId.get(cc.id) ?? 0
    if (seatCount === 0) continue // CC has no Copilot seats today; doesn't draw from pool
    const ubbCeiling = ubbByCcId.get(cc.id) ?? 0
    const budget = ccBudgetsByName.get(cc.name.toLowerCase())
    const budgetAmount = budget?.budgetAmount ?? null
    const effectiveDraw =
      budgetAmount === null ? ubbCeiling : Math.min(budgetAmount, ubbCeiling)
    if (budgetAmount === null) {
      uncappedTotal += effectiveDraw
    } else {
      cappedTotal += effectiveDraw
    }
    slices.push({
      costCenterId: cc.id,
      name: cc.name,
      budgetAmount,
      ubbCeiling,
      seatCount,
      effectiveDraw,
    })
  }
  slices.sort((a, b) => b.effectiveDraw - a.effectiveDraw)

  const entAmount = enterpriseBudget?.budgetAmount ?? null
  const committed = cappedTotal + uncappedTotal + unassignedTotal
  const headroom = entAmount === null ? 0 : Math.max(0, entAmount - committed)
  const overAllocated = entAmount !== null && committed > entAmount

  return {
    enterpriseBudget: entAmount,
    costCenters: slices,
    cappedTotal,
    uncappedTotal,
    unassignedTotal,
    headroom,
    overAllocated,
  }
}
