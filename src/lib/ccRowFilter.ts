/**
 * Pure helpers shared by the two large cost-center lists — Dashboard's
 * `CostCenterStatusCard` table and Planner's CC editor list. The lists
 * have different row shapes, so the helpers are generic over an
 * accessor function that pulls the sortable/searchable value out.
 *
 * Kept deliberately tiny — no chip predicates, no React — so they're
 * trivially unit-testable and have no rendering cost.
 */

export interface CcSortOption<T> {
  /** Stable id used in `<select>` value and the toolbar callback. */
  id: string
  /** Human-readable label rendered in the dropdown. */
  label: string
  /**
   * Comparator passed to `Array.prototype.sort`. Returning 0 falls
   * through to the secondary name-asc comparator inside `applyCcSort`.
   */
  cmp: (a: T, b: T) => number
}

/** Case-insensitive substring match. Empty query matches everything. */
export function matchesNameQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

/**
 * Filter rows by a free-text query against a name accessor.
 *
 * Returns the input reference unchanged when the query is empty so
 * downstream `useMemo` deps stay stable.
 */
export function applyCcQuery<T>(
  rows: readonly T[],
  query: string,
  nameOf: (r: T) => string,
): readonly T[] {
  if (!query.trim()) return rows
  return rows.filter(r => matchesNameQuery(nameOf(r), query))
}

/**
 * Sort rows by the chosen comparator, with a name-asc secondary key
 * so equal-value rows are stable and human-friendly. Always returns a
 * fresh array (never mutates input) so callers can pass it straight to
 * React without losing referential stability of the source.
 */
export function applyCcSort<T>(
  rows: readonly T[],
  sortId: string,
  options: readonly CcSortOption<T>[],
  nameOf: (r: T) => string,
): T[] {
  const opt = options.find(o => o.id === sortId) ?? options[0]
  if (!opt) return [...rows]
  return [...rows].sort((a, b) => {
    const primary = opt.cmp(a, b)
    if (primary !== 0) return primary
    return nameOf(a).localeCompare(nameOf(b))
  })
}

/**
 * Compose `applyCcQuery` and `applyCcSort` in a single pass for the
 * common toolbar wiring case.
 */
export function filterAndSortCcRows<T>(
  rows: readonly T[],
  query: string,
  sortId: string,
  options: readonly CcSortOption<T>[],
  nameOf: (r: T) => string,
): T[] {
  const filtered = applyCcQuery(rows, query, nameOf)
  return applyCcSort(filtered, sortId, options, nameOf)
}

/**
 * Utilization (`projected / budget`) as a 0..n number; returns null when
 * there's no budget (uncapped CC). Used for the Dashboard "utilization
 * desc" sort. Uncapped rows go to the end of the sort by mapping to
 * `-Infinity`.
 */
export function ccUtilization(budget: number | null, projected: number): number | null {
  if (budget === null || budget <= 0) return null
  return projected / budget
}
