import { describe, it, expect } from 'vitest'
import {
  CC_OVER_VISIBLE_CAP,
  splitFailingChecks,
  type FailingCheck,
} from '@/lib/constraintsBannerFailures'

function ccOver(name: string, overBy: number): FailingCheck {
  return {
    kind: 'cc-over',
    message: `${name} over by ${overBy}`,
    actions: [],
    overBy,
    costCenterName: name,
  }
}

const singletonCcVsEnt: FailingCheck = {
  kind: 'cc-vs-ent',
  message: 'cc budgets exceed enterprise',
  actions: [],
}

const singletonLeftover: FailingCheck = {
  kind: 'leftover',
  message: 'leftover users exceed enterprise allowance',
  actions: [],
}

describe('splitFailingChecks', () => {
  it('returns empty buckets for an empty input', () => {
    const r = splitFailingChecks([])
    expect(r.singletons).toEqual([])
    expect(r.ccOverVisible).toEqual([])
    expect(r.ccOverHidden).toEqual([])
    expect(r.ccOverTotal).toBe(0)
    expect(r.ccOverTotalOverBy).toBe(0)
  })

  it('keeps singletons separate and never hides them', () => {
    const r = splitFailingChecks([singletonCcVsEnt, singletonLeftover])
    expect(r.singletons).toHaveLength(2)
    expect(r.ccOverVisible).toHaveLength(0)
    expect(r.ccOverHidden).toHaveLength(0)
    expect(r.ccOverTotal).toBe(0)
  })

  it('sorts cc-over visible items by overBy desc', () => {
    const checks = [
      ccOver('alpha', 100),
      ccOver('bravo', 500),
      ccOver('charlie', 300),
      ccOver('delta', 50),
      ccOver('echo', 1000),
    ]
    const r = splitFailingChecks(checks)
    expect(r.ccOverVisible.map(c => c.costCenterName)).toEqual([
      'echo',
      'bravo',
      'charlie',
      'alpha',
      'delta',
    ])
    expect(r.ccOverHidden).toHaveLength(0)
  })

  it('tie-breaks equal overBy by costCenterName asc', () => {
    const checks = [
      ccOver('zeta', 100),
      ccOver('alpha', 100),
      ccOver('mike', 100),
    ]
    const r = splitFailingChecks(checks)
    expect(r.ccOverVisible.map(c => c.costCenterName)).toEqual([
      'alpha',
      'mike',
      'zeta',
    ])
  })

  it('caps visible at CC_OVER_VISIBLE_CAP and hides the rest', () => {
    const checks: FailingCheck[] = []
    for (let i = 0; i < 249; i++) {
      checks.push(ccOver(`cc-${String(i).padStart(3, '0')}`, i + 1))
    }
    const r = splitFailingChecks(checks)
    expect(r.ccOverTotal).toBe(249)
    expect(r.ccOverVisible).toHaveLength(CC_OVER_VISIBLE_CAP)
    expect(r.ccOverHidden).toHaveLength(249 - CC_OVER_VISIBLE_CAP)
    expect(r.ccOverVisible[0].overBy).toBe(249)
    expect(r.ccOverVisible[CC_OVER_VISIBLE_CAP - 1].overBy).toBe(249 - (CC_OVER_VISIBLE_CAP - 1))
  })

  it('sums overBy across all cc-over items', () => {
    const checks = [ccOver('a', 100), ccOver('b', 250), ccOver('c', 50)]
    const r = splitFailingChecks(checks)
    expect(r.ccOverTotalOverBy).toBe(400)
  })

  it('treats missing overBy as 0 without throwing', () => {
    const checks: FailingCheck[] = [
      { kind: 'cc-over', message: 'no overBy', actions: [] },
      ccOver('a', 100),
    ]
    const r = splitFailingChecks(checks)
    expect(r.ccOverVisible[0].costCenterName).toBe('a')
    expect(r.ccOverTotalOverBy).toBe(100)
  })

  it('preserves singletons alongside many cc-over items', () => {
    const checks: FailingCheck[] = [singletonCcVsEnt]
    for (let i = 0; i < 20; i++) checks.push(ccOver(`cc-${i}`, i + 1))
    checks.push(singletonLeftover)
    const r = splitFailingChecks(checks)
    expect(r.singletons.map(s => s.kind)).toEqual(['cc-vs-ent', 'leftover'])
    expect(r.ccOverTotal).toBe(20)
  })
})
