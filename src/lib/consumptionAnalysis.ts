/**
 * Consumption Analysis Library
 *
 * Pure functions for analyzing per-user AIC consumption from billing CSV data.
 * Used to size the universal ULB and identify outliers ("power users") that
 * should be put on individual ULBs instead.
 *
 * Vendored from octodemo/copilot-budget-command-calculator
 * (src/lib/consumptionAnalysis.ts). Adaptations:
 *   - `CsvUserUsage` lives in this file; `totalMonthlyQuota` is optional
 *     because the usage-reports CSV does not include seat-quota data.
 *   - `detectLicenseMix` returns zeroes when quota is not provided.
 */
import type { UserAicAggregate } from '@/lib/usageReport'

// --- Types ---

export interface CsvUserUsage {
  login: string
  totalAICs: number
  grossAmount: number
  /** Optional — usage-reports CSV does not include this. */
  totalMonthlyQuota?: number
  costCenter?: string | null
  organization?: string | null
}

export interface ConsumptionStats {
  totalUsers: number
  totalAICs: number
  mean: number
  median: number
  p75: number
  p90: number
  max: number
  stddev: number
  cbSeats: number
  ceSeats: number
}

export interface ThresholdResult {
  thresholdAICs: number
  powerUsers: CsvUserUsage[]
  regularUsers: CsvUserUsage[]
  powerUserCount: number
  regularUserCount: number
  powerUserAICShare: number
  suggestedPowerUserBudget: number
  suggestedULB: number
}

export type ThresholdMode = 'top-10' | 'top-20' | 'top-30' | 'custom'

// --- Adapter ---

/** Convert a usageReport aggregate to the CsvUserUsage shape this lib expects. */
export function toCsvUserUsage(agg: UserAicAggregate): CsvUserUsage {
  return {
    login: agg.username,
    totalAICs: agg.aicConsumed,
    grossAmount: agg.grossAmount,
  }
}

// --- Distribution Statistics ---

function sortedValues(users: CsvUserUsage[]): number[] {
  return users.map(u => u.totalAICs).sort((a, b) => a - b)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

export function calcConsumptionStats(users: CsvUserUsage[]): ConsumptionStats {
  if (users.length === 0) {
    return { totalUsers: 0, totalAICs: 0, mean: 0, median: 0, p75: 0, p90: 0, max: 0, stddev: 0, cbSeats: 0, ceSeats: 0 }
  }

  const sorted = sortedValues(users)
  const totalAICs = sorted.reduce((sum, v) => sum + v, 0)
  const mean = totalAICs / sorted.length
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sorted.length

  return {
    totalUsers: users.length,
    totalAICs,
    mean,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1],
    stddev: Math.sqrt(variance),
    cbSeats: users.filter(u => u.totalMonthlyQuota === 300).length,
    ceSeats: users.filter(u => u.totalMonthlyQuota === 1000).length,
  }
}

// --- Threshold Application ---

export function applyThreshold(
  users: CsvUserUsage[],
  thresholdAICs: number,
): ThresholdResult {
  const sorted = [...users].sort((a, b) => b.totalAICs - a.totalAICs)
  const totalAICs = sorted.reduce((sum, u) => sum + u.totalAICs, 0)

  const powerUsers = sorted.filter(u => u.totalAICs >= thresholdAICs)
  const regularUsers = sorted.filter(u => u.totalAICs < thresholdAICs)

  const powerAICs = powerUsers.reduce((sum, u) => sum + u.totalAICs, 0)
  const powerUserAICShare = totalAICs > 0 ? powerAICs / totalAICs : 0

  const powerSorted = powerUsers.map(u => u.totalAICs).sort((a, b) => a - b)
  const suggestedPowerUserBudget = powerSorted.length > 0 ? percentile(powerSorted, 50) : 0

  // Universal ULB = P95 of regular group: covers most regulars without inflating
  // the cap to the very top outlier. Admins can drag higher/lower.
  const regularSorted = regularUsers.map(u => u.totalAICs).sort((a, b) => a - b)
  const suggestedULB = regularSorted.length > 0 ? percentile(regularSorted, 95) : 0

  return {
    thresholdAICs,
    powerUsers,
    regularUsers,
    powerUserCount: powerUsers.length,
    regularUserCount: regularUsers.length,
    powerUserAICShare,
    suggestedPowerUserBudget: Math.ceil(suggestedPowerUserBudget),
    suggestedULB: Math.ceil(suggestedULB),
  }
}

// --- Threshold Calculation by Mode ---

export function calcThreshold(
  users: CsvUserUsage[],
  mode: ThresholdMode,
  customAICs?: number,
): ThresholdResult {
  if (users.length === 0) return applyThreshold([], 0)

  const sorted = [...users].sort((a, b) => b.totalAICs - a.totalAICs)

  switch (mode) {
    case 'top-10': {
      const count = Math.max(1, Math.ceil(sorted.length * 0.1))
      return applyThreshold(users, sorted[count - 1].totalAICs)
    }
    case 'top-20': {
      const count = Math.max(1, Math.ceil(sorted.length * 0.2))
      return applyThreshold(users, sorted[count - 1].totalAICs)
    }
    case 'top-30': {
      const count = Math.max(1, Math.ceil(sorted.length * 0.3))
      return applyThreshold(users, sorted[count - 1].totalAICs)
    }
    case 'custom':
      return applyThreshold(users, customAICs ?? 0)
  }
}

// --- License Detection (best-effort; usage-reports CSV omits quota) ---

export function detectLicenseMix(users: CsvUserUsage[]): { cbSeats: number; ceSeats: number } {
  return {
    cbSeats: users.filter(u => u.totalMonthlyQuota === 300).length,
    ceSeats: users.filter(u => u.totalMonthlyQuota === 1000).length,
  }
}
