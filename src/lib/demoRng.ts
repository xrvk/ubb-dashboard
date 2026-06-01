/**
 * Tiny deterministic RNG + per-CC profile helpers used by demo mode to
 * vary filler cost-center seat counts and budgets in a stable,
 * reproducible way (so demos render the same on every reload — no
 * `Math.random()` and no module-level state).
 *
 * Math derived from the mulberry32 PRNG (public domain), inlined to
 * avoid taking a runtime dep on a 5-line algorithm.
 */

/** Stable 32-bit hash of a string — used to derive per-CC RNG seeds. */
export function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mulberry32 — deterministic 0..1 float stream from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A filler CC's health profile, used to bucket budgets. */
export type FillerHealth = 'over' | 'near' | 'healthy'

/**
 * Roll the health bucket for a given filler CC index. Tuned so that
 * across N filler CCs you get ~10% over, ~15% near, ~75% healthy
 * (matches Phase 5 spec). Deterministic per name.
 */
export function rollFillerHealth(name: string): FillerHealth {
  const rng = mulberry32(hashStringToSeed(`${name}|health`))
  const r = rng()
  if (r < 0.1) return 'over'
  if (r < 0.25) return 'near'
  return 'healthy'
}

/**
 * Log-normal-ish seat count in 5..50 range, biased toward smaller teams
 * (mode ~8 seats). Deterministic per CC name.
 */
export function rollFillerSeatCount(name: string): number {
  const rng = mulberry32(hashStringToSeed(`${name}|seats`))
  // log-uniform between ln(5) and ln(50) — keeps small teams common.
  const lo = Math.log(5)
  const hi = Math.log(50)
  const v = Math.exp(lo + rng() * (hi - lo))
  return Math.max(5, Math.min(50, Math.round(v)))
}

/**
 * Per-seat consumption baseline used when sizing budgets so a "healthy"
 * filler CC's budget really does cover its expected projected spend.
 * Mirrors the universal UBB seed value the demo plants (`$50`).
 */
export const DEMO_FILLER_PER_SEAT_SPEND = 50

/**
 * Budget for a filler CC, sized relative to expected spend so the
 * health bucket actually shows up that way in the dashboard:
 *   over    → budget < expected spend (~70%)
 *   near    → budget ~= expected spend ✕ 1.05 (slightly above)
 *   healthy → budget = expected spend ✕ 1.6 (plenty of headroom)
 */
export function fillerBudgetFor(seatCount: number, health: FillerHealth): number {
  const expected = seatCount * DEMO_FILLER_PER_SEAT_SPEND
  switch (health) {
    case 'over':
      return Math.max(50, Math.round(expected * 0.7))
    case 'near':
      return Math.round(expected * 1.05)
    case 'healthy':
      return Math.round(expected * 1.6)
  }
}
