// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { LoadProgressBanner } from '../components/LoadProgressBanner'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Advance past the banner's 300ms reveal delay and flush React. */
function reveal() {
  act(() => {
    vi.advanceTimersByTime(350)
  })
}

describe('LoadProgressBanner', () => {
  it('stays hidden during the reveal delay (avoids flashing fast loads)', () => {
    render(<LoadProgressBanner loaded={5} total={100} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders count + total with thousands separators for a small enterprise', () => {
    render(<LoadProgressBanner loaded={3200} total={4500} />)
    reveal()
    expect(screen.getByRole('status')).toHaveTextContent('Loading budgets… 3,200 of 4,500')
    expect(screen.queryByText(/Large enterprise/)).toBeNull()
  })

  it('shows the "large enterprise" hint when total exceeds the threshold', () => {
    render(<LoadProgressBanner loaded={1000} total={9800} />)
    reveal()
    expect(screen.getByText(/Large enterprise — initial load may take ~1 min\./)).toBeInTheDocument()
  })

  it('omits the progress bar and uses the loaded-only message when total is unknown', () => {
    const { container } = render(<LoadProgressBanner loaded={42} total={undefined} />)
    reveal()
    expect(screen.getByRole('status')).toHaveTextContent('Loading budgets… 42')
    // No filled progress bar element rendered when total is unknown.
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('switches to "Finalizing…" when budgets are done but loading is still true', () => {
    render(<LoadProgressBanner loaded={500} total={500} />)
    reveal()
    expect(screen.getByRole('status')).toHaveTextContent('Finalizing enterprise data…')
  })
})
