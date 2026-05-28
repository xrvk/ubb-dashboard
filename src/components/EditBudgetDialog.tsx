import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { UserBudget } from '@/lib/api'

interface Props {
  budget: UserBudget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (newAmount: number) => Promise<void>
}

export function EditBudgetDialog({ budget, open, onOpenChange, onSubmit }: Props) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevBudgetId, setPrevBudgetId] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  // State-during-render: reset form when dialog opens for a different budget.
  if (open && budget && (prevBudgetId !== budget.id || !prevOpen)) {
    setPrevBudgetId(budget.id)
    setPrevOpen(true)
    setAmount(String(budget.budgetAmount))
    setError(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  if (!budget) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Edit individual ULB</DialogTitle>
        <DialogDescription>
          Update the budget for <strong>{budget.user}</strong>. Hard stop is always enforced.
        </DialogDescription>
        <form
          onSubmit={async e => {
            e.preventDefault()
            const n = Number(amount)
            if (!Number.isFinite(n) || n < 0) {
              setError('Enter a non-negative number.')
              return
            }
            setSubmitting(true)
            setError(null)
            try {
              await onSubmit(n)
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
            <span className="text-neutral-600 dark:text-neutral-400">Budget amount (USD)</span>
            <Input
              type="number"
              min={0}
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </label>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Current consumed: ${budget.consumedAmount.toFixed(2)}
          </div>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 mt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
