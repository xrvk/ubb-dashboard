import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (username: string, amount: number) => Promise<void>
}

export function CreateBudgetDialog({ open, onOpenChange, onSubmit }: Props) {
  const [username, setUsername] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  // State-during-render: clear form when dialog transitions to open.
  if (open && !prevOpen) {
    setPrevOpen(true)
    setUsername('')
    setAmount('')
    setError(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add individual ULB</DialogTitle>
        <DialogDescription>
          Set a per-user budget cap. Hard stop is always enforced.
        </DialogDescription>
        <form
          onSubmit={async e => {
            e.preventDefault()
            const n = Number(amount)
            if (!username.trim()) {
              setError('Enter a username.')
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
            <span className="text-neutral-600 dark:text-neutral-400">GitHub username</span>
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="octocat" autoFocus />
          </label>
          <label className="text-sm grid gap-1">
            <span className="text-neutral-600 dark:text-neutral-400">Budget amount (USD)</span>
            <Input type="number" min={0} step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50" />
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
