import { useMemo, useState } from 'react'
import { LockOpen } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, cn } from '@/lib/utils'
import { projectMonthlyBudget } from '@/lib/projection'
import type { UserBudget } from '@/lib/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: UserBudget[]
  onApply: (updates: Array<{ id: string; user: string; newAmount: number }>) => Promise<void>
}

interface Row {
  budget: UserBudget
  recommended: number
  override: number | null
}

export function BulkUnblockDialog({ open, onOpenChange, selected, onApply }: Props) {
  const [bufferPct, setBufferPct] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [prevOpen, setPrevOpen] = useState(false)

  // Reset overrides whenever the dialog reopens with a new selection
  if (open && !prevOpen) {
    setPrevOpen(true)
    setOverrides({})
    setBufferPct(5)
    setError(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  const rows: Row[] = useMemo(() => {
    const buffer = bufferPct / 100
    return selected.map(b => {
      const p = projectMonthlyBudget(b.consumedAmount, buffer)
      const override = overrides[b.id] ?? null
      return { budget: b, recommended: p.recommendedBudget, override }
    })
  }, [selected, bufferPct, overrides])

  // Projection details for header summary (use first row's projection metadata)
  const projMeta = useMemo(() => projectMonthlyBudget(0, bufferPct / 100), [bufferPct])

  const totalNew = rows.reduce(
    (sum, r) => sum + (r.override ?? r.recommended),
    0,
  )
  const totalOld = rows.reduce((sum, r) => sum + r.budget.budgetAmount, 0)

  if (selected.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>
          <span className="inline-flex items-center gap-2">
            <LockOpen size={18} weight="duotone" />
            Unblock {selected.length} user{selected.length === 1 ? '' : 's'} for the month
          </span>
        </DialogTitle>
        <DialogDescription>
          Raise each user's individual ULB so they remain unblocked through the end of the
          month. The recommendation projects this month's usage from their current daily
          rate and adds your growth buffer.
        </DialogDescription>

        <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300 mb-3 p-3 rounded-md bg-neutral-100 dark:bg-neutral-800/60">
          <span className="text-neutral-500">Days elapsed</span>
          <span className="tabular-nums">{projMeta.daysElapsed} of {projMeta.daysInMonth}</span>
          <span className="text-neutral-500">Days remaining</span>
          <span className="tabular-nums">{projMeta.daysRemaining}</span>
          <span className="text-neutral-500">Growth buffer</span>
          <span>
            <Input
              type="number"
              min={0}
              max={100}
              step="1"
              value={bufferPct}
              onChange={e => setBufferPct(Math.max(0, Number(e.target.value) || 0))}
              className="inline-block h-7 w-20 text-xs px-2"
            />
            <span className="ml-2 text-neutral-500">%</span>
          </span>
        </div>

        <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900 sticky top-0">
              <tr className="text-left text-neutral-500">
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium text-right">Consumed</th>
                <th className="px-3 py-2 font-medium text-right">Current cap</th>
                <th className="px-3 py-2 font-medium text-right">Recommended</th>
                <th className="px-3 py-2 font-medium text-right">New cap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const final = r.override ?? r.recommended
                const isOverride = r.override !== null && r.override !== r.recommended
                return (
                  <tr key={r.budget.id} className="border-t border-neutral-100 dark:border-neutral-800/60">
                    <td className="px-3 py-1.5 font-medium">{r.budget.user}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(r.budget.consumedAmount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{formatCurrency(r.budget.budgetAmount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      ${r.recommended.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={String(final)}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setOverrides(o => ({ ...o, [r.budget.id]: Number.isFinite(v) ? v : 0 }))
                        }}
                        className={cn(
                          'h-7 w-24 text-xs text-right tabular-nums ml-auto',
                          isOverride && 'border-amber-400 dark:border-amber-600',
                        )}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="text-neutral-500">
            Total cap: {formatCurrency(totalOld)} → <strong className="text-neutral-900 dark:text-neutral-100">{formatCurrency(totalNew)}</strong>
          </div>
          {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={submitting || rows.length === 0}
            onClick={async () => {
              setSubmitting(true)
              setError(null)
              try {
                await onApply(
                  rows.map(r => ({
                    id: r.budget.id,
                    user: r.budget.user,
                    newAmount: r.override ?? r.recommended,
                  })),
                )
                onOpenChange(false)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? 'Applying…' : `Apply ${rows.length} update${rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
