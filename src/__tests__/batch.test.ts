import { describe, it, expect, vi, afterEach } from 'vitest'
import { runBatch } from '@/lib/batch'
import { ApiError } from '@/lib/api'

/**
 * Drive a runBatch promise to completion under fake timers. runBatch's
 * retry path calls setTimeout via its internal sleep() helper; under
 * fake timers those callbacks never fire on their own, so we tick the
 * clock until the batch resolves. The poll loop yields to the
 * microtask queue between ticks so awaited promises can settle.
 *
 * Used by the retry tests to keep them ~instant instead of paying the
 * production `Math.max(1000, defaultRetryAfterMs)` safety floor that
 * runBatch enforces on real timers.
 */
async function settleFakeTimerBatch<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  promise.finally(() => {
    settled = true
  })
  while (!settled) {
    await vi.advanceTimersByTimeAsync(1000)
  }
  return promise
}

describe('runBatch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })


  it('processes all items and reports success', async () => {
    const items = [1, 2, 3, 4, 5]
    const worker = vi.fn(async () => {})
    const results = await runBatch(items, worker, { concurrency: 2, perTaskDelayMs: 0 })
    expect(worker).toHaveBeenCalledTimes(5)
    expect(results.every(r => r.ok)).toBe(true)
  })

  it('respects concurrency cap', async () => {
    let inFlight = 0
    let peak = 0
    const worker = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight -= 1
    })
    await runBatch(Array.from({ length: 20 }, (_, i) => i), worker, {
      concurrency: 3,
      perTaskDelayMs: 0,
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('retries on 429 then succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new ApiError(429, '{"message":"slow down"}')
    })
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        defaultRetryAfterMs: 5,
      }),
    )
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetriesOn429', async () => {
    vi.useFakeTimers()
    const worker = vi.fn(async () => {
      throw new ApiError(429, 'rate limited')
    })
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        defaultRetryAfterMs: 1,
        maxRetriesOn429: 2,
      }),
    )
    expect(results[0].ok).toBe(false)
    expect(worker).toHaveBeenCalledTimes(3) // 1 attempt + 2 retries
  })

  it('records other errors without retrying', async () => {
    const worker = vi.fn(async () => {
      throw new ApiError(400, 'bad request')
    })
    const results = await runBatch([1, 2], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
    })
    expect(results.every(r => !r.ok)).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('aborts mid-batch when signal fires', async () => {
    const ac = new AbortController()
    let processed = 0
    const worker = vi.fn(async () => {
      processed += 1
      if (processed === 2) ac.abort()
      await new Promise(r => setTimeout(r, 5))
    })
    const results = await runBatch([1, 2, 3, 4, 5, 6, 7, 8], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
      signal: ac.signal,
    })
    const ok = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok).length
    expect(ok + failed).toBe(8)
    expect(failed).toBeGreaterThan(0)
  })

  it('emits progress callbacks', async () => {
    const states: number[] = []
    await runBatch([1, 2, 3], async () => {}, {
      concurrency: 1,
      perTaskDelayMs: 0,
      onProgress: s => states.push(s.completed),
    })
    expect(states[states.length - 1]).toBe(3)
  })

  it('counts each item exactly once in `completed` even after retries (regression)', async () => {
    // Regression: when processOne recursed on retry, the outer frame's
    // `finally` ran again and double-counted. Each item that retried once
    // ended up with `completed += 2`, so the progress UI showed values
    // greater than `total`.
    vi.useFakeTimers()
    let attempts = 0
    const worker = vi.fn(async () => {
      attempts += 1
      // First two attempts fail with 429, third succeeds.
      if (attempts <= 2) throw new ApiError(429, 'slow down')
    })
    const states: Array<{ completed: number; inFlight: number; succeeded: number }> = []
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        defaultRetryAfterMs: 1,
        maxRetriesOn429: 5,
        onProgress: s => states.push({ completed: s.completed, inFlight: s.inFlight, succeeded: s.succeeded }),
      }),
    )
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(3)
    const final = states[states.length - 1]
    expect(final.completed).toBe(1)
    expect(final.succeeded).toBe(1)
    expect(final.inFlight).toBe(0)
    // No intermediate progress event should report completed > total.
    expect(states.every(s => s.completed <= 1)).toBe(true)
    // And inFlight should never exceed concurrency.
    expect(states.every(s => s.inFlight <= 1)).toBe(true)
  })

  // --- Transient (5xx / network) retry path. The original suite only
  // covered 429; without these, a regression could silently turn 5xx
  // into a fatal-on-first-failure and skip backoff on network errors. ---

  it('retries on 5xx then succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new ApiError(503, 'down')
    })
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        transientBaseDelayMs: 50,
        transientMaxDelayMs: 100,
      }),
    )
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('retries on network errors then succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      // NetworkError sets status=0, kind='network' so it routes through
      // the transient retry path. Constructing via `new ApiError(0, ...)`
      // directly with kind: 'network' mimics that without dragging in the
      // NetworkError ctor's "Network error: <cause>" message prefix.
      if (calls === 1) throw new ApiError(0, '', { kind: 'network' })
    })
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        transientBaseDelayMs: 50,
        transientMaxDelayMs: 100,
      }),
    )
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('gives up on transient errors after maxRetriesOnTransient', async () => {
    vi.useFakeTimers()
    const worker = vi.fn(async () => {
      throw new ApiError(500, 'down')
    })
    const results = await settleFakeTimerBatch(
      runBatch([1], worker, {
        concurrency: 1,
        perTaskDelayMs: 0,
        transientBaseDelayMs: 50,
        transientMaxDelayMs: 100,
        maxRetriesOnTransient: 1,
      }),
    )
    expect(results[0].ok).toBe(false)
    expect(worker).toHaveBeenCalledTimes(2) // 1 attempt + 1 retry
  })

  it('honors Retry-After header on 429 with the 1000ms minimum floor', async () => {
    // parseRetryAfter enforces Math.max(1000, seconds * 1000): a small
    // retry-after must not collapse the wait below 1s. Without this
    // floor, runBatch can hammer 429 endpoints faster than they recover.
    vi.useFakeTimers()
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        throw new ApiError(429, 'slow', { headers: { 'retry-after': '0.2' } })
      }
    })
    // Drive timers manually so we can observe the wait window.
    const promise = runBatch([1], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
      defaultRetryAfterMs: 60_000,
    })
    // The Retry-After value is 0.2s but the floor is 1000ms — at 500ms
    // the retry must not have fired yet.
    await vi.advanceTimersByTimeAsync(500)
    expect(worker).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_500)
    const results = await promise
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('honors a large Retry-After header value verbatim', async () => {
    vi.useFakeTimers()
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        throw new ApiError(429, 'slow', { headers: { 'retry-after': '5' } })
      }
    })
    const promise = runBatch([1], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
      defaultRetryAfterMs: 60_000,
    })
    // At 4 seconds the retry must not have fired yet.
    await vi.advanceTimersByTimeAsync(4_000)
    expect(worker).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    const results = await promise
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })
})
