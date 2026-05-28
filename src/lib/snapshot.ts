/**
 * Cycle-aware snapshot of a bulk Unblock-for-Month apply.
 *
 * Persisted to localStorage so admins can revert a mid-cycle cap bump after
 * the billing cycle resets (the cap field persists across cycle boundaries
 * even though consumed_amount zeroes out, see CCC's billing-cycle-management
 * doc). Strictly best-effort: localStorage is per-browser, not synced.
 */

export interface BulkApplySnapshot {
  id: string
  /** Enterprise slug, so a snapshot from one tenant cannot be restored to another. */
  enterprise: string
  appliedAt: number
  cycleEndsAt: number
  entries: Array<{
    budgetId: string
    user: string
    previousAmount: number
    newAmount: number
  }>
}

const STORAGE_KEY = 'ind-ulb-dashboard:last-bulk-apply'
const SNAPSHOT_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

function isStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const t = '__t__'
    window.localStorage.setItem(t, t)
    window.localStorage.removeItem(t)
    return true
  } catch {
    return false
  }
}

export function saveSnapshot(snapshot: BulkApplySnapshot): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Quota exceeded or other write error: ignore, snapshot is best-effort.
  }
}

export function loadSnapshot(enterprise: string): BulkApplySnapshot | null {
  if (!isStorageAvailable()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BulkApplySnapshot
    if (!parsed || parsed.enterprise !== enterprise) return null
    if (Date.now() - parsed.appliedAt > SNAPSHOT_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearSnapshot(): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function endOfMonth(now: Date = new Date()): Date {
  // Billing cycles align to the calendar month for CB and CE seats. (GHEC
  // seat billing may follow a different anchor; CCC documents this caveat.)
  return new Date(now.getFullYear(), now.getMonth() + 1, 1)
}

export function daysUntilCycleReset(now: Date = new Date()): number {
  const ms = endOfMonth(now).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}
