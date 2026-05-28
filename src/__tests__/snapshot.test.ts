import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  daysUntilCycleReset,
  endOfMonth,
  type BulkApplySnapshot,
} from '@/lib/snapshot'

const ent = 'acme-staging'

function makeSnap(overrides: Partial<BulkApplySnapshot> = {}): BulkApplySnapshot {
  return {
    id: 'snap-1',
    enterprise: ent,
    appliedAt: Date.now(),
    cycleEndsAt: Date.now() + 1000 * 60 * 60 * 24 * 5,
    entries: [
      { budgetId: 'b1', user: 'u1', previousAmount: 5, newAmount: 105 },
      { budgetId: 'b2', user: 'u2', previousAmount: 15, newAmount: 80 },
    ],
    ...overrides,
  }
}

describe('snapshot storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a snapshot through localStorage', () => {
    const snap = makeSnap()
    saveSnapshot(snap)
    expect(loadSnapshot(ent)).toEqual(snap)
  })

  it('rejects snapshots from a different enterprise', () => {
    saveSnapshot(makeSnap({ enterprise: 'other-ent' }))
    expect(loadSnapshot(ent)).toBeNull()
  })

  it('expires snapshots older than the TTL', () => {
    const old = Date.now() - 1000 * 60 * 60 * 24 * 61 // 61 days
    saveSnapshot(makeSnap({ appliedAt: old }))
    expect(loadSnapshot(ent)).toBeNull()
  })

  it('clearSnapshot removes the stored value', () => {
    saveSnapshot(makeSnap())
    clearSnapshot()
    expect(loadSnapshot(ent)).toBeNull()
  })
})

describe('cycle helpers', () => {
  it('endOfMonth returns the first of next month', () => {
    expect(endOfMonth(new Date(2025, 5, 15))).toEqual(new Date(2025, 6, 1))
    expect(endOfMonth(new Date(2025, 11, 31))).toEqual(new Date(2026, 0, 1))
  })

  it('daysUntilCycleReset counts inclusive days remaining', () => {
    expect(daysUntilCycleReset(new Date(2025, 5, 1))).toBe(30)
    expect(daysUntilCycleReset(new Date(2025, 5, 29))).toBeLessThanOrEqual(2)
  })
})
