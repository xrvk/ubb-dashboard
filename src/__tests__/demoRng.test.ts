import { describe, it, expect } from 'vitest'
import {
  fillerBudgetFor,
  hashStringToSeed,
  mulberry32,
  rollFillerHealth,
  rollFillerSeatCount,
  DEMO_FILLER_PER_SEAT_SPEND,
  type FillerHealth,
} from '@/lib/demoRng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) expect(a()).toBe(b())
  })

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('stays in [0, 1)', () => {
    const r = mulberry32(99)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('hashStringToSeed', () => {
  it('is deterministic and produces a 32-bit unsigned int', () => {
    const h1 = hashStringToSeed('team-001')
    const h2 = hashStringToSeed('team-001')
    expect(h1).toBe(h2)
    expect(Number.isInteger(h1)).toBe(true)
    expect(h1).toBeGreaterThanOrEqual(0)
    expect(h1).toBeLessThan(2 ** 32)
  })

  it('produces different seeds for different names', () => {
    expect(hashStringToSeed('a')).not.toBe(hashStringToSeed('b'))
    expect(hashStringToSeed('team-001')).not.toBe(hashStringToSeed('team-002'))
  })
})

describe('rollFillerSeatCount', () => {
  it('returns the same value for the same name', () => {
    expect(rollFillerSeatCount('team-042')).toBe(rollFillerSeatCount('team-042'))
  })

  it('stays in the 5..50 range', () => {
    for (let i = 1; i <= 500; i++) {
      const seats = rollFillerSeatCount(`team-${i}`)
      expect(seats).toBeGreaterThanOrEqual(5)
      expect(seats).toBeLessThanOrEqual(50)
    }
  })

  it('produces a meaningful spread (not all the same)', () => {
    const sizes = new Set<number>()
    for (let i = 1; i <= 100; i++) sizes.add(rollFillerSeatCount(`team-${i}`))
    expect(sizes.size).toBeGreaterThanOrEqual(20)
  })
})

describe('rollFillerHealth', () => {
  it('is deterministic per name', () => {
    expect(rollFillerHealth('team-001')).toBe(rollFillerHealth('team-001'))
  })

  it('lands at roughly ~10% over / ~15% near / ~75% healthy across 1000 names (±5pp)', () => {
    const counts: Record<FillerHealth, number> = { over: 0, near: 0, healthy: 0 }
    const N = 1000
    for (let i = 1; i <= N; i++) counts[rollFillerHealth(`team-${i}`)] += 1

    expect(counts.over / N).toBeGreaterThanOrEqual(0.05)
    expect(counts.over / N).toBeLessThanOrEqual(0.15)
    expect(counts.near / N).toBeGreaterThanOrEqual(0.10)
    expect(counts.near / N).toBeLessThanOrEqual(0.20)
    expect(counts.healthy / N).toBeGreaterThanOrEqual(0.70)
    expect(counts.healthy / N).toBeLessThanOrEqual(0.80)
  })
})

describe('fillerBudgetFor', () => {
  const seats = 10
  const expected = seats * DEMO_FILLER_PER_SEAT_SPEND

  it('puts "over" below expected spend', () => {
    expect(fillerBudgetFor(seats, 'over')).toBeLessThan(expected)
  })

  it('puts "near" slightly above expected spend', () => {
    const b = fillerBudgetFor(seats, 'near')
    expect(b).toBeGreaterThan(expected)
    expect(b).toBeLessThan(expected * 1.2)
  })

  it('puts "healthy" comfortably above expected spend', () => {
    expect(fillerBudgetFor(seats, 'healthy')).toBeGreaterThanOrEqual(expected * 1.5)
  })

  it('never returns below the $50 floor even for tiny teams', () => {
    expect(fillerBudgetFor(1, 'over')).toBeGreaterThanOrEqual(50)
  })
})
