import { describe, expect, it } from 'vitest'
import { ccHealthStatus, countByHealth, type CcHealth } from '@/lib/ccStatus'

describe('ccHealthStatus', () => {
  it('returns "uncapped" when there is no budget', () => {
    expect(ccHealthStatus(null, 500)).toBe('uncapped')
    expect(ccHealthStatus(0, 500)).toBe('uncapped')
    expect(ccHealthStatus(-1, 500)).toBe('uncapped')
  })

  it('returns "over" at or above 100% projected utilization', () => {
    expect(ccHealthStatus(1000, 1000)).toBe('over')
    expect(ccHealthStatus(1000, 1500)).toBe('over')
  })

  it('returns "near" between 80% and 99.9%', () => {
    expect(ccHealthStatus(1000, 800)).toBe('near')
    expect(ccHealthStatus(1000, 999)).toBe('near')
  })

  it('returns "healthy" below 80%', () => {
    expect(ccHealthStatus(1000, 799)).toBe('healthy')
    expect(ccHealthStatus(1000, 0)).toBe('healthy')
  })
})

describe('countByHealth', () => {
  it('tallies all four buckets', () => {
    type Row = { b: number | null; p: number }
    const rows: Row[] = [
      { b: 1000, p: 1500 }, // over
      { b: 1000, p: 1000 }, // over
      { b: 1000, p: 900 },  // near
      { b: 1000, p: 100 },  // healthy
      { b: null, p: 50 },   // uncapped
    ]
    const counts = countByHealth(rows, r => ccHealthStatus(r.b, r.p))
    expect(counts).toEqual({ over: 2, near: 1, healthy: 1, uncapped: 1 } as Record<CcHealth, number>)
  })

  it('returns zeros on empty input', () => {
    expect(countByHealth<{ b: number; p: number }>([], r => ccHealthStatus(r.b, r.p))).toEqual({
      over: 0,
      near: 0,
      healthy: 0,
      uncapped: 0,
    })
  })
})
