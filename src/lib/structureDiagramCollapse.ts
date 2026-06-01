/**
 * Pure helpers for collapsing a long list of cost-center segments
 * (used by `BudgetStructureDiagram`) into a top-N + "Other" bucket
 * so the bar stays readable past ~10 cost centers.
 */

export interface DiagramSegment {
  id: string
  name: string
  budget: number
  preventFurtherUsage: boolean
  uncapped: boolean
  seatCount: number
  affectsCopilot: boolean
}

export interface OtherSegment extends DiagramSegment {
  /** Sentinel discriminator — true only on the synthesized bucket. */
  isOther: true
  /** Number of source segments folded into this bucket. */
  hiddenCount: number
  /** How many of the hidden segments were uncapped (no `$` cap set). */
  hiddenUncappedCount: number
}

export type MaybeOtherSegment = DiagramSegment | OtherSegment

/** Sentinel `id` used for the synthesized "Other" segment. */
export const OTHER_SEGMENT_ID = '__other__'

/** Max distinct CC segments rendered before the rest collapse into `Other`. */
export const STRUCTURE_DIAGRAM_TOPN = 8

export function isOtherSegment(s: MaybeOtherSegment): s is OtherSegment {
  return (s as OtherSegment).isOther === true
}

/**
 * Collapse `segs` to at most `maxVisible` entries plus an "Other" bucket
 * holding the rest. Ordering: uncapped segments first (they're a risk
 * signal and should stay visible), then capped segments by budget desc,
 * with name asc as the deterministic tie-break.
 *
 * If `segs.length <= maxVisible` the input is returned unchanged (just
 * re-sorted). Otherwise exactly `maxVisible - 1` top items are kept and
 * the rest fold into a single `OtherSegment` appended at the end.
 *
 * The Other bucket's `budget` and `seatCount` are the sums of the hidden
 * segments. `uncapped` is forced to `false` so the existing proportional
 * width math (`budget / totalCappedBudget`) treats it like a normal slice.
 */
export function collapseToTopN(
  segs: readonly DiagramSegment[],
  maxVisible: number = STRUCTURE_DIAGRAM_TOPN,
): MaybeOtherSegment[] {
  const sorted = [...segs].sort((a, b) => {
    if (a.uncapped !== b.uncapped) return a.uncapped ? -1 : 1
    if (b.budget !== a.budget) return b.budget - a.budget
    return a.name.localeCompare(b.name)
  })
  if (sorted.length <= maxVisible) return sorted

  const keepCount = Math.max(1, maxVisible - 1)
  const kept = sorted.slice(0, keepCount)
  const hidden = sorted.slice(keepCount)
  const otherBudget = hidden.reduce((s, x) => s + x.budget, 0)
  const otherSeats = hidden.reduce((s, x) => s + x.seatCount, 0)
  const hiddenUncappedCount = hidden.filter(x => x.uncapped).length

  const other: OtherSegment = {
    id: OTHER_SEGMENT_ID,
    name: `Other (${hidden.length} CCs)`,
    budget: otherBudget,
    preventFurtherUsage: false,
    uncapped: false,
    seatCount: otherSeats,
    affectsCopilot: hidden.some(x => x.affectsCopilot),
    isOther: true,
    hiddenCount: hidden.length,
    hiddenUncappedCount,
  }
  return [...kept, other]
}
