import { describe, expect, it } from 'vitest'
import { formatCurrency } from '@/lib/utils'

describe('formatCurrency — adaptive 3-sig-fig rule', () => {
  it('renders integer dollars under $1k', () => {
    expect(formatCurrency(0)).toBe('$0')
    expect(formatCurrency(7)).toBe('$7')
    expect(formatCurrency(550)).toBe('$550')
    expect(formatCurrency(999)).toBe('$999')
  })

  it('renders 2-decimal k in single-digit thousands', () => {
    expect(formatCurrency(1_000)).toBe('$1.00k')
    expect(formatCurrency(5_530)).toBe('$5.53k')
    expect(formatCurrency(7_000)).toBe('$7.00k')
    expect(formatCurrency(9_999)).toBe('$10.0k')
  })

  it('renders 1-decimal k in tens of thousands', () => {
    expect(formatCurrency(22_500)).toBe('$22.5k')
    expect(formatCurrency(87_420)).toBe('$87.4k')
  })

  it('renders integer k in hundreds of thousands', () => {
    expect(formatCurrency(225_000)).toBe('$225k')
    expect(formatCurrency(870_000)).toBe('$870k')
  })

  it('promotes from k to M cleanly', () => {
    expect(formatCurrency(999_999)).toBe('$1.00M')
    expect(formatCurrency(1_000_000)).toBe('$1.00M')
    expect(formatCurrency(1_300_000)).toBe('$1.30M')
    expect(formatCurrency(12_500_000)).toBe('$12.5M')
    expect(formatCurrency(225_000_000)).toBe('$225M')
    expect(formatCurrency(1_300_000_000)).toBe('$1.30B')
  })

  it('preserves cents under $1 so they do not collapse to $0', () => {
    expect(formatCurrency(0.42)).toBe('$0.42')
  })

  it('signs negatives with a leading minus', () => {
    expect(formatCurrency(-550)).toBe('-$550')
    expect(formatCurrency(-5_530)).toBe('-$5.53k')
    expect(formatCurrency(-1_300_000)).toBe('-$1.30M')
  })

  it('returns $0 for non-finite input', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0')
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('$0')
  })
})
