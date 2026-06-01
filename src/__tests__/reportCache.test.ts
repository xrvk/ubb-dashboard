import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadCachedReport,
  saveCachedReport,
  clearCachedReport,
  listCachedMonths,
  loadAllCachedReports,
  type CachedReport,
} from '@/lib/reportCache'
import type { UserAicAggregate } from '@/lib/usageReport'

const ent = 'acme'

function makeRow(username: string, aicConsumed: number): UserAicAggregate {
  return {
    username,
    aicConsumed,
    grossAmount: aicConsumed * 0.04,
    lastUsedDate: null,
    codingAgentAic: 0,
  }
}

function makeReport(overrides: Partial<CachedReport> = {}): CachedReport {
  return {
    enterprise: ent,
    monthKey: '2025-04',
    reportId: 'r-1',
    ingestedAt: 1_700_000_000_000,
    source: 'uploaded',
    rows: [makeRow('u1', 12.5), makeRow('u2', 7)],
    ...overrides,
  }
}

describe('reportCache storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a report through localStorage', () => {
    const report = makeReport()
    saveCachedReport(report)
    expect(loadCachedReport(ent, '2025-04')).toEqual(report)
  })

  it('returns null when no report is cached', () => {
    expect(loadCachedReport(ent, '2025-04')).toBeNull()
  })

  it('returns null for corrupt JSON instead of throwing', () => {
    window.localStorage.setItem('ubb:report:acme:2025-04', '{not json')
    expect(loadCachedReport(ent, '2025-04')).toBeNull()
  })

  it('returns null when rows field is not an array', () => {
    window.localStorage.setItem(
      'ubb:report:acme:2025-04',
      JSON.stringify({ enterprise: ent, monthKey: '2025-04', rows: 'oops' }),
    )
    expect(loadCachedReport(ent, '2025-04')).toBeNull()
  })

  it('isolates reports by month key', () => {
    saveCachedReport(makeReport({ monthKey: '2025-03', rows: [makeRow('a', 1)] }))
    saveCachedReport(makeReport({ monthKey: '2025-04', rows: [makeRow('b', 2)] }))
    expect(loadCachedReport(ent, '2025-03')?.rows[0].username).toBe('a')
    expect(loadCachedReport(ent, '2025-04')?.rows[0].username).toBe('b')
  })

  it('isolates reports by enterprise', () => {
    saveCachedReport(makeReport({ enterprise: 'acme', rows: [makeRow('a', 1)] }))
    saveCachedReport(makeReport({ enterprise: 'other', rows: [makeRow('b', 2)] }))
    expect(loadCachedReport('acme', '2025-04')?.rows[0].username).toBe('a')
    expect(loadCachedReport('other', '2025-04')?.rows[0].username).toBe('b')
  })

  it('clearCachedReport removes only the targeted month', () => {
    saveCachedReport(makeReport({ monthKey: '2025-03' }))
    saveCachedReport(makeReport({ monthKey: '2025-04' }))
    clearCachedReport(ent, '2025-03')
    expect(loadCachedReport(ent, '2025-03')).toBeNull()
    expect(loadCachedReport(ent, '2025-04')).not.toBeNull()
  })

  it('saveCachedReport swallows quota errors without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => saveCachedReport(makeReport())).not.toThrow()
    expect(warn).toHaveBeenCalled()
    setItem.mockRestore()
    warn.mockRestore()
  })

  it('clearCachedReport swallows storage errors without throwing', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => clearCachedReport(ent, '2025-04')).not.toThrow()
    removeItem.mockRestore()
  })
})

describe('listCachedMonths', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns months sorted ascending', () => {
    saveCachedReport(makeReport({ monthKey: '2025-04' }))
    saveCachedReport(makeReport({ monthKey: '2025-01' }))
    saveCachedReport(makeReport({ monthKey: '2025-03' }))
    expect(listCachedMonths(ent)).toEqual(['2025-01', '2025-03', '2025-04'])
  })

  it('filters out other enterprises', () => {
    saveCachedReport(makeReport({ enterprise: 'acme', monthKey: '2025-04' }))
    saveCachedReport(makeReport({ enterprise: 'other', monthKey: '2025-05' }))
    expect(listCachedMonths('acme')).toEqual(['2025-04'])
  })

  it('ignores unrelated localStorage keys', () => {
    window.localStorage.setItem('some-other-key', 'value')
    window.localStorage.setItem('ubb:snapshot:acme', 'value')
    saveCachedReport(makeReport({ monthKey: '2025-04' }))
    expect(listCachedMonths(ent)).toEqual(['2025-04'])
  })

  it('returns empty array when nothing is cached', () => {
    expect(listCachedMonths(ent)).toEqual([])
  })
})

describe('loadAllCachedReports', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns all reports for an enterprise in monthKey order', () => {
    saveCachedReport(makeReport({ monthKey: '2025-04', rows: [makeRow('apr', 4)] }))
    saveCachedReport(makeReport({ monthKey: '2025-02', rows: [makeRow('feb', 2)] }))
    saveCachedReport(makeReport({ monthKey: '2025-03', rows: [makeRow('mar', 3)] }))
    const out = loadAllCachedReports(ent)
    expect(out.map(r => r.monthKey)).toEqual(['2025-02', '2025-03', '2025-04'])
    expect(out.map(r => r.rows[0].username)).toEqual(['feb', 'mar', 'apr'])
  })

  it('skips months whose payload is corrupt', () => {
    saveCachedReport(makeReport({ monthKey: '2025-03' }))
    window.localStorage.setItem('ubb:report:acme:2025-04', '{broken')
    const out = loadAllCachedReports(ent)
    expect(out.map(r => r.monthKey)).toEqual(['2025-03'])
  })

  it('returns empty array when nothing is cached', () => {
    expect(loadAllCachedReports(ent)).toEqual([])
  })
})

describe('reportCache resilience', () => {
  let originalLocalStorage: Storage

  beforeEach(() => {
    originalLocalStorage = window.localStorage
  })

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    })
  })

  it('listCachedMonths returns [] when localStorage iteration throws', () => {
    const getLength = vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new Error('access denied')
    })
    expect(listCachedMonths(ent)).toEqual([])
    getLength.mockRestore()
  })
})
