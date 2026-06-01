/** CC health buckets used by status-filter chips and (eventually) chart tinting. */
export type CcHealth = 'over' | 'near' | 'healthy' | 'uncapped'

export const CC_HEALTH_ORDER: readonly CcHealth[] = ['over', 'near', 'healthy', 'uncapped']

export const CC_HEALTH_LABEL: Record<CcHealth, string> = {
  over: 'Over',
  near: 'Near',
  healthy: 'Healthy',
  uncapped: 'Uncapped',
}

/**
 * Classify a CC by projected utilization against its budget. Mirrors the
 * tint thresholds used in the bullet list: ≥100% = over, ≥80% = near,
 * uncapped (no budget) is its own bucket so it doesn't masquerade as
 * "healthy".
 */
export function ccHealthStatus(
  budget: number | null,
  projected: number,
): CcHealth {
  if (budget === null || budget <= 0) return 'uncapped'
  const ratio = projected / budget
  if (ratio >= 1) return 'over'
  if (ratio >= 0.8) return 'near'
  return 'healthy'
}

/** Tally CCs per bucket. Used by the chip row to show counts. */
export function countByHealth<T>(
  rows: readonly T[],
  classify: (row: T) => CcHealth,
): Record<CcHealth, number> {
  const out: Record<CcHealth, number> = { over: 0, near: 0, healthy: 0, uncapped: 0 }
  for (const r of rows) out[classify(r)] += 1
  return out
}
