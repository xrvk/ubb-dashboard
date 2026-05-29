import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserCombobox } from '@/components/ui/user-combobox'
import type { CopilotSeat } from '@/lib/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (username: string, amount: number) => Promise<void>
  seats: CopilotSeat[]
  existingUsernames: Set<string>
}

export function CreateBudgetDialog({ open, onOpenChange, onSubmit, seats, existingUsernames }: Props) {
  const [username, setUsername] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  if (open && !prevOpen) {
    setPrevOpen(true)
    setUsername('')
    setAmount('')
    setError(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  const options = seats.map(s => ({
    login: s.login,
    orgLogin: s.orgLogin,
    disabled: existingUsernames.has(s.login),
    disabledReason: 'already has ULB',
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add individual ULB</DialogTitle>
        <DialogDescription>
          Set a per-user budget cap. Hard stop is always enforced.
        </DialogDescription>
        <div
          role="note"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <strong className="font-medium">Warning:</strong>{' '}
          This becomes the user&apos;s recurring monthly cap. Consider sizing it for a full
          month, not just the remainder.{' '}
          <a
            href="https://docs.github.com/en/billing/concepts/budgets-and-alerts#your-first-billing-cycle-after-creating-a-budget"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:no-underline"
          >
            Learn more
          </a>
        </div>
        <form
          onSubmit={async e => {
            e.preventDefault()
            const n = Number(amount)
            if (!username.trim()) {
              setError('Pick a Copilot user.')
              return
            }
            if (existingUsernames.has(username.trim())) {
              setError(`${username.trim()} already has an individual ULB. Edit it from the table.`)
              return
            }
            if (!Number.isFinite(n) || n < 0) {
              setError('Enter a non-negative number for the budget.')
              return
            }
            setSubmitting(true)
            setError(null)
            try {
              await onSubmit(username.trim(), n)
              onOpenChange(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setSubmitting(false)
            }
          }}
          className="grid gap-3"
        >
          <label className="text-sm grid gap-1">
            <span className="text-neutral-600 dark:text-neutral-400">
              Copilot user
              {seats.length > 0 ? (
                <span className="ml-1 text-xs text-neutral-400">
                  ({seats.length.toLocaleString()} seat{seats.length === 1 ? '' : 's'})
                </span>
              ) : null}
            </span>
            <UserCombobox
              options={options}
              value={username}
              onChange={setUsername}
              placeholder={seats.length > 0 ? 'Search Copilot users…' : 'Type a GitHub username'}
              emptyMessage={
                seats.length === 0
                  ? 'No seat list loaded. Type the username manually.'
                  : 'No matching Copilot users.'
              }
            />
          </label>
          <label className="text-sm grid gap-1">
            <span className="text-neutral-600 dark:text-neutral-400">Budget amount (USD)</span>
            <Input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="50"
            />
          </label>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 mt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
