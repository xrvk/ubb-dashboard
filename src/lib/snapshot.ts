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

const STORAGE_KEY = 'ubb-dashboard:last-bulk-apply'
const SNAPSHOT_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

export type SnapshotSaveResult =
  | { ok: true }
  | { ok: false; reason: 'storage_unavailable' | 'quota_exceeded' | 'unknown'; error?: unknown }

function isQuotaError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
    // WebKit historically uses these numeric codes.
    if (e.code === 22 || e.code === 1014) return true
  }
  // Some environments throw a plain Error with the same name.
  return e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}

export function saveSnapshot(snapshot: BulkApplySnapshot): SnapshotSaveResult {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { ok: false, reason: 'storage_unavailable' }
  }
  // Attempt the real write directly. We previously did a probe (set/remove
  // of `__t__`) before this, but a full localStorage will throw on the
  // probe just as readily as on the real save, and the probe path
  // misclassifies the failure as `storage_unavailable` instead of
  // `quota_exceeded`. Trying the real save first lets us classify
  // accurately.
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    return { ok: true }
  } catch (e) {
    if (isQuotaError(e)) return { ok: false, reason: 'quota_exceeded', error: e }
    // SecurityError (private mode in some browsers), DOMException
    // disabled-storage, etc.
    return { ok: false, reason: 'storage_unavailable', error: e }
  }
}

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

export type SnapshotLoadResult =
  | { ok: true; snapshot: BulkApplySnapshot | null }
  | { ok: false; reason: 'corrupt' | 'wrong_enterprise' | 'expired'; error?: unknown }

export function loadSnapshot(enterprise: string): BulkApplySnapshot | null {
  const result = loadSnapshotDetailed(enterprise)
  return result.ok ? result.snapshot : null
}

/**
 * Like `loadSnapshot` but distinguishes "no snapshot" (ok with null) from
 * "snapshot present but unreadable" (corrupt/wrong-enterprise/expired). The
 * UI can use this to surface a toast when a rollback path was lost.
 */
export function loadSnapshotDetailed(enterprise: string): SnapshotLoadResult {
  if (!isStorageAvailable()) return { ok: true, snapshot: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch (e) {
    return { ok: false, reason: 'corrupt', error: e }
  }
  if (!raw) return { ok: true, snapshot: null }
  let parsed: BulkApplySnapshot
  try {
    parsed = JSON.parse(raw) as BulkApplySnapshot
  } catch (e) {
    return { ok: false, reason: 'corrupt', error: e }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'corrupt' }
  }
  if (parsed.enterprise !== enterprise) {
    return { ok: false, reason: 'wrong_enterprise' }
  }
  if (Date.now() - parsed.appliedAt > SNAPSHOT_TTL_MS) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, snapshot: parsed }
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
  if (typeof obj.id !== 'string' || !Number.isFinite(obj.appliedAt as number) || !Number.isFinite(obj.cycleEndsAt as number)) {
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
      !Number.isFinite(e.previousAmount as number) ||
      !Number.isFinite(e.newAmount as number)
    ) {
      return { ok: false, error: 'Snapshot entries are missing required fields.' }
    }
    entries.push({
      budgetId: e.budgetId,
      user: e.user,
      previousAmount: e.previousAmount as number,
      newAmount: e.newAmount as number,
    })
  }
  return {
    ok: true,
    snapshot: {
      id: obj.id,
      enterprise: obj.enterprise,
      appliedAt: obj.appliedAt as number,
      cycleEndsAt: obj.cycleEndsAt as number,
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
  a.download = `ubb-snapshot-${snap.enterprise}-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
