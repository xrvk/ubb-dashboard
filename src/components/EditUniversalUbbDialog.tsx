import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import type { UniversalUbb } from '@/lib/api'

interface Props {
  universalUbb: UniversalUbb | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called on submit with the new cap (USD). If `universalUbb` is null the
   * page is expected to call `createUniversalUBB`; otherwise `patchUniversalUBB`.
   */
  onSubmit: (newAmount: number) => Promise<void>
}

export function EditUniversalUbbDialog({ universalUbb, open, onOpenChange, onSubmit }: Props) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  // State-during-render: reset form when dialog opens.
  if (open && !prevOpen) {
    setPrevOpen(true)
    setAmount(universalUbb ? String(universalUbb.budgetAmount) : '')
    setError(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{universalUbb ? 'Edit universal UBB' : 'Create universal UBB'}</DialogTitle>
        <DialogDescription>
          {universalUbb
            ? 'Update the enterprise-wide cap that applies to every user not covered by an individual or cost-center UBB. Hard stop is always enforced.'
            : 'Create the enterprise-wide cap that applies to every user not covered by an individual or cost-center UBB. Hard stop is always enforced.'}
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
            <span className="text-neutral-600 dark:text-neutral-400">Cap (USD)</span>
            <Input
              type="number"
              min={0}
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </label>
          {universalUbb ? (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Current consumed: {formatCurrency(universalUbb.consumedAmount)}
            </div>
          ) : null}
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
