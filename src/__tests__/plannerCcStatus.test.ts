import { describe, it, expect } from 'vitest'
import {
  countByPlannerHealth,
  plannerCcHealth,
  type PlannerRowShape,
} from '@/lib/plannerCcStatus'

const base: PlannerRowShape = { affectsCopilot: true, budgetId: 'b1', apiAmount: 100 }

describe('plannerCcHealth', () => {
  it('flags uncapped when CC affects Copilot but has no budget', () => {
    expect(plannerCcHealth({ ...base, budgetId: null }, null, null)).toBe('uncapped')
  })

  it('does not flag uncapped when CC has no Copilot seats', () => {
    expect(
      plannerCcHealth({ ...base, affectsCopilot: false, budgetId: null }, null, null),
    ).toBe('ok')
  })

  it('flags under-min when api budget < required floor', () => {
    expect(plannerCcHealth({ ...base, apiAmount: 50 }, 100, null)).toBe('under-min')
  })

  it('uses draft amount when present, not api amount', () => {
    // Saved budget is fine, but a draft would put it below the floor.
    expect(plannerCcHealth({ ...base, apiAmount: 200 }, 100, 50)).toBe('under-min')
    // Draft raises it above the floor.
    expect(plannerCcHealth({ ...base, apiAmount: 50 }, 100, 200)).toBe('ok')
  })

  it('treats requiredMin = 0 as no minimum', () => {
    expect(plannerCcHealth({ ...base, apiAmount: 0 }, 0, null)).toBe('ok')
  })

  it('treats requiredMin = null as no minimum', () => {
    expect(plannerCcHealth({ ...base, apiAmount: 0 }, null, null)).toBe('ok')
  })
})

describe('countByPlannerHealth', () => {
  it('tallies each bucket', () => {
    expect(
      countByPlannerHealth(['uncapped', 'uncapped', 'under-min', 'ok', 'ok', 'ok']),
    ).toEqual({ uncapped: 2, 'under-min': 1, ok: 3 })
  })
})
