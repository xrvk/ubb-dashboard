/**
 * Pool-allocation math shared between the Dashboard donut and the planner
 * surfaces. In the org variant the model collapses to three slices of the
 * org budget:
 *
 *   org budget
 *     ├─ Σ individual ULBs   (sum of every UserBudget.budgetAmount)
 *     ├─ universal ULB pool  (universalUlb.budgetAmount × N seats without
 *     │                        an individual override; capped at the
 *     │                        remaining org budget so we don't lie about
 *     │                        having more than the cap allows)
 *     └─ headroom             (whatever's left, or 0 if over-allocated)
 *
 * Without cost centers there is no per-CC bucket — the only fan-out is
 * by individual ULB. Compared to the GHEC variant this is dramatically
 * simpler and a single source of truth for both the dashboard donut and
 * any future planner re-build.
 */

import type {
  CopilotSeat,
  OrgBudget,
  UniversalUlb,
  UserBudget,
} from './api'

export interface PoolSplitInput {
  orgBudget: OrgBudget | null
  universalUlb: UniversalUlb | null
  seats: CopilotSeat[]
  userBudgets: UserBudget[]
}

export interface PoolSplit {
  /** The org budget cap, or null if no org budget is configured. */
  orgBudget: number | null
  /** Σ individual ULB amounts. */
  individualUlbTotal: number
  /** Effective universal ULB draw: universal × (seats without an individual ULB). */
  universalUlbDraw: number
  /** orgBudget − (individualUlbTotal + universalUlbDraw); 0 if negative or no budget. */
  headroom: number
  /** True when the sum of effective draws exceeds the org budget. */
  overAllocated: boolean
}

/**
 * Derive the org-pool split: how much of the org budget the individual ULBs
 * and the universal ULB pool are committed to draw, plus any remaining
 * headroom.
 *
 * Seats with an individual ULB are subtracted from the universal pool. If
 * a user has both a seat AND no individual ULB they're counted under the
 * universal pool at `universalUlb.budgetAmount` each.
 */
export function computePoolSplit(input: PoolSplitInput): PoolSplit {
  const { orgBudget, universalUlb, seats, userBudgets } = input

  let individualUlbTotal = 0
  const individualLogins = new Set<string>()
  for (const ub of userBudgets) {
    individualUlbTotal += ub.budgetAmount
    if (ub.user) individualLogins.add(ub.user.toLowerCase())
  }

  const universal = universalUlb?.budgetAmount ?? 0
  let universalSeatCount = 0
  if (universal > 0) {
    for (const seat of seats) {
      if (!individualLogins.has(seat.login.toLowerCase())) {
        universalSeatCount += 1
      }
    }
  }
  const universalUlbDraw = universal * universalSeatCount

  const orgAmount = orgBudget?.budgetAmount ?? null
  const committed = individualUlbTotal + universalUlbDraw
  const headroom = orgAmount === null ? 0 : Math.max(0, orgAmount - committed)
  const overAllocated = orgAmount !== null && committed > orgAmount

  return {
    orgBudget: orgAmount,
    individualUlbTotal,
    universalUlbDraw,
    headroom,
    overAllocated,
  }
}
