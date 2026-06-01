/**
 * In-memory ring buffer of recent errors and notable events. Powers the
 * "Copy error log" affordance so users can paste a structured bundle into
 * a bug report without us shipping a remote telemetry endpoint.
 *
 * Strictly in-memory — flushed on tab close. No PII beyond what the user
 * already typed (URLs, error messages); never the bearer token.
 */

export type DebugLevel = 'error' | 'warn' | 'info'

export interface DebugEntry {
  ts: number
  level: DebugLevel
  source: string
  message: string
  /** Optional structured context (status code, response body excerpt, etc.). */
  context?: Record<string, unknown>
}

const MAX_ENTRIES = 100
const buffer: DebugEntry[] = []
const listeners = new Set<(entries: readonly DebugEntry[]) => void>()

function emit(): void {
  if (listeners.size === 0) return
  const snapshot = [...buffer]
  for (const fn of listeners) fn(snapshot)
}

/** Append an entry. Rolls over at MAX_ENTRIES so memory stays bounded. */
export function logDebug(
  level: DebugLevel,
  source: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  buffer.push({ ts: Date.now(), level, source, message, context })
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  emit()
}

/** Snapshot of current entries (immutable copy). */
export function getDebugEntries(): readonly DebugEntry[] {
  return [...buffer]
}

/** Subscribe to new entries. Returns an unsubscribe fn. */
export function subscribeDebug(
  fn: (entries: readonly DebugEntry[]) => void,
): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function clearDebugEntries(): void {
  buffer.length = 0
  emit()
}

/**
 * Render the buffer as a paste-friendly multi-line string. Sensitive values
 * (tokens) are never logged in the first place, so this is safe to share.
 */
export function formatDebugBundle(entries: readonly DebugEntry[] = buffer): string {
  const lines: string[] = []
  lines.push(`# ULB dashboard error log`)
  lines.push(`# Generated at ${new Date().toISOString()}`)
  lines.push(`# User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`)
  lines.push(`# Entries: ${entries.length}`)
  lines.push('')
  for (const e of entries) {
    const stamp = new Date(e.ts).toISOString()
    lines.push(`[${stamp}] ${e.level.toUpperCase()} ${e.source}: ${e.message}`)
    if (e.context && Object.keys(e.context).length > 0) {
      try {
        lines.push(`    ${JSON.stringify(e.context)}`)
      } catch {
        lines.push(`    (context not serializable)`)
      }
    }
  }
  return lines.join('\n')
}

/** Internal: for tests. Reset module state. */
export function __resetDebugLog(): void {
  buffer.length = 0
  listeners.clear()
}
