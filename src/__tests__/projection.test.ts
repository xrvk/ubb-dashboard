import { describe, it, expect } from 'vitest'
import { projectMonthlyBudget } from '@/lib/projection'

describe('projectMonthlyBudget', () => {
  it('projects consumption based on elapsed days and applies growth buffer', () => {
    // Mid-month: 15 of 30 days elapsed, user consumed $50 → daily rate $3.33,
    // remaining 15 days projects another $50, full month projection $100.
    // With 5% buffer → $105.
    const now = new Date(2025, 5, 15) // June 15 2025 (30-day month)
    const r = projectMonthlyBudget(50, 0.05, now)
    expect(r.daysInMonth).toBe(30)
    expect(r.daysElapsed).toBe(15)
    expect(r.daysRemaining).toBe(15)
    expect(r.dailyRate).toBeCloseTo(50 / 15)
    expect(r.projectedMonthTotal).toBeCloseTo(100, 5)
    expect(r.recommendedBudget).toBe(105)
  })

  it('floors at $1 even with no consumption', () => {
    const now = new Date(2025, 5, 15)
    const r = projectMonthlyBudget(0, 0.05, now)
    expect(r.recommendedBudget).toBe(1)
  })

  it('always rounds up so users are not blocked by cents', () => {
    const now = new Date(2025, 5, 15) // 15 of 30 days
    const r = projectMonthlyBudget(10.01, 0, now)
    // projection ≈ 20.02 → ceil to 21
    expect(r.recommendedBudget).toBe(21)
  })

  it('flags low confidence early in the month', () => {
    const r3 = projectMonthlyBudget(5, 0.05, new Date(2025, 5, 3))
    expect(r3.lowConfidence).toBe(true)
    const r5 = projectMonthlyBudget(5, 0.05, new Date(2025, 5, 5))
    expect(r5.lowConfidence).toBe(false)
  })

  it('handles last day of month (zero days remaining)', () => {
    const now = new Date(2025, 5, 30) // June 30
    const r = projectMonthlyBudget(120, 0.1, now)
    expect(r.daysRemaining).toBe(0)
    // projectedMonth = consumed (120), recommended = 132
    expect(r.recommendedBudget).toBe(132)
  })

  it('handles first day of month (1 day elapsed)', () => {
    const now = new Date(2025, 5, 1) // June 1
    const r = projectMonthlyBudget(5, 0.05, now)
    expect(r.daysElapsed).toBe(1)
    expect(r.daysRemaining).toBe(29)
    // projected = 5 + 5 * 29 = 150, * 1.05 = 157.5 → ceil 158
    expect(r.recommendedBudget).toBe(158)
  })

  // --- Input sanitization. The function feeds a customer-facing UI; non-
  // finite inputs from upstream parsing must not leak through as "$NaN"
  // or "$Infinity" budget recommendations. ---

  it('clamps NaN consumed to 0 (returns the $1 floor, not NaN)', () => {
    const now = new Date(2025, 5, 15)
    const r = projectMonthlyBudget(NaN, 0.05, now)
    expect(Number.isFinite(r.recommendedBudget)).toBe(true)
    expect(r.recommendedBudget).toBe(1)
  })

  it('clamps Infinity consumed to 0', () => {
    const now = new Date(2025, 5, 15)
    const r = projectMonthlyBudget(Infinity, 0.05, now)
    expect(Number.isFinite(r.recommendedBudget)).toBe(true)
    expect(r.recommendedBudget).toBe(1)
  })

  it('clamps negative consumed to 0 (cannot have spent less than zero)', () => {
    const now = new Date(2025, 5, 15)
    const r = projectMonthlyBudget(-50, 0.05, now)
    expect(r.recommendedBudget).toBe(1)
  })

  it('clamps non-finite growth buffer to 0', () => {
    const now = new Date(2025, 5, 15) // 15/30 days
    const r = projectMonthlyBudget(50, NaN, now)
    // projection = 100, no growth → recommended = 100
    expect(r.recommendedBudget).toBe(100)
    const r2 = projectMonthlyBudget(50, Infinity, now)
    expect(Number.isFinite(r2.recommendedBudget)).toBe(true)
    expect(r2.recommendedBudget).toBe(100)
  })

  it('clamps negative growth buffer to 0 (no negative-buffer discount)', () => {
    const now = new Date(2025, 5, 15)
    const r = projectMonthlyBudget(50, -0.5, now)
    expect(r.recommendedBudget).toBe(100)
  })
})
