/**
 * Bounded-concurrency batch runner for GitHub Billing API mutations.
 *
 * Why this exists (see docs/api-limitations.md in the Copilot Budget Command
 * Center repo):
 *   - Classic PATs (the only auth supported here) get a primary 5,000
 *     requests/hour ceiling.
 *   - GitHub's secondary "abuse detection" rate limit fires *within* the
 *     primary limit when requests arrive in rapid succession.
 *   - Bulk individual-UBB updates at scale (hundreds-to-thousands of users)
 *     will trip the secondary limit if we Promise.all() the whole batch.
 *
 * Strategy:
 *   1. Concurrency cap (default 5 in flight) so we never blast the secondary
 *      limit.
 *   2. Small inter-request delay so steady-state stays below abuse detection.
 *   3. On 429, parse the `Retry-After` header (or fall back to 60s) and
 *      retry up to 2 times. Same shape as CCC's withRateLimitRetry.
 *   4. Cancellation via AbortSignal so the user can stop a long-running batch.
 *   5. Progress callback so the UI can show "X of N, M succeeded, K failed".
 */

import { ApiError } from '@/lib/api'

const PRIMARY_LIMIT_PER_HOUR = 5000

export interface BatchOptions {
  /** Max concurrent in-flight requests. Default 5. */
  concurrency?: number
  /** Delay between launching tasks within a worker, ms. Default 50. */
  perTaskDelayMs?: number
  /** Max retries per task on 429. Default 2. */
  maxRetriesOn429?: number
  /** Fallback wait when Retry-After is absent, ms. Default 60_000. */
  defaultRetryAfterMs?: number
  signal?: AbortSignal
  onProgress?: (state: BatchProgress) => void
}

export interface BatchProgress {
  total: number
  completed: number
  succeeded: number
  failed: number
  inFlight: number
  retrying: number
  startedAt: number
}

export interface BatchOutcome<T> {
  ok: boolean
  item: T
  error?: unknown
}

interface RetryableTask<T> {
  item: T
  attempts: number
}

class AbortedError extends Error {
  constructor() {
    super('Batch aborted')
    this.name = 'AbortedError'
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new AbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function parseRetryAfter(err: unknown, fallback: number): number {
  if (err instanceof ApiError) {
    // Body may contain JSON with documentation_url; the Retry-After header is
    // not currently surfaced through ApiError, so we look for it in the body
    // text. Safer fallback: configurable default (60s, matching CCC).
    const match = err.body.match(/retry[-_ ]after[^0-9]*([0-9]+)/i)
    if (match) {
      const n = Number(match[1])
      if (Number.isFinite(n)) return Math.max(1000, n * 1000)
    }
  }
  return fallback
}

export async function runBatch<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  opts: BatchOptions = {},
): Promise<BatchOutcome<T>[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 5)
  const perTaskDelayMs = Math.max(0, opts.perTaskDelayMs ?? 50)
  const maxRetriesOn429 = Math.max(0, opts.maxRetriesOn429 ?? 2)
  const defaultRetryAfterMs = Math.max(1000, opts.defaultRetryAfterMs ?? 60_000)

  const startedAt = Date.now()
  const state: BatchProgress = {
    total: items.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    retrying: 0,
    startedAt,
  }
  const results: BatchOutcome<T>[] = new Array(items.length)
  const emit = () => opts.onProgress?.({ ...state })

  emit()

  const queue: Array<{ task: RetryableTask<T>; index: number }> = items.map(
    (item, index) => ({ task: { item, attempts: 0 }, index }),
  )

  async function processOne(task: RetryableTask<T>, index: number) {
    try {
      state.inFlight += 1
      emit()
      await worker(task.item)
      results[index] = { ok: true, item: task.item }
      state.succeeded += 1
    } catch (err) {
      if (err instanceof AbortedError) {
        results[index] = { ok: false, item: task.item, error: err }
        state.failed += 1
        throw err
      }
      const is429 =
        err instanceof ApiError && err.status === 429
      if (is429 && task.attempts < maxRetriesOn429) {
        task.attempts += 1
        state.retrying += 1
        state.inFlight -= 1
        emit()
        const waitMs = parseRetryAfter(err, defaultRetryAfterMs)
        try {
          await sleep(waitMs, opts.signal)
        } finally {
          state.retrying -= 1
        }
        state.inFlight += 1
        emit()
        return processOne(task, index)
      }
      results[index] = { ok: false, item: task.item, error: err }
      state.failed += 1
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1)
      state.completed += 1
      emit()
    }
  }

  async function workerLoop() {
    while (queue.length > 0) {
      if (opts.signal?.aborted) throw new AbortedError()
      const next = queue.shift()
      if (!next) return
      try {
        await processOne(next.task, next.index)
      } catch (err) {
        if (err instanceof AbortedError) throw err
        // Other errors already recorded; keep going.
      }
      if (perTaskDelayMs > 0 && queue.length > 0) {
        try {
          await sleep(perTaskDelayMs, opts.signal)
        } catch (e) {
          if (e instanceof AbortedError) throw e
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => workerLoop()))
  } catch (err) {
    if (!(err instanceof AbortedError)) throw err
    // Mark any remaining queue entries as failed/aborted.
    for (const q of queue) {
      results[q.index] = { ok: false, item: q.task.item, error: err }
      state.failed += 1
      state.completed += 1
    }
    queue.length = 0
    emit()
  }

  return results
}

/**
 * Estimate how long a batch will take given the throttling rules above.
 * Returned value is in milliseconds.
 */
export function estimateBatchDurationMs(
  count: number,
  concurrency = 5,
  perTaskDelayMs = 50,
  avgRequestMs = 250,
): number {
  if (count <= 0) return 0
  const perWorkerCount = Math.ceil(count / concurrency)
  // Each worker does (avgRequestMs + delay) per task.
  return perWorkerCount * (avgRequestMs + perTaskDelayMs)
}

export { PRIMARY_LIMIT_PER_HOUR }
