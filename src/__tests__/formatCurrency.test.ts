import { describe, expect, it } from 'vitest'
import { formatCurrency } from '@/lib/utils'

describe('formatCurrency — adaptive 3-sig-fig rule', () => {
  it('renders integer dollars under $1k', () => {
    expect(formatCurrency(0)).toBe('$0')
    expect(formatCurrency(7)).toBe('$7')
    expect(formatCurrency(550)).toBe('$550')
    expect(formatCurrency(999)).toBe('$999')
  })

  it('renders k in single-digit thousands with up to 2 decimals (trimmed)', () => {
    expect(formatCurrency(1_000)).toBe('$1k')
    expect(formatCurrency(5_530)).toBe('$5.53k')
    expect(formatCurrency(5_500)).toBe('$5.5k')
    expect(formatCurrency(7_000)).toBe('$7k')
    expect(formatCurrency(9_999)).toBe('$10k')
  })

  it('renders k in tens of thousands with up to 1 decimal (trimmed)', () => {
    expect(formatCurrency(22_500)).toBe('$22.5k')
    expect(formatCurrency(87_420)).toBe('$87.4k')
    expect(formatCurrency(40_000)).toBe('$40k')
  })

  it('renders integer k in hundreds of thousands', () => {
    expect(formatCurrency(225_000)).toBe('$225k')
    expect(formatCurrency(870_000)).toBe('$870k')
  })

  it('promotes from k to M cleanly and trims trailing zeros', () => {
    expect(formatCurrency(999_999)).toBe('$1M')
    expect(formatCurrency(1_000_000)).toBe('$1M')
    expect(formatCurrency(1_300_000)).toBe('$1.3M')
    expect(formatCurrency(12_500_000)).toBe('$12.5M')
    expect(formatCurrency(225_000_000)).toBe('$225M')
    expect(formatCurrency(1_300_000_000)).toBe('$1.3B')
  })

  it('preserves cents under $1 so they do not collapse to $0', () => {
    expect(formatCurrency(0.42)).toBe('$0.42')
  })

  it('signs negatives with a leading minus', () => {
    expect(formatCurrency(-550)).toBe('-$550')
    expect(formatCurrency(-5_530)).toBe('-$5.53k')
    expect(formatCurrency(-1_300_000)).toBe('-$1.3M')
  })

  it('returns $0 for non-finite input', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0')
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('$0')
  })
})
