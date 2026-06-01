// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EnvelopeCheckCard } from '../components/EnvelopeCheckCard'
import { buildCostCenterIndex } from '../lib/api'
import type {
  ComputeBudgetConstraintsInput,
} from '../lib/budgetConstraints'
import type {
  CopilotSeat,
  CostCenter,
  CostCenterBudget,
  CostCenterIndex,
  EnterpriseBudget,
  UserBudget,
} from '../lib/api'
import { NAV_TO_BUDGET_MODEL_EVENT } from '../lib/navEvents'

const seat = (login: string, orgLogin: string | null = 'org1'): CopilotSeat => ({
  login,
  orgLogin,
  lastActivityAt: null,
  planType: null,
})

const cc = (id: string, name: string, resources: CostCenter['resources'] = []): CostCenter => ({
  id,
  name,
  state: 'active',
  resources,
})

const ccBudget = (id: string, name: string, amount: number): CostCenterBudget => ({
  id,
  costCenterName: name,
  budgetAmount: amount,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const entBudget = (amount: number, excludeCostCenterUsage = false): EnterpriseBudget => ({
  id: 'ent-1',
  budgetAmount: amount,
  excludeCostCenterUsage,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const userBudget = (login: string, amount: number): UserBudget => ({
  id: `ub-${login}`,
  user: login,
  budgetAmount: amount,
  consumedAmount: 0,
  preventFurtherUsage: true,
  willAlert: false,
  alertRecipients: [],
})

const buildIndex = (overrides: Partial<CostCenterIndex> = {}): CostCenterIndex => ({
  userToCC: new Map(),
  orgToCC: new Map(),
  orgBudgetedCollisions: [],
  ...overrides,
})

const baseInput = (
  overrides: Partial<ComputeBudgetConstraintsInput> = {},
): ComputeBudgetConstraintsInput => ({
  enterpriseBudget: null,
  universalUlb: null,
  costCenters: [],
  costCenterIndex: buildIndex(),
  ccBudgetsByName: new Map(),
  seats: [],
  userBudgets: [],
  ...overrides,
})

describe('EnvelopeCheckCard', () => {
  it('renders nothing when there is no enterprise or CC envelope', () => {
    const { container } = render(
      <EnvelopeCheckCard
        proposedUsd={10}
        constraintsInput={baseInput({ seats: [seat('alice')] })}
        onSnapToMaxSafe={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the green within-envelope state when the proposal fits', () => {
    render(
      <EnvelopeCheckCard
        proposedUsd={5}
        constraintsInput={baseInput({
          enterpriseBudget: entBudget(500),
          seats: Array.from({ length: 10 }, (_, i) => seat(`u${i}`)),
        })}
        onSnapToMaxSafe={() => {}}
      />,
    )
    expect(screen.getByText(/within enterprise envelope/i)).toBeInTheDocument()
    expect(screen.getByText(/headroom/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap ulb to max safe/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /raise enterprise budget/i })).toBeNull()
  })

  it('shows red state and a snap button that fires onSnapToMaxSafe with a whole dollar', () => {
    const onSnap = vi.fn()
    render(
      <EnvelopeCheckCard
        proposedUsd={20}
        // 100 seats × $20 = $2000 against a $500 ent budget. Max safe = $5.
        constraintsInput={baseInput({
          enterpriseBudget: entBudget(500),
          seats: Array.from({ length: 100 }, (_, i) => seat(`u${i}`)),
        })}
        onSnapToMaxSafe={onSnap}
      />,
    )
    expect(screen.getByText(/exceeds the enterprise envelope/i)).toBeInTheDocument()
    expect(screen.getByText(/over by/i)).toBeInTheDocument()
    const snap = screen.getByRole('button', { name: /snap ulb to max safe/i })
    fireEvent.click(snap)
    expect(onSnap).toHaveBeenCalledWith(5)
  })

  it('hides the snap button when max safe is 0 (envelope already fully consumed)', () => {
    render(
      <EnvelopeCheckCard
        proposedUsd={1}
        constraintsInput={baseInput({
          enterpriseBudget: entBudget(500),
          seats: [seat('alice'), seat('bob')],
          userBudgets: [userBudget('alice', 500)],
        })}
        onSnapToMaxSafe={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /snap ulb to max safe/i })).toBeNull()
    // Raise enterprise budget remains as the actionable remediation.
    expect(screen.getByRole('button', { name: /raise enterprise budget/i })).toBeInTheDocument()
  })

  it('does not surface pre-existing failures the proposed ULB did not cause', () => {
    // Pre-existing breach: an individual ULB already exceeds the small ent
    // budget. The proposed universal ULB on a NEW seat is well within
    // headroom relative to baseline (baseline already over), so the card
    // should not blame the proposal.
    const seats: CopilotSeat[] = [seat('alice'), seat('bob')]
    const input = baseInput({
      enterpriseBudget: entBudget(100),
      seats,
      userBudgets: [userBudget('alice', 500)],
    })
    render(
      <EnvelopeCheckCard
        proposedUsd={1}
        constraintsInput={input}
        onSnapToMaxSafe={() => {}}
      />,
    )
    // Baseline leftover = 500 (alice). Preview leftover = 500 + 1 = 501.
    // Preview is worse than baseline so the card SHOULD flag this small
    // contribution. To exercise the "not blamed" branch we need the
    // proposed ULB to not increase leftover. Use a seat that's already
    // covered by an individual ULB → no contribution from the universal.
    // (Re-test with only alice, who has an ind ULB.)
    const noContribution = baseInput({
      enterpriseBudget: entBudget(100),
      seats: [seat('alice')],
      userBudgets: [userBudget('alice', 500)],
    })
    const { container } = render(
      <EnvelopeCheckCard
        proposedUsd={50}
        constraintsInput={noContribution}
        onSnapToMaxSafe={() => {}}
      />,
    )
    // Should render the green within-envelope state because the proposed
    // ULB does not change leftover.actual (alice's ind ULB covers her).
    expect(container.textContent).toMatch(/within enterprise envelope/i)
  })

  it('navigates to the budget model when Raise enterprise budget is clicked', () => {
    const handler = vi.fn()
    window.addEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
    try {
      render(
        <EnvelopeCheckCard
          proposedUsd={20}
          constraintsInput={baseInput({
            enterpriseBudget: entBudget(500),
            seats: Array.from({ length: 100 }, (_, i) => seat(`u${i}`)),
          })}
          onSnapToMaxSafe={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /raise enterprise budget/i }))
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
    }
  })

  it('flags a per-CC breach without offering Raise enterprise when ent is fine', () => {
    // CC budget is the only failing envelope. Raising ent doesn't help —
    // the card should suppress that action and rely on snap-to-safe.
    const ccA = cc('cc1', 'ccA', [{ type: 'User', name: 'alice' }, { type: 'User', name: 'bob' }])
    const seats: CopilotSeat[] = [seat('alice'), seat('bob'), seat('carol')]
    const input = baseInput({
      enterpriseBudget: entBudget(10_000),
      costCenters: [ccA],
      costCenterIndex: buildCostCenterIndex([ccA], new Map([['cca', ccBudget('ccb1', 'ccA', 50)]])),
      ccBudgetsByName: new Map([['cca', ccBudget('ccb1', 'ccA', 50)]]),
      seats,
    })
    render(
      <EnvelopeCheckCard
        proposedUsd={100}
        constraintsInput={input}
        onSnapToMaxSafe={() => {}}
      />,
    )
    expect(screen.getByText(/exceeds a cost-center budget/i)).toBeInTheDocument()
    expect(screen.getByText(/ccA/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /raise enterprise budget/i })).toBeNull()
  })
})
