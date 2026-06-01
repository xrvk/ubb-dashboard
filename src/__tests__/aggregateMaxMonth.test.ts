import { describe, it, expect } from 'vitest'
import { aggregateMaxMonth } from '@/lib/reportCache'
import type { UserAicAggregate } from '@/lib/usageReport'

function row(username: string, aicConsumed: number, date = '2026-05-31'): UserAicAggregate {
  return {
    username,
    aicConsumed,
    grossAmount: aicConsumed * 0.01,
    lastUsedDate: date,
    codingAgentAic: 0,
  }
}

describe('aggregateMaxMonth', () => {
  it('returns an empty array for no months', () => {
    expect(aggregateMaxMonth([])).toEqual([])
  })

  it('returns an empty array for months that are themselves empty', () => {
    expect(aggregateMaxMonth([[], [], []])).toEqual([])
  })

  it('keeps the MAX single-month consumption per user — not the sum', () => {
    const jan = [row('alice', 100), row('bob', 50)]
    const feb = [row('alice', 30), row('bob', 200)] // bob peaks in feb
    const mar = [row('alice', 500), row('bob', 100)] // alice peaks in mar
    const out = aggregateMaxMonth([jan, feb, mar])
    const alice = out.find(u => u.username === 'alice')!
    const bob = out.find(u => u.username === 'bob')!
    expect(alice.aicConsumed).toBe(500) // NOT 100+30+500
    expect(bob.aicConsumed).toBe(200) // NOT 50+200+100
  })

  it('sorts the output by aicConsumed descending', () => {
    const m1 = [row('a', 10), row('b', 100), row('c', 50)]
    const out = aggregateMaxMonth([m1])
    expect(out.map(u => u.username)).toEqual(['b', 'c', 'a'])
  })

  it('handles a single month with a single user', () => {
    const out = aggregateMaxMonth([[row('alice', 42)]])
    expect(out).toEqual([
      expect.objectContaining({ username: 'alice', aicConsumed: 42 }),
    ])
  })

  it('preserves the lastUsedDate from the peak month (not the most recent month)', () => {
    const jan = [row('alice', 500, '2026-01-31')] // peak
    const feb = [row('alice', 100, '2026-02-28')]
    const mar = [row('alice', 200, '2026-03-31')]
    const out = aggregateMaxMonth([jan, feb, mar])
    expect(out[0].lastUsedDate).toBe('2026-01-31')
  })

  it('returns shallow clones of input rows (mutating output must not affect input)', () => {
    const original = row('alice', 100)
    const out = aggregateMaxMonth([[original]])
    out[0].aicConsumed = 99999
    expect(original.aicConsumed).toBe(100)
  })

  it('keeps the first row for a user when later months tie exactly', () => {
    // Spec is "> cur.aicConsumed" so a tie keeps the earlier record.
    const jan = [row('alice', 100, '2026-01-31')]
    const feb = [row('alice', 100, '2026-02-28')]
    const out = aggregateMaxMonth([jan, feb])
    expect(out[0].lastUsedDate).toBe('2026-01-31')
  })
})
