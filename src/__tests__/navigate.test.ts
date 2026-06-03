// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EMPTY_FILTERS } from '../components/BudgetsTable'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
  PLANNER_HIGHLIGHT_EVENT,
  type NavToIndividualDetail,
  type PlannerHighlightDetail,
} from '../lib/navEvents'
import {
  highlightBudgetPlanner,
  navigateToBudgetModel,
  navigateToIndividual,
  navigateToUniversal,
} from '../lib/navigate'

/**
 * The navigate helpers are a thin typed wrapper over CustomEvent dispatch.
 * These tests pin down the contract App.tsx relies on (event name + payload
 * shape) so refactors of either side can't silently drift apart.
 */

interface Captured {
  events: Event[]
}

function captureEvents(name: string): Captured {
  const captured: Captured = { events: [] }
  const handler = (e: Event) => captured.events.push(e)
  window.addEventListener(name, handler)
  afterEach(() => window.removeEventListener(name, handler))
  return captured
}

describe('navigate helpers', () => {
  beforeEach(() => {
    // Make sure each test starts with no listeners from previous tests.
    vi.restoreAllMocks()
  })

  it('navigateToIndividual() with no args dispatches an empty filter event', () => {
    const captured = captureEvents(NAV_TO_INDIVIDUAL_EVENT)
    navigateToIndividual()
    expect(captured.events).toHaveLength(1)
    const detail = (captured.events[0] as CustomEvent<NavToIndividualDetail>).detail
    expect(detail.filter).toEqual(EMPTY_FILTERS)
    expect(detail.task).toBeUndefined()
  })

  it('navigateToIndividual() merges partial filter onto EMPTY_FILTERS', () => {
    const captured = captureEvents(NAV_TO_INDIVIDUAL_EVENT)
    navigateToIndividual({ filter: { bucketIds: ['b100'] } })
    const detail = (captured.events[0] as CustomEvent<NavToIndividualDetail>).detail
    expect(detail.filter.bucketIds).toEqual(['b100'])
    // Other fields must remain at their EMPTY_FILTERS defaults so the
    // destination page doesn't inherit stale filter state from elsewhere.
    expect(detail.filter.status).toBe('all')
    expect(detail.filter.query).toBe('')
    expect(detail.filter.atRiskByEom).toBe(false)
  })

  it('navigateToIndividual() forwards the task payload', () => {
    const captured = captureEvents(NAV_TO_INDIVIDUAL_EVENT)
    navigateToIndividual({
      task: {
        id: 'task-1',
        kind: 'cc-over',
        costCenterId: 'cc-1',
        costCenterName: 'Eng',
        memberCount: 3,
        actualUlbSum: 300,
        ccBudget: 200,
        overBy: 100,
      },
    })
    const detail = (captured.events[0] as CustomEvent<NavToIndividualDetail>).detail
    expect(detail.task?.id).toBe('task-1')
    expect(detail.task?.overBy).toBe(100)
  })

  it('navigateToUniversal() dispatches the universal event', () => {
    const captured = captureEvents(NAV_TO_UNIVERSAL_EVENT)
    navigateToUniversal()
    expect(captured.events).toHaveLength(1)
  })

  it('navigateToBudgetModel() dispatches the budget-model event', () => {
    const captured = captureEvents(NAV_TO_BUDGET_MODEL_EVENT)
    navigateToBudgetModel()
    expect(captured.events).toHaveLength(1)
  })

  it('highlightBudgetPlanner() forwards the highlight target and message', () => {
    const captured = captureEvents(PLANNER_HIGHLIGHT_EVENT)
    highlightBudgetPlanner({ target: 'cc-card', message: 'lower CC budgets' })
    const detail = (captured.events[0] as CustomEvent<PlannerHighlightDetail>).detail
    expect(detail).toEqual({ target: 'cc-card', message: 'lower CC budgets' })
  })
})
