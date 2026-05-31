/**
 * localStorage cache for ingested usage-report aggregates.
 *
 * Key shape: `ulb:report:${enterprise}:${YYYY-MM}`. We only store the
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

const PREFIX = 'ulb:report:'

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
    // localStorage quota errors are non-fatal; just warn so the user knows
    // the dashboard won't remember this ingestion across reloads.
    console.warn('[ind-ulb-dashboard] Failed to cache report:', e)
  }
}

export function clearCachedReport(enterprise: string, monthKey: string): void {
  try {
    localStorage.removeItem(key(enterprise, monthKey))
  } catch {
    // ignore
  }
}
