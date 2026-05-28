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

// --- JSON export / import for off-browser recovery ---

const SCHEMA_VERSION = 1

export interface SerializedSnapshot extends BulkApplySnapshot {
  schemaVersion: number
}

export function serializeSnapshot(snap: BulkApplySnapshot): string {
  const payload: SerializedSnapshot = { schemaVersion: SCHEMA_VERSION, ...snap }
  return JSON.stringify(payload, null, 2)
}

export interface ParsedSnapshot {
  ok: true
  snapshot: BulkApplySnapshot
}
export interface ParseError {
  ok: false
  error: string
}

/**
 * Parse and validate a snapshot JSON blob. Returns either { ok: true, snapshot }
 * or { ok: false, error } with a human-readable reason.
 */
export function parseSnapshot(input: string, expectedEnterprise?: string): ParsedSnapshot | ParseError {
  let data: unknown
  try {
    data = JSON.parse(input)
  } catch {
    return { ok: false, error: 'Not valid JSON.' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Snapshot must be a JSON object.' }
  }
  const obj = data as Record<string, unknown>
  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported snapshot schema version ${obj.schemaVersion}.` }
  }
  if (typeof obj.enterprise !== 'string' || !obj.enterprise) {
    return { ok: false, error: 'Snapshot is missing `enterprise`.' }
  }
  if (expectedEnterprise && obj.enterprise !== expectedEnterprise) {
    return {
      ok: false,
      error: `Snapshot was taken from enterprise '${obj.enterprise}', but you are connected to '${expectedEnterprise}'.`,
    }
  }
  if (typeof obj.id !== 'string' || typeof obj.appliedAt !== 'number' || typeof obj.cycleEndsAt !== 'number') {
    return { ok: false, error: 'Snapshot is missing required fields.' }
  }
  if (!Array.isArray(obj.entries) || obj.entries.length === 0) {
    return { ok: false, error: 'Snapshot has no entries.' }
  }
  const entries: BulkApplySnapshot['entries'] = []
  for (const raw of obj.entries) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Snapshot entries must be objects.' }
    const e = raw as Record<string, unknown>
    if (
      typeof e.budgetId !== 'string' ||
      typeof e.user !== 'string' ||
      typeof e.previousAmount !== 'number' ||
      typeof e.newAmount !== 'number'
    ) {
      return { ok: false, error: 'Snapshot entries are missing required fields.' }
    }
    entries.push({
      budgetId: e.budgetId,
      user: e.user,
      previousAmount: e.previousAmount,
      newAmount: e.newAmount,
    })
  }
  return {
    ok: true,
    snapshot: {
      id: obj.id,
      enterprise: obj.enterprise,
      appliedAt: obj.appliedAt,
      cycleEndsAt: obj.cycleEndsAt,
      entries,
    },
  }
}

/** Trigger a browser download of the serialized snapshot. */
export function downloadSnapshot(snap: BulkApplySnapshot): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([serializeSnapshot(snap)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date(snap.appliedAt)
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
  a.href = url
  a.download = `ind-ulb-snapshot-${snap.enterprise}-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
