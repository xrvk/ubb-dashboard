/**
 * Bounded-concurrency batch runner for GitHub Billing API mutations.
 *
 * Why this exists (see docs/api-limitations.md in the Copilot Budget Command
 * Center repo):
 *   - Classic PATs (the only auth supported here) get a primary 5,000
 *     requests/hour ceiling.
 *   - GitHub's secondary "abuse detection" rate limit fires *within* the
 *     primary limit when requests arrive in rapid succession.
 *   - Bulk individual-ULB updates at scale (hundreds-to-thousands of users)
 *     will trip the secondary limit if we Promise.all() the whole batch.
 *   - Transient 5xx and network blips happen, especially around GitHub
 *     deploys. Failing the whole item over a single hiccup is wasteful.
 *
 * Strategy:
 *   1. Concurrency cap (default 5 in flight) so we never blast the secondary
 *      limit.
 *   2. Small inter-request delay so steady-state stays below abuse detection.
 *   3. On 429, read Retry-After from headers (preferred) or body (fallback)
 *      and retry up to 2 times.
 *   4. On 5xx and network errors, retry with bounded exponential backoff +
 *      jitter (smaller budget than 429 since these are usually faster to
 *      clear and we don't want to stall a 5k-item batch).
 *   5. Cancellation via AbortSignal so the user can stop a long-running batch.
 *   6. Progress callback so the UI can show "X of N, M succeeded, K failed".
 *   7. Per-item BatchOutcome so the caller can show which items failed and
 *      why, and offer "retry just the failures".
 */

import {
  ApiError,
  AbortedError,
  isAborted,
  retryAfterSecondsFromError,
} from '@/lib/errors'
import { isPrimaryRateLimitExhausted } from '@/lib/api'

const PRIMARY_LIMIT_PER_HOUR = 5000

export interface BatchOptions {
  /** Max concurrent in-flight requests. Default 5. */
  concurrency?: number
  /** Delay between launching tasks within a worker, ms. Default 50. */
  perTaskDelayMs?: number
  /** Max retries per task on 429. Default 2. */
  maxRetriesOn429?: number
  /** Max retries per task on 5xx / network. Default 2. */
  maxRetriesOnTransient?: number
  /** Fallback wait when Retry-After is absent, ms. Default 60_000. */
  defaultRetryAfterMs?: number
  /** Base backoff for 5xx / network retries, ms. Default 500. */
  transientBaseDelayMs?: number
  /** Cap for 5xx / network retries, ms. Default 4_000. */
  transientMaxDelayMs?: number
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
  /**
   * Set when the batch aborted because the caller's primary 5,000 req/hr
   * quota was exhausted (403 + x-ratelimit-remaining=0). `resetAt` is a
   * unix-epoch ms timestamp from `x-ratelimit-reset`.
   */
  rateLimitExhausted: { resetAt: number } | null
}

export interface BatchOutcome<T> {
  ok: boolean
  item: T
  error?: unknown
}

interface RetryableTask<T> {
  item: T
  attempts429: number
  attemptsTransient: number
}

/**
 * Thrown internally to break out of the worker loop when GitHub's primary
 * 5,000 req/hr ceiling has been exhausted. Continuing would just hammer
 * 403s for up to an hour, so we surface this to the caller as a distinct
 * stop condition with the reset timestamp.
 */
class PrimaryRateLimitExhaustedError extends Error {
  resetAt: number
  constructor(resetAt: number) {
    super('Primary rate limit exhausted')
    this.name = 'PrimaryRateLimitExhaustedError'
    this.resetAt = resetAt
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

function jitter(ms: number): number {
  return Math.round(Math.random() * Math.min(500, ms))
}

function parseRetryAfter(err: unknown, fallback: number): number {
  if (err instanceof ApiError) {
    const seconds = retryAfterSecondsFromError(err)
    if (seconds != null) return Math.max(1000, seconds * 1000)
  }
  return fallback
}

function classifyTransient(err: unknown): 'rate_limit' | 'transient' | 'fatal' | 'aborted' {
  if (isAborted(err)) return 'aborted'
  if (!(err instanceof ApiError)) return 'fatal'
  if (err.kind === 'rate_limit') return 'rate_limit'
  if (err.kind === 'server' || err.kind === 'network') return 'transient'
  return 'fatal'
}

export async function runBatch<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  opts: BatchOptions = {},
): Promise<BatchOutcome<T>[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 5)
  const perTaskDelayMs = Math.max(0, opts.perTaskDelayMs ?? 50)
  const maxRetriesOn429 = Math.max(0, opts.maxRetriesOn429 ?? 2)
  const maxRetriesOnTransient = Math.max(0, opts.maxRetriesOnTransient ?? 2)
  const defaultRetryAfterMs = Math.max(1000, opts.defaultRetryAfterMs ?? 60_000)
  const transientBaseDelayMs = Math.max(50, opts.transientBaseDelayMs ?? 500)
  const transientMaxDelayMs = Math.max(transientBaseDelayMs, opts.transientMaxDelayMs ?? 4_000)

  const startedAt = Date.now()
  const state: BatchProgress = {
    total: items.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    inFlight: 0,
    retrying: 0,
    startedAt,
    rateLimitExhausted: null,
  }
  const results: BatchOutcome<T>[] = new Array(items.length)
  const emit = () => opts.onProgress?.({ ...state })

  emit()

  const queue: Array<{ task: RetryableTask<T>; index: number }> = items.map(
    (item, index) => ({
      task: { item, attempts429: 0, attemptsTransient: 0 },
      index,
    }),
  )

  async function processOne(task: RetryableTask<T>, index: number) {
    state.inFlight += 1
    emit()
    try {
      // Iterative retry: a single `processOne` invocation handles all attempts
      // for one item, so the `finally` block runs exactly once per item.
      // Recursion here would double-count `completed` because each recursive
      // frame would run its own `finally`.
      while (true) {
        try {
          await worker(task.item)
          results[index] = { ok: true, item: task.item }
          state.succeeded += 1
          return
        } catch (err) {
          // Primary 5,000/hr ceiling exhausted: bail the whole batch. Don't
          // sleep for an hour, don't retry — let the caller decide whether to
          // wait for reset and resume.
          if (isPrimaryRateLimitExhausted(err)) {
            const resetHeader = err.headers['x-ratelimit-reset']
            const resetAt = resetHeader
              ? Math.round(Number(resetHeader) * 1000)
              : Date.now() + 60 * 60 * 1000
            results[index] = { ok: false, item: task.item, error: err }
            state.failed += 1
            throw new PrimaryRateLimitExhaustedError(resetAt)
          }
          const kind = classifyTransient(err)
          if (kind === 'aborted') {
            results[index] = { ok: false, item: task.item, error: err }
            state.failed += 1
            throw err
          }
          if (kind === 'rate_limit' && task.attempts429 < maxRetriesOn429) {
            task.attempts429 += 1
            state.retrying += 1
            state.inFlight -= 1
            emit()
            const waitMs = parseRetryAfter(err, defaultRetryAfterMs)
            try {
              await sleep(waitMs, opts.signal)
            } finally {
              state.retrying -= 1
              state.inFlight += 1
              emit()
            }
            continue
          }
          if (kind === 'transient' && task.attemptsTransient < maxRetriesOnTransient) {
            task.attemptsTransient += 1
            state.retrying += 1
            state.inFlight -= 1
            emit()
            const backoff = Math.min(
              transientMaxDelayMs,
              transientBaseDelayMs * 2 ** (task.attemptsTransient - 1),
            )
            const waitMs = backoff + jitter(backoff)
            try {
              await sleep(waitMs, opts.signal)
            } finally {
              state.retrying -= 1
              state.inFlight += 1
              emit()
            }
            continue
          }
          results[index] = { ok: false, item: task.item, error: err }
          state.failed += 1
          return
        }
      }
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
        if (isAborted(err)) throw err
        if (err instanceof PrimaryRateLimitExhaustedError) throw err
        // Other errors already recorded; keep going.
      }
      if (perTaskDelayMs > 0 && queue.length > 0) {
        try {
          await sleep(perTaskDelayMs, opts.signal)
        } catch (e) {
          if (isAborted(e)) throw e
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => workerLoop()))
  } catch (err) {
    if (!isAborted(err) && !(err instanceof PrimaryRateLimitExhaustedError)) {
      throw err
    }
    if (err instanceof PrimaryRateLimitExhaustedError) {
      state.rateLimitExhausted = { resetAt: err.resetAt }
    }
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
