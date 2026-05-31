import { describe, it, expect } from 'vitest'
import {
  calcConsumptionStats,
  applyThreshold,
  calcThreshold,
  detectLicenseMix,
  type CsvUserUsage,
} from '../lib/consumptionAnalysis'

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

  it('top-10 gets roughly 1 power user from 10', () => {
    expect(calcThreshold(users, 'top-10').powerUserCount).toBe(1)
  })

  it('top-20 gets roughly 2 power users from 10', () => {
    expect(calcThreshold(users, 'top-20').powerUserCount).toBe(2)
  })

  it('top-30 gets roughly 3 power users from 10', () => {
    expect(calcThreshold(users, 'top-30').powerUserCount).toBe(3)
  })

  it('custom mode treats value as top-N%', () => {
    const result = calcThreshold(users, 'custom', 60)
    expect(result.powerUserCount).toBe(6)
  })

  it('handles empty input', () => {
    const result = calcThreshold([], 'top-20')
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
