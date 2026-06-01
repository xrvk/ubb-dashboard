import { describe, it, expect } from 'vitest'
import {
  applyCcQuery,
  applyCcSort,
  ccUtilization,
  filterAndSortCcRows,
  matchesNameQuery,
  type CcSortOption,
} from '@/lib/ccRowFilter'

interface Row {
  id: string
  name: string
  budget: number | null
  projected: number
  seats: number
}

const rows: Row[] = [
  { id: 'a', name: 'platform-eng', budget: 5000, projected: 4900, seats: 1650 },
  { id: 'b', name: 'data-platform', budget: 4000, projected: 4500, seats: 1100 },
  { id: 'c', name: 'devx', budget: 1000, projected: 200, seats: 50 },
  { id: 'd', name: 'security', budget: null, projected: 100, seats: 30 },
  { id: 'e', name: 'team-001', budget: 500, projected: 50, seats: 3 },
]

const sortOpts: CcSortOption<Row>[] = [
  { id: 'name', label: 'Name asc', cmp: (a, b) => a.name.localeCompare(b.name) },
  {
    id: 'util-desc',
    label: 'Utilization desc',
    cmp: (a, b) => {
      const ua = ccUtilization(a.budget, a.projected) ?? -Infinity
      const ub = ccUtilization(b.budget, b.projected) ?? -Infinity
      return ub - ua
    },
  },
  { id: 'budget-desc', label: 'Budget desc', cmp: (a, b) => (b.budget ?? 0) - (a.budget ?? 0) },
  { id: 'seats-desc', label: 'Seats desc', cmp: (a, b) => b.seats - a.seats },
]

describe('matchesNameQuery', () => {
  it('returns true for empty query', () => {
    expect(matchesNameQuery('anything', '')).toBe(true)
    expect(matchesNameQuery('anything', '   ')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesNameQuery('Platform-ENG', 'plat')).toBe(true)
    expect(matchesNameQuery('platform-eng', 'PLAT')).toBe(true)
  })

  it('matches substring anywhere in the name', () => {
    expect(matchesNameQuery('platform-eng', 'eng')).toBe(true)
    expect(matchesNameQuery('platform-eng', 'form-e')).toBe(true)
  })

  it('returns false for misses', () => {
    expect(matchesNameQuery('platform-eng', 'zzzz')).toBe(false)
  })
})

describe('applyCcQuery', () => {
  it('returns the same reference when query is empty', () => {
    const r = applyCcQuery(rows, '', x => x.name)
    expect(r).toBe(rows)
  })

  it('filters by name', () => {
    const r = applyCcQuery(rows, 'platform', x => x.name)
    expect(r.map(x => x.id)).toEqual(['a', 'b'])
  })
})

describe('applyCcSort', () => {
  it('does not mutate the input array', () => {
    const before = [...rows]
    applyCcSort(rows, 'util-desc', sortOpts, x => x.name)
    expect(rows).toEqual(before)
  })

  it('sorts by name asc', () => {
    const r = applyCcSort(rows, 'name', sortOpts, x => x.name)
    expect(r.map(x => x.id)).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('sorts by utilization desc, sending uncapped rows to the bottom', () => {
    const r = applyCcSort(rows, 'util-desc', sortOpts, x => x.name)
    // util: a=0.98, b=1.125, c=0.2, d=null, e=0.1
    expect(r.map(x => x.id)).toEqual(['b', 'a', 'c', 'e', 'd'])
  })

  it('sorts by budget desc with name-asc tie-break', () => {
    const r = applyCcSort(rows, 'budget-desc', sortOpts, x => x.name)
    expect(r.map(x => x.id)).toEqual(['a', 'b', 'c', 'e', 'd'])
  })

  it('falls back to the first option for an unknown sort id', () => {
    const r = applyCcSort(rows, 'nonexistent', sortOpts, x => x.name)
    expect(r.map(x => x.id)).toEqual(['b', 'c', 'a', 'd', 'e'])
  })
})

describe('filterAndSortCcRows', () => {
  it('composes filter then sort', () => {
    const r = filterAndSortCcRows(rows, 'platform', 'budget-desc', sortOpts, x => x.name)
    expect(r.map(x => x.id)).toEqual(['a', 'b'])
  })
})

describe('ccUtilization', () => {
  it('returns projected/budget when budget is positive', () => {
    expect(ccUtilization(1000, 500)).toBe(0.5)
    expect(ccUtilization(2000, 3000)).toBe(1.5)
  })
  it('returns null for null or zero budgets', () => {
    expect(ccUtilization(null, 100)).toBeNull()
    expect(ccUtilization(0, 100)).toBeNull()
  })
})
