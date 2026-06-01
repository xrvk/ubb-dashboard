export interface FailingCheckAction {
  label: string
  onClick?: () => void
  href?: string
  icon?: 'scroll-up' | 'scroll-down' | 'external' | 'users' | 'universal'
  primary?: boolean
}

export interface FailingCheck {
  kind: 'cc-over' | 'cc-vs-ent' | 'leftover'
  message: string
  actions: FailingCheckAction[]
  /** Populated for `cc-over` items only; drives the top-N sort. */
  overBy?: number
  /** Populated for `cc-over` items only; tie-break for the top-N sort. */
  costCenterName?: string
}

/**
 * Max number of per-CC `cc-over` failures shown before the rest collapse
 * behind a "Show all N more" toggle. The two singleton checks
 * (`cc-vs-ent`, `leftover`) are always visible above this cap.
 */
export const CC_OVER_VISIBLE_CAP = 5

export interface SplitFailingChecks {
  /** `cc-vs-ent` and `leftover` checks. Always rendered. */
  singletons: FailingCheck[]
  /** Top `CC_OVER_VISIBLE_CAP` per-CC failures by `$` overshoot desc. */
  ccOverVisible: FailingCheck[]
  /** The remaining per-CC failures, sorted the same way. */
  ccOverHidden: FailingCheck[]
  /** Total count of per-CC failures (visible + hidden). */
  ccOverTotal: number
  /** Sum of `overBy` across all per-CC failures (for the summary line). */
  ccOverTotalOverBy: number
}

/**
 * Split a flat failing-checks list into rendering buckets. Pure / testable.
 * Sorts per-CC items by overshoot desc, then by CC name asc as a tie-break
 * so the visible top-N is deterministic.
 */
export function splitFailingChecks(arr: readonly FailingCheck[]): SplitFailingChecks {
  const singletons: FailingCheck[] = []
  const ccOverAll: FailingCheck[] = []
  for (const fc of arr) {
    if (fc.kind === 'cc-over') ccOverAll.push(fc)
    else singletons.push(fc)
  }
  ccOverAll.sort((a, b) => {
    const d = (b.overBy ?? 0) - (a.overBy ?? 0)
    if (d !== 0) return d
    return (a.costCenterName ?? '').localeCompare(b.costCenterName ?? '')
  })
  const ccOverVisible = ccOverAll.slice(0, CC_OVER_VISIBLE_CAP)
  const ccOverHidden = ccOverAll.slice(CC_OVER_VISIBLE_CAP)
  const ccOverTotalOverBy = ccOverAll.reduce((s, c) => s + (c.overBy ?? 0), 0)
  return {
    singletons,
    ccOverVisible,
    ccOverHidden,
    ccOverTotal: ccOverAll.length,
    ccOverTotalOverBy,
  }
}
