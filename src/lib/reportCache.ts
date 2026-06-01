/**
 * localStorage cache for ingested usage-report aggregates.
 *
 * Key shape: `ubb:report:${enterprise}:${YYYY-MM}`. We only store the
 * aggregated per-user rows (not the raw CSV) so the payload stays small
 * even for big enterprises.
 */

import type { UserAicAggregate } from '@/lib/usageReport'

export type IngestSource = 'uploaded' | 'generated' | 'latest-from-api'

export interface CachedReport {
  enterprise: string
  monthKey: string
  reportId: string | null
  ingestedAt: number
  source: IngestSource
  rows: UserAicAggregate[]
}

const PREFIX = 'ubb:report:'

function key(enterprise: string, monthKey: string): string {
  return `${PREFIX}${enterprise}:${monthKey}`
}

export function loadCachedReport(enterprise: string, monthKey: string): CachedReport | null {
  try {
    const raw = localStorage.getItem(key(enterprise, monthKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedReport
    if (!Array.isArray(parsed.rows)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCachedReport(report: CachedReport): void {
  try {
    localStorage.setItem(key(report.enterprise, report.monthKey), JSON.stringify(report))
  } catch (e) {
    console.warn('[ubb-dashboard] Failed to cache report:', e)
  }
}

export function clearCachedReport(enterprise: string, monthKey: string): void {
  try {
    localStorage.removeItem(key(enterprise, monthKey))
  } catch {
    // ignore
  }
}

/**
 * Return all cached month keys for an enterprise, sorted ascending (e.g.
 * ["2025-03", "2025-04"]).
 */
export function listCachedMonths(enterprise: string): string[] {
  const prefix = `${PREFIX}${enterprise}:`
  const months: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(prefix)) continue
      months.push(k.slice(prefix.length))
    }
  } catch {
    return []
  }
  return months.sort()
}

/** Load every cached report for an enterprise, sorted by monthKey ascending. */
export function loadAllCachedReports(enterprise: string): CachedReport[] {
  return listCachedMonths(enterprise)
    .map(m => loadCachedReport(enterprise, m))
    .filter((r): r is CachedReport => r !== null)
}

/**
 * Per-user aggregate across multiple monthly aggregations: returns the MAX
 * single-month consumption per user. Used as the sizing input for the
 * universal UBB so that seasonal spikes drive the cap, not the average.
 */
export function aggregateMaxMonth(
  monthlyRows: UserAicAggregate[][],
): UserAicAggregate[] {
  const max = new Map<string, UserAicAggregate>()
  for (const month of monthlyRows) {
    for (const row of month) {
      const cur = max.get(row.username)
      if (!cur || row.aicConsumed > cur.aicConsumed) {
        max.set(row.username, { ...row })
      }
    }
  }
  return Array.from(max.values()).sort((a, b) => b.aicConsumed - a.aicConsumed)
}
