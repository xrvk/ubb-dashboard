import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '@/lib/concurrency'

describe('mapWithConcurrency', () => {
  it('preserves input order in the results array', async () => {
    const input = [1, 2, 3, 4, 5]
    const results = await mapWithConcurrency(input, 2, async n => n * 2)
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('caps the number of in-flight promises at the given concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const mapper = async (n: number) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight -= 1
      return n
    }
    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, mapper)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('returns an empty array for empty input without invoking the mapper', async () => {
    let calls = 0
    const out = await mapWithConcurrency<number, number>([], 4, async n => {
      calls += 1
      return n
    })
    expect(out).toEqual([])
    expect(calls).toBe(0)
  })

  it('clamps concurrency below 1 to 1', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4], 0, async n => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight -= 1
      return n
    })
    expect(peak).toBe(1)
  })

  it('rejects on the first mapper rejection (Promise.all semantics)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})
