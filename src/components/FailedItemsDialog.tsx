/**
 * Per-item failure inspector for batch operations.
 *
 * Shown after a bulk-apply or bulk-revert finishes with at least one failure.
 * Replaces the old aggregate `"Updated X, failed Y"` toast that gave the user
 * zero visibility into which items failed and why.
 *
 * Features:
 *   - Sortable list (user × status × reason).
 *   - "Retry failures only" re-runs the batch against the failed subset.
 *   - "Export CSV" downloads a file the user can paste into a bug report.
 */

import { useMemo } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/errors'
import { ApiError } from '@/lib/errors'
import type { BatchOutcome } from '@/lib/batch'

export interface FailedItem<T> {
  outcome: BatchOutcome<T>
  /** Display label (typically the username). */
  label: string
}

interface Props<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** All outcomes from runBatch. Component filters to the failures. */
  outcomes: BatchOutcome<T>[]
  /** Extract the label (e.g. username) from an item for display. */
  getLabel: (item: T) => string
  /**
   * Re-run the batch against the failed items. Called with the failed
   * outcomes (callers usually map them back to their input shape). If
   * omitted, the "Retry failures" button is hidden.
   */
  onRetry?: (failedOutcomes: BatchOutcome<T>[]) => Promise<void> | void
  /** CSV filename stem; date stamp gets appended. */
  csvFilename?: string
}

function statusOf(err: unknown): string {
  if (err instanceof ApiError) return err.status === 0 ? err.kind : String(err.status)
  return 'unknown'
}

function reasonOf(err: unknown): string {
  return describeError(err, 'failed-items').body
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(rows: string[][], filename: string): void {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function FailedItemsDialog<T>({
  open,
  onOpenChange,
  title,
  outcomes,
  getLabel,
  onRetry,
  csvFilename = 'ubb-failed-items',
}: Props<T>) {
  const failed = useMemo<FailedItem<T>[]>(
    () => outcomes.filter(o => !o.ok).map(o => ({ outcome: o, label: getLabel(o.item) })),
    [outcomes, getLabel],
  )

  if (failed.length === 0) return null

  const handleExport = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const rows: string[][] = [
      ['user', 'status', 'reason'],
      ...failed.map(f => [f.label, statusOf(f.outcome.error), reasonOf(f.outcome.error)]),
    ]
    downloadCsv(rows, `${csvFilename}-${stamp}.csv`)
    toast.success(`Exported ${failed.length} failed item${failed.length === 1 ? '' : 's'}.`)
  }

  const handleRetry = async () => {
    if (!onRetry) return
    onOpenChange(false)
    try {
      await onRetry(failed.map(f => f.outcome))
    } catch (e) {
      toast.error(describeError(e, 'failed-items-retry').body)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {failed.length.toLocaleString()} item{failed.length === 1 ? '' : 's'} failed. Review the
          status and reason for each, export the list, or retry just the failures.
        </DialogDescription>

        <div className="max-h-80 overflow-y-auto border border-neutral-200 dark:border-neutral-800 rounded text-sm">
          <table className="w-full">
            <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900 text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">User</th>
                <th className="text-left px-3 py-2 font-medium w-20">Status</th>
                <th className="text-left px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((f, i) => (
                <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2 font-mono text-xs">{f.label}</td>
                  <td className="px-3 py-2 text-xs">{statusOf(f.outcome.error)}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                    {reasonOf(f.outcome.error)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button type="button" variant="ghost" onClick={handleExport}>
            Export CSV
          </Button>
          {onRetry ? (
            <Button type="button" variant="outline" onClick={handleRetry}>
              Retry {failed.length.toLocaleString()} failure{failed.length === 1 ? '' : 's'}
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button type="button">Dismiss</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
