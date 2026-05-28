import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { UserBudget } from '@/lib/api'

interface Props {
  budget: UserBudget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

export function DeleteConfirmDialog({ budget, open, onOpenChange, onConfirm }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!budget) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete individual ULB?</DialogTitle>
        <DialogDescription>
          The budget for <strong>{budget.user}</strong> will be deleted. They will fall back to the universal ULB
          (or no cap if one is not set).
        </DialogDescription>
        {error ? <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p> : null}
        <div className="flex justify-end gap-2 mt-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true)
              setError(null)
              try {
                await onConfirm()
                onOpenChange(false)
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
