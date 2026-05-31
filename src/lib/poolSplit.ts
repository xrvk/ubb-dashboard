/**
 * Pool-allocation math shared between the Budget Planner and the Dashboard
 * donut. Without a single source these surfaces drift; the planner uses
 * `row.floor` (= Σ effective ULBs in the CC) while the donut needs the
 * same number framed as a "ULB ceiling" slice of the enterprise pool.
 */

import {
  buildCostCenterIndex,
  resolveCostCenter,
  type CopilotSeat,
  type CostCenter,
  type CostCenterBudget,
  type EnterpriseBudget,
  type UniversalUlb,
  type UserBudget,
} from './api'

export interface PoolSplitInput {
  enterpriseBudget: EnterpriseBudget | null
  universalUlb: UniversalUlb | null
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
  /** Σ effective ULBs of seats routed to this CC. The "ULB ceiling". */
  ulbCeiling: number
  seatCount: number
  /**
   * What this CC could realistically draw from the enterprise pool:
   *   - capped:   min(budget, ulbCeiling) — ULBs may bind below the budget
   *   - uncapped: ulbCeiling              — the only thing bounding it
   */
  effectiveDraw: number
}

export interface PoolSplit {
  enterpriseBudget: number | null
  /** Active CCs that actually route Copilot seats. Sorted by effectiveDraw desc. */
  costCenters: CcSlice[]
  /** Σ effectiveDraw of capped CCs. */
  cappedTotal: number
  /** Σ effectiveDraw of uncapped (but ULB-bounded) CCs. */
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
 * committed to draw (capped by either its own budget or its ULB ceiling),
 * plus the un-assigned bucket and remaining headroom.
 */
export function computePoolSplit(input: PoolSplitInput): PoolSplit {
  const { enterpriseBudget, universalUlb, costCenters, ccBudgetsByName, seats, userBudgets } = input

  const individualByLogin = new Map<string, number>()
  for (const ub of userBudgets) {
    if (ub.user) individualByLogin.set(ub.user.toLowerCase(), ub.budgetAmount)
  }
  const universal = universalUlb?.budgetAmount ?? 0

  const index = buildCostCenterIndex(costCenters, ccBudgetsByName)

  const ulbByCcId = new Map<string, number>()
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
    ulbByCcId.set(r.cc.id, (ulbByCcId.get(r.cc.id) ?? 0) + eff)
    seatsByCcId.set(r.cc.id, (seatsByCcId.get(r.cc.id) ?? 0) + 1)
  }

  const slices: CcSlice[] = []
  let cappedTotal = 0
  let uncappedTotal = 0
  for (const cc of costCenters) {
    const seatCount = seatsByCcId.get(cc.id) ?? 0
    if (seatCount === 0) continue // CC has no Copilot seats today; doesn't draw from pool
    const ulbCeiling = ulbByCcId.get(cc.id) ?? 0
    const budget = ccBudgetsByName.get(cc.name.toLowerCase())
    const budgetAmount = budget?.budgetAmount ?? null
    const effectiveDraw =
      budgetAmount === null ? ulbCeiling : Math.min(budgetAmount, ulbCeiling)
    if (budgetAmount === null) {
      uncappedTotal += effectiveDraw
    } else {
      cappedTotal += effectiveDraw
    }
    slices.push({
      costCenterId: cc.id,
      name: cc.name,
      budgetAmount,
      ulbCeiling,
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
