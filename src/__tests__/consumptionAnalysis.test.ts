import { describe, expect, it } from 'vitest'
import {
  calcConsumptionStats,
  applyThreshold,
  calcThreshold,
  detectLicenseMix,
  type CsvUserUsage,
} from '../lib/consumptionAnalysis'

// Mutation-resistance suite. Without these, single-character mutations
// (`>=` ↔ `>`, percentile interpolation swaps, off-by-one in `Math.ceil`
// vs `Math.floor`) silently pass the existing approximate assertions.
describe('mutation-resistance: applyThreshold equality boundary', () => {
  function u(login: string, totalAICs: number): CsvUserUsage {
    return { login, totalAICs, grossAmount: 0, costCenter: null, organization: null }
  }

  it('classifies users exactly AT the threshold as power users (>=, not >)', () => {
    // If anyone flips `>=` to `>` in applyThreshold, the two users at
    // exactly 1000 quietly fall into `regularUsers` and the recommended
    // universal ULB shifts.
    const r = applyThreshold([u('a', 1000), u('b', 999), u('c', 1000)], 1000)
    expect(r.powerUserCount).toBe(2)
    expect(r.regularUserCount).toBe(1)
    expect(r.powerUsers.map(x => x.login).sort()).toEqual(['a', 'c'])
  })

  it('classifies users just under the threshold as regular (no float-bleed)', () => {
    const r = applyThreshold([u('a', 999.99), u('b', 1000)], 1000)
    expect(r.powerUserCount).toBe(1)
    expect(r.regularUserCount).toBe(1)
  })
})

describe('mutation-resistance: percentile interpolation', () => {
  // calcConsumptionStats uses linear interpolation. Exact-value assertions
  // catch wrong algorithms (nearest-rank, R-7 vs R-8, ceil-on-index).
  function u(i: number, v: number): CsvUserUsage {
    return { login: `u${i}`, totalAICs: v, grossAmount: 0, costCenter: null, organization: null }
  }

  it('returns exact linear-interpolation values for [0, 10, 20, 30]', () => {
    // Linear interpolation with idx = p/100 * (n-1):
    //   p50 → idx 1.5 → 10 + 0.5*(20-10) = 15
    //   p75 → idx 2.25 → 20 + 0.25*(30-20) = 22.5
    //   p90 → idx 2.7 → 20 + 0.7*(30-20) = 27
    const stats = calcConsumptionStats([u(0, 0), u(1, 10), u(2, 20), u(3, 30)])
    expect(stats.median).toBeCloseTo(15, 10)
    expect(stats.p75).toBeCloseTo(22.5, 10)
    expect(stats.p90).toBeCloseTo(27, 10)
    expect(stats.max).toBe(30)
  })

  it('returns the only value for single-user input (no NaN from division)', () => {
    const stats = calcConsumptionStats([u(0, 42)])
    expect(stats.median).toBe(42)
    expect(stats.p75).toBe(42)
    expect(stats.p90).toBe(42)
  })
})

describe('mutation-resistance: calcThreshold count math', () => {
  // calcThreshold uses Math.max(1, Math.ceil(N * pct)). Off-by-one in the
  // index lookup or a swap of ceil↔floor changes the threshold cutoff.
  function users(n: number): CsvUserUsage[] {
    return Array.from({ length: n }, (_, i) => ({
      login: `u${i}`,
      totalAICs: (i + 1) * 100, // 100, 200, ..., n*100
      grossAmount: 0,
      costCenter: null,
      organization: null,
    }))
  }

  it('top-5 over 10 users picks the single top user (ceil(10*0.05)=1)', () => {
    const r = calcThreshold(users(10), 'top-5')
    expect(r.powerUserCount).toBe(1)
    expect(r.powerUsers[0].totalAICs).toBe(1000)
  })

  it('top-10 over 10 users picks exactly the single top user (ceil(10*0.1)=1)', () => {
    const r = calcThreshold(users(10), 'top-10')
    expect(r.powerUserCount).toBe(1)
  })

  it('top-15 over 10 users picks the top 2 users (ceil(10*0.15)=2)', () => {
    const r = calcThreshold(users(10), 'top-15')
    expect(r.powerUserCount).toBe(2)
    expect(r.powerUsers.map(u => u.totalAICs).sort((a, b) => a - b)).toEqual([900, 1000])
  })

  it('custom 0% picks nobody (threshold above the max)', () => {
    const r = calcThreshold(users(10), 'custom', 0)
    expect(r.powerUserCount).toBe(0)
    expect(r.regularUserCount).toBe(10)
  })

  it('custom 100% picks everyone', () => {
    const r = calcThreshold(users(10), 'custom', 100)
    expect(r.powerUserCount).toBe(10)
    expect(r.regularUserCount).toBe(0)
  })

  it('custom 50% over 10 users picks the top 5 (ceil(10*0.5)=5)', () => {
    const r = calcThreshold(users(10), 'custom', 50)
    expect(r.powerUserCount).toBe(5)
  })

  it('clamps negative customPct to 0 (picks nobody, not everybody)', () => {
    const r = calcThreshold(users(10), 'custom', -10)
    expect(r.powerUserCount).toBe(0)
  })

  it('clamps customPct > 100 to 100 (picks everybody, no crash)', () => {
    const r = calcThreshold(users(10), 'custom', 250)
    expect(r.powerUserCount).toBe(10)
  })
})

// Keep the parser bag happy.
void detectLicenseMix

function makeUser(login: string, totalAICs: number, quota?: number): CsvUserUsage {
  return {
    login,
    totalAICs,
    grossAmount: totalAICs * 0.01,
    totalMonthlyQuota: quota,
    costCenter: null,
    organization: null,
  }
}

describe('calcConsumptionStats', () => {
  it('returns zeroes for empty input', () => {
    const stats = calcConsumptionStats([])
    expect(stats.totalUsers).toBe(0)
    expect(stats.mean).toBe(0)
    expect(stats.median).toBe(0)
  })

  it('computes stats for a single user', () => {
    const stats = calcConsumptionStats([makeUser('alice', 500)])
    expect(stats.totalUsers).toBe(1)
    expect(stats.totalAICs).toBe(500)
    expect(stats.mean).toBe(500)
    expect(stats.median).toBe(500)
    expect(stats.max).toBe(500)
    expect(stats.stddev).toBe(0)
  })

  it('computes correct distribution for multiple users', () => {
    const users = [
      makeUser('a', 100),
      makeUser('b', 200),
      makeUser('c', 300),
      makeUser('d', 400),
      makeUser('e', 3000),
    ]
    const stats = calcConsumptionStats(users)
    expect(stats.totalUsers).toBe(5)
    expect(stats.totalAICs).toBe(4000)
    expect(stats.mean).toBe(800)
    expect(stats.median).toBe(300)
    expect(stats.max).toBe(3000)
    expect(stats.p90).toBeGreaterThan(stats.median)
    expect(stats.stddev).toBeGreaterThan(0)
  })

  it('counts CB and CE seats by quota when provided', () => {
    const users = [
      makeUser('a', 100, 300),
      makeUser('b', 200, 300),
      makeUser('c', 300, 1000),
    ]
    const stats = calcConsumptionStats(users)
    expect(stats.cbSeats).toBe(2)
    expect(stats.ceSeats).toBe(1)
  })
})

describe('applyThreshold', () => {
  const users = [
    makeUser('heavy1', 3000),
    makeUser('heavy2', 2000),
    makeUser('medium', 500),
    makeUser('light1', 100),
    makeUser('light2', 50),
  ]

  it('splits users at threshold', () => {
    const result = applyThreshold(users, 1000)
    expect(result.powerUserCount).toBe(2)
    expect(result.regularUserCount).toBe(3)
    expect(result.powerUsers.map(u => u.login)).toContain('heavy1')
    expect(result.powerUsers.map(u => u.login)).toContain('heavy2')
  })

  it('computes power user AIC share', () => {
    const result = applyThreshold(users, 1000)
    const totalAICs = 3000 + 2000 + 500 + 100 + 50
    expect(result.powerUserAICShare).toBeCloseTo(5000 / totalAICs, 3)
  })

  it('suggests power user budget from power group median', () => {
    const result = applyThreshold(users, 1000)
    expect(result.suggestedPowerUserBudget).toBe(2500)
  })

  it('suggests ULB from regular group upper range', () => {
    const result = applyThreshold(users, 1000)
    expect(result.suggestedULB).toBeGreaterThanOrEqual(400)
    expect(result.suggestedULB).toBeLessThanOrEqual(500)
  })

  it('handles threshold that includes all users', () => {
    const result = applyThreshold(users, 10)
    expect(result.powerUserCount).toBe(5)
    expect(result.regularUserCount).toBe(0)
    expect(result.suggestedULB).toBe(0)
  })

  it('handles threshold that includes no users', () => {
    const result = applyThreshold(users, 10000)
    expect(result.powerUserCount).toBe(0)
    expect(result.regularUserCount).toBe(5)
    expect(result.suggestedPowerUserBudget).toBe(0)
  })
})

describe('calcThreshold', () => {
  const users = Array.from({ length: 10 }, (_, i) => makeUser(`user-${i}`, (i + 1) * 100))

  it('top-5 gets roughly 1 power user from 10', () => {
    expect(calcThreshold(users, 'top-5').powerUserCount).toBe(1)
  })

  it('top-10 gets roughly 1 power user from 10', () => {
    expect(calcThreshold(users, 'top-10').powerUserCount).toBe(1)
  })

  it('top-15 gets roughly 2 power users from 10', () => {
    expect(calcThreshold(users, 'top-15').powerUserCount).toBe(2)
  })

  it('custom mode treats value as top-N%', () => {
    const result = calcThreshold(users, 'custom', 60)
    expect(result.powerUserCount).toBe(6)
  })

  it('handles empty input', () => {
    const result = calcThreshold([], 'top-10')
    expect(result.powerUserCount).toBe(0)
    expect(result.regularUserCount).toBe(0)
  })
})

describe('detectLicenseMix', () => {
  it('counts business and enterprise seats when quota is present', () => {
    const users = [
      makeUser('a', 100, 300),
      makeUser('b', 200, 300),
      makeUser('c', 300, 1000),
    ]
    const mix = detectLicenseMix(users)
    expect(mix.cbSeats).toBe(2)
    expect(mix.ceSeats).toBe(1)
  })

  it('returns 0 when quota is missing', () => {
    const mix = detectLicenseMix([makeUser('a', 100)])
    expect(mix.cbSeats).toBe(0)
    expect(mix.ceSeats).toBe(0)
  })
})
