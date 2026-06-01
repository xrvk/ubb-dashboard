import { describe, it, expect } from 'vitest'
import {
  collapseToTopN,
  isOtherSegment,
  STRUCTURE_DIAGRAM_TOPN,
  OTHER_SEGMENT_ID,
  type DiagramSegment,
} from '@/lib/structureDiagramCollapse'

function seg(id: string, name: string, budget: number, opts: Partial<DiagramSegment> = {}): DiagramSegment {
  return {
    id,
    name,
    budget,
    preventFurtherUsage: false,
    uncapped: false,
    seatCount: 10,
    affectsCopilot: true,
    ...opts,
  }
}

describe('collapseToTopN', () => {
  it('returns the input unchanged (re-sorted) when count <= maxVisible', () => {
    const input = [seg('a', 'a', 100), seg('b', 'b', 300), seg('c', 'c', 200)]
    const r = collapseToTopN(input, 8)
    expect(r).toHaveLength(3)
    expect(r.map(s => s.id)).toEqual(['b', 'c', 'a'])
    expect(r.some(isOtherSegment)).toBe(false)
  })

  it('keeps top (maxVisible - 1) and folds the rest into Other', () => {
    const input: DiagramSegment[] = []
    for (let i = 0; i < 249; i++) {
      input.push(seg(`cc-${i}`, `cc-${String(i).padStart(3, '0')}`, i + 1))
    }
    const r = collapseToTopN(input, 8)
    expect(r).toHaveLength(8)
    // First 7 are kept by budget desc
    expect(r.slice(0, 7).map(s => s.budget)).toEqual([249, 248, 247, 246, 245, 244, 243])
    // Last is Other
    const last = r[7]
    expect(isOtherSegment(last)).toBe(true)
    if (isOtherSegment(last)) {
      expect(last.id).toBe(OTHER_SEGMENT_ID)
      expect(last.hiddenCount).toBe(249 - 7)
      // sum of 1..242 = 242*243/2
      expect(last.budget).toBe((242 * 243) / 2)
      expect(last.seatCount).toBe((249 - 7) * 10)
      expect(last.uncapped).toBe(false)
    }
  })

  it('places uncapped segments first, ahead of bigger-budget capped ones', () => {
    const input = [
      seg('big', 'big', 9000),
      seg('mid', 'mid', 5000),
      seg('un1', 'un1', 0, { uncapped: true, seatCount: 50 }),
      seg('small', 'small', 100),
    ]
    const r = collapseToTopN(input, 8)
    expect(r[0].id).toBe('un1')
    expect(r.slice(1).map(s => s.id)).toEqual(['big', 'mid', 'small'])
  })

  it('counts hidden uncapped segments inside Other', () => {
    const input: DiagramSegment[] = []
    // 5 uncapped + 10 capped
    for (let i = 0; i < 5; i++) {
      input.push(seg(`un-${i}`, `un-${i}`, 0, { uncapped: true, seatCount: 20 }))
    }
    for (let i = 0; i < 10; i++) {
      input.push(seg(`c-${i}`, `c-${i}`, i + 1))
    }
    const r = collapseToTopN(input, 8)
    expect(r).toHaveLength(8)
    const other = r[7]
    expect(isOtherSegment(other)).toBe(true)
    if (isOtherSegment(other)) {
      // 5 uncapped + 10 capped = 15 total; kept 7; hidden 8
      expect(other.hiddenCount).toBe(8)
      // Top 7 = 5 uncapped + top 2 capped (10, 9). Hidden = c-0..c-7 = 8 items, all capped.
      expect(other.hiddenUncappedCount).toBe(0)
    }
  })

  it('tie-breaks equal budgets by name asc deterministically', () => {
    const input = [seg('z', 'zeta', 500), seg('a', 'alpha', 500), seg('m', 'mike', 500)]
    const r = collapseToTopN(input, 8)
    expect(r.map(s => s.id)).toEqual(['a', 'm', 'z'])
  })

  it('keeps at least 1 visible segment when maxVisible is small', () => {
    const input = [seg('a', 'a', 100), seg('b', 'b', 50), seg('c', 'c', 25)]
    const r = collapseToTopN(input, 2)
    expect(r).toHaveLength(2)
    expect(r[0].id).toBe('a')
    expect(isOtherSegment(r[1])).toBe(true)
    if (isOtherSegment(r[1])) expect(r[1].hiddenCount).toBe(2)
  })

  it('uses STRUCTURE_DIAGRAM_TOPN as the default maxVisible', () => {
    const input: DiagramSegment[] = []
    for (let i = 0; i < 50; i++) input.push(seg(`cc-${i}`, `cc-${i}`, i + 1))
    const r = collapseToTopN(input)
    expect(r).toHaveLength(STRUCTURE_DIAGRAM_TOPN)
  })
})
