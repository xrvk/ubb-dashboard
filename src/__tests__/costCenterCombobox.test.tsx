// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  CostCenterCombobox,
  type CostCenterOption,
} from '@/components/ui/cost-center-combobox'

function makeOptions(n: number, withSentinels = true): CostCenterOption[] {
  const opts: CostCenterOption[] = []
  if (withSentinels) {
    opts.push({ id: '', label: 'All cost centers', count: n, emphasis: true })
    opts.push({ id: '__unassigned__', label: 'Unassigned', count: 3 })
  }
  for (let i = 0; i < n; i++) {
    opts.push({ id: `cc-${i}`, label: `team-${String(i).padStart(3, '0')}`, count: i + 1 })
  }
  return opts
}

describe('<CostCenterCombobox />', () => {
  it('displays the selected option label when closed', () => {
    const opts = makeOptions(5)
    render(<CostCenterCombobox options={opts} value="cc-2" onChange={() => {}} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('team-002')
  })

  it('opens the listbox on focus and shows all options when query is empty', () => {
    const opts = makeOptions(5)
    render(<CostCenterCombobox options={opts} value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    const listbox = screen.getByRole('listbox')
    // 1 "All" + 1 "Unassigned" + 5 team-*** = 7
    expect(within(listbox).getAllByRole('option')).toHaveLength(7)
  })

  it('filters options as the user types', () => {
    const opts = makeOptions(20)
    render(<CostCenterCombobox options={opts} value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'team-01' } })
    const listbox = screen.getByRole('listbox')
    const labels = within(listbox).getAllByRole('option').map(o => o.textContent ?? '')
    // team-010..team-019 = 10 matches
    expect(labels.filter(l => l.startsWith('team-01'))).toHaveLength(10)
    // sentinels filtered out
    expect(labels.some(l => l.startsWith('All cost centers'))).toBe(false)
  })

  it('filters by id too (e.g., searching the raw CC slug)', () => {
    const opts = makeOptions(10)
    render(<CostCenterCombobox options={opts} value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'cc-7' } })
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    expect(within(listbox).getByRole('option').textContent).toContain('team-007')
  })

  it('fires onChange with the option id when an item is clicked', () => {
    const opts = makeOptions(5)
    const onChange = vi.fn()
    render(<CostCenterCombobox options={opts} value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    const teamOpt = screen.getByRole('option', { name: /team-003/ })
    fireEvent.mouseDown(teamOpt)
    expect(onChange).toHaveBeenCalledWith('cc-3')
  })

  it('caps the rendered list to 50 and shows a "keep typing" hint with 249 options', () => {
    const opts = makeOptions(249, false)
    render(<CostCenterCombobox options={opts} value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(50)
    expect(within(listbox).getByText(/Showing first 50 of 249/)).toBeInTheDocument()
  })

  it('does not show the "keep typing" hint when the filter trims under the cap', () => {
    const opts = makeOptions(249, false)
    render(<CostCenterCombobox options={opts} value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'team-00' } })
    const listbox = screen.getByRole('listbox')
    // team-000..team-009 = 10
    expect(within(listbox).getAllByRole('option')).toHaveLength(10)
    expect(within(listbox).queryByText(/Showing first/)).toBeNull()
  })

  it('shows the empty message when nothing matches', () => {
    const opts = makeOptions(5)
    render(
      <CostCenterCombobox
        options={opts}
        value=""
        onChange={() => {}}
        emptyMessage="No matches"
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'zzz-no-such-thing' } })
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('Enter selects the first filtered option and closes the listbox', () => {
    const opts = makeOptions(20)
    const onChange = vi.fn()
    render(<CostCenterCombobox options={opts} value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'team-013' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('cc-13')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape closes the listbox without firing onChange', () => {
    const opts = makeOptions(5)
    const onChange = vi.fn()
    render(<CostCenterCombobox options={opts} value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders an onClear button when provided and invokes it on click', () => {
    const opts = makeOptions(5)
    const onClear = vi.fn()
    render(
      <CostCenterCombobox
        options={opts}
        value="cc-2"
        onChange={() => {}}
        onClear={onClear}
      />,
    )
    const clearBtn = screen.getByRole('button', { name: /Clear cost center filter/i })
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('omits the clear button when no onClear is provided', () => {
    const opts = makeOptions(5)
    render(<CostCenterCombobox options={opts} value="cc-2" onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /Clear cost center/i })).toBeNull()
  })
})
