// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FailureList } from '@/components/ConstraintsBannerFailureList'
import type { FailingCheck } from '@/lib/constraintsBannerFailures'

function ccOver(name: string, overBy: number): FailingCheck {
  return {
    kind: 'cc-over',
    message: `Cost center "${name}" is over by ${overBy}`,
    actions: [],
    overBy,
    costCenterName: name,
  }
}

describe('<FailureList />', () => {
  it('renders all items without expander when under the cap', () => {
    const checks: FailingCheck[] = [
      ccOver('alpha', 100),
      ccOver('bravo', 200),
      ccOver('charlie', 50),
    ]
    render(<FailureList checks={checks} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/Showing top/i)).toBeNull()
  })

  it('caps to top 5 + expander with 249 cc-over inputs', () => {
    const checks: FailingCheck[] = []
    for (let i = 0; i < 249; i++) {
      checks.push(ccOver(`cc-${String(i).padStart(3, '0')}`, i + 1))
    }
    render(<FailureList checks={checks} />)
    // Top-5 visible + the expander only (button is the expander; items have no action buttons in this test)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const expander = screen.getByRole('button', { name: /Show all 244 more/ })
    expect(expander).toBeInTheDocument()
    expect(expander).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByText(/Showing top 5 of 249 cost centers over budget/),
    ).toBeInTheDocument()
  })

  it('expands to reveal the remaining 244 on click', () => {
    const checks: FailingCheck[] = []
    for (let i = 0; i < 249; i++) {
      checks.push(ccOver(`cc-${String(i).padStart(3, '0')}`, i + 1))
    }
    render(<FailureList checks={checks} />)
    const expander = screen.getByRole('button', { name: /Show all 244 more/ })
    fireEvent.click(expander)
    expect(screen.getAllByRole('listitem')).toHaveLength(249)
    expect(expander).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: /Hide 244 more/ }),
    ).toBeInTheDocument()
  })

  it('always renders singletons above the cap', () => {
    const checks: FailingCheck[] = [
      {
        kind: 'cc-vs-ent',
        message: 'CC budgets exceed enterprise budget',
        actions: [],
      },
      {
        kind: 'leftover',
        message: 'Leftover users exceed enterprise allowance',
        actions: [],
      },
    ]
    for (let i = 0; i < 10; i++) {
      checks.push(ccOver(`cc-${i}`, i + 1))
    }
    render(<FailureList checks={checks} />)
    expect(
      screen.getByText(/CC budgets exceed enterprise budget/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Leftover users exceed enterprise allowance/),
    ).toBeInTheDocument()
    // 2 singletons + 5 visible cc-over = 7 items before expansion
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('sorts cc-over visible items by overBy desc in the rendered DOM', () => {
    const checks: FailingCheck[] = [
      ccOver('alpha', 50),
      ccOver('bravo', 5000),
      ccOver('charlie', 300),
      ccOver('delta', 9000),
      ccOver('echo', 1),
      ccOver('foxtrot', 100),
    ]
    render(<FailureList checks={checks} />)
    const items = screen.getAllByRole('listitem')
    // 5 visible; the 6th (echo, overBy=1) is hidden
    expect(items).toHaveLength(5)
    const names = items.map(li => within(li).getByText(/Cost center/).textContent)
    expect(names?.[0]).toMatch(/"delta"/)
    expect(names?.[1]).toMatch(/"bravo"/)
    expect(names?.[2]).toMatch(/"charlie"/)
    expect(names?.[3]).toMatch(/"foxtrot"/)
    expect(names?.[4]).toMatch(/"alpha"/)
  })
})
