// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IndUlbStatusDonut, UTIL_BANDS, bandForBudget } from '../components/IndUlbStatusDonut'
import { NAV_TO_INDIVIDUAL_EVENT, type NavToIndividualDetail } from '../lib/navEvents'
import type { UserBudget } from '../lib/api'

/**
 * Fixture helpers — produce UserBudgets at a chosen utilization ratio so
 * the bucket → band mapping is exercised end-to-end.
 */
function ub(consumed: number, amount: number): UserBudget {
  return {
    id: `b-${consumed}-${amount}`,
    user: `user-${consumed}-${amount}`,
    budgetAmount: amount,
    consumedAmount: consumed,
    scope: 'user',
    productType: 'ai_credits',
    blockOnOverage: true,
  } as unknown as UserBudget
}

const okUsers = [ub(0, 100), ub(40, 100), ub(70, 100)]      // 0%, 40%, 70%
const nearUsers = [ub(85, 100), ub(95, 100)]                 // 85%, 95%
const atUsers = [ub(100, 100), ub(120, 100), ub(50, 0)]      // 100%, 120%, 0-budget-with-spend → at

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bandForBudget', () => {
  it.each([
    [0, 100, 'ok'],
    [70, 100, 'ok'],
    [79.99, 100, 'ok'],
    [80, 100, 'near'],
    [99.99, 100, 'near'],
    [100, 100, 'at'],
    [120, 100, 'at'],
    [50, 0, 'at'],
  ])('consumed=%s budget=%s → band %s', (consumed, amount, expected) => {
    expect(bandForBudget(ub(consumed, amount)).id).toBe(expected)
  })
})

describe('UTIL_BANDS bucket coverage', () => {
  it('the three bands together cover every UTIL_BUCKETS id exactly once', () => {
    const all = UTIL_BANDS.flatMap(b => b.bucketIds)
    const unique = new Set(all)
    expect(all).toHaveLength(unique.size)
    expect(unique).toEqual(new Set(['b0-50', 'b50-80', 'b80-90', 'b90-100', 'b100']))
  })
})

describe('IndUlbStatusDonut', () => {
  it('renders the total user count somewhere (legend caption uses it too)', () => {
    render(<IndUlbStatusDonut budgets={[...okUsers, ...nearUsers, ...atUsers]} />)
    // total = 8. The chart center renders via ResponsiveContainer, which is
    // sized 0×0 in JSDOM so the SVG <text> may not paint — assert via the
    // legend caption text instead, which is plain DOM.
    expect(screen.getByText(/5 of 8 users are near or at/i)).toBeInTheDocument()
  })

  it('shows an empty-state CTA when there are no individual ULBs', () => {
    const events: NavToIndividualDetail[] = []
    window.addEventListener(NAV_TO_INDIVIDUAL_EVENT, e => {
      events.push((e as CustomEvent<NavToIndividualDetail>).detail)
    })

    render(<IndUlbStatusDonut budgets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Go to Individual ULBs/i }))
    expect(events).toHaveLength(1)
    expect(events[0].filter.bucketIds).toBeNull()
  })

  it('renders one clickable legend row per band with the right counts', () => {
    render(<IndUlbStatusDonut budgets={[...okUsers, ...nearUsers, ...atUsers]} />)
    const ok = screen.getByRole('button', { name: /Filter Individual ULBs to OK \(3 users\)/i })
    const near = screen.getByRole('button', { name: /Filter Individual ULBs to Near cap \(2 users\)/i })
    const at = screen.getByRole('button', { name: /Filter Individual ULBs to At cap \(3 users\)/i })
    // Each legend row shows percent first (primary), then "<count> users" as
    // the secondary line. Totals: 3/8 = 38%, 2/8 = 25%, 3/8 = 38%.
    expect(within(ok).getByText('38%')).toBeInTheDocument()
    expect(within(ok).getByText('3 users')).toBeInTheDocument()
    expect(within(near).getByText('25%')).toBeInTheDocument()
    expect(within(near).getByText('2 users')).toBeInTheDocument()
    expect(within(at).getByText('38%')).toBeInTheDocument()
    expect(within(at).getByText('3 users')).toBeInTheDocument()
  })

  it('clicking a band dispatches a navigate event with that band\'s bucketIds', () => {
    const events: NavToIndividualDetail[] = []
    window.addEventListener(NAV_TO_INDIVIDUAL_EVENT, e => {
      events.push((e as CustomEvent<NavToIndividualDetail>).detail)
    })

    render(<IndUlbStatusDonut budgets={[...okUsers, ...nearUsers, ...atUsers]} />)
    fireEvent.click(screen.getByRole('button', { name: /Filter Individual ULBs to Near cap/i }))

    expect(events).toHaveLength(1)
    // "Near cap" must carry both 80-90 AND 90-100 buckets — losing either
    // would silently hide users from the deep-linked view.
    expect(events[0].filter.bucketIds).toEqual(['b80-90', 'b90-100'])
    // Mutually exclusive with status: nav must not arrive with stale state.
    expect(events[0].filter.status).toBe('all')
  })
})
