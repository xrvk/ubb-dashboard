import { describe, it, expect, vi } from 'vitest'
import { runBatch } from '@/lib/batch'
import { ApiError } from '@/lib/api'

describe('runBatch', () => {
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
    let calls = 0
    const worker = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new ApiError(429, '{"message":"slow down"}')
    })
    const results = await runBatch([1], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
      defaultRetryAfterMs: 5,
    })
    expect(results[0].ok).toBe(true)
    expect(worker).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetriesOn429', async () => {
    const worker = vi.fn(async () => {
      throw new ApiError(429, 'rate limited')
    })
    const results = await runBatch([1], worker, {
      concurrency: 1,
      perTaskDelayMs: 0,
      defaultRetryAfterMs: 1,
      maxRetriesOn429: 2,
    })
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
})
