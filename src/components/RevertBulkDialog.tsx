import { useState } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { type BulkApplySnapshot } from '@/lib/snapshot'

interface Props {
  snapshot: BulkApplySnapshot | null
  onCancel: () => void
  onConfirm: () => Promise<void> | void
  onDiscard: () => void
}

export function RevertBulkDialog({ snapshot, onCancel, onConfirm, onDiscard }: Props) {
  const [submitting, setSubmitting] = useState(false)

  if (!snapshot) return null

  const appliedAt = new Date(snapshot.appliedAt)
  const totalNew = snapshot.entries.reduce((s, e) => s + e.newAmount, 0)
  const totalPrev = snapshot.entries.reduce((s, e) => s + e.previousAmount, 0)

  return (
    <Dialog open onOpenChange={open => !open && !submitting && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>
          <span className="inline-flex items-center gap-2">
            <ArrowCounterClockwise size={18} weight="duotone" />
            Revert last bulk apply
          </span>
        </DialogTitle>
        <DialogDescription>
          Restore {snapshot.entries.length.toLocaleString()} individual UBB
          {snapshot.entries.length === 1 ? '' : 's'} to the values they held before the bulk
          apply on {appliedAt.toLocaleString()}.
        </DialogDescription>

        <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900 sticky top-0">
              <tr className="text-left text-neutral-500">
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium text-right">Current (post-apply)</th>
                <th className="px-3 py-2 font-medium text-right">Will restore to</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.entries.map(e => (
                <tr key={e.budgetId} className="border-t border-neutral-100 dark:border-neutral-800/60">
                  <td className="px-3 py-1.5 font-medium">{e.user}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">
                    {formatCurrency(e.newAmount)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(e.previousAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-neutral-500 mt-3">
          Total cap: <strong className="text-neutral-900 dark:text-neutral-100">{formatCurrency(totalNew)}</strong>{' '}
          → {formatCurrency(totalPrev)}
        </div>

        <div className="flex items-center justify-between mt-4 gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onDiscard}>
              Discard
            </Button>
          </div>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true)
                try {
                  await onConfirm()
                } finally {
                  setSubmitting(false)
                }
              }}
            >
              {submitting ? 'Reverting…' : `Restore ${snapshot.entries.length.toLocaleString()} budgets`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
