import { useEffect, useMemo, useRef, useState } from 'react'
import { LockOpen, Warning, Stop } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, cn } from '@/lib/utils'
import { projectMonthlyBudget } from '@/lib/projection'
import { estimateBatchDurationMs, PRIMARY_LIMIT_PER_HOUR, type BatchProgress } from '@/lib/batch'
import type { UserBudget } from '@/lib/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: UserBudget[]
  onApply: (
    updates: Array<{ id: string; user: string; newAmount: number }>,
    handle: { signal: AbortSignal; onProgress: (p: BatchProgress) => void },
  ) => Promise<void>
}

interface Row {
  budget: UserBudget
  recommended: number
  override: number | null
  lowConfidence: boolean
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remSec}s`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours}h ${remMin}m`
}

export function BulkUnblockDialog({ open, onOpenChange, selected, onApply }: Props) {
  const [bufferText, setBufferText] = useState('5')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [nowTick, setNowTick] = useState<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  // Tick once a second while a batch is running so elapsed/ETA stay live.
  useEffect(() => {
    if (!submitting) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [submitting])

  if (open && !prevOpen) {
    setPrevOpen(true)
    setOverrides({})
    setBufferText('5')
    setError(null)
    setProgress(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  const bufferPct = (() => {
    const n = Number(bufferText)
    return Number.isFinite(n) && n >= 0 ? n : 0
  })()

  const rows: Row[] = useMemo(() => {
    const buffer = bufferPct / 100
    return selected.map(b => {
      const p = projectMonthlyBudget(b.consumedAmount, buffer)
      const override = overrides[b.id] ?? null
      return { budget: b, recommended: p.recommendedBudget, override, lowConfidence: p.lowConfidence }
    })
  }, [selected, bufferPct, overrides])

  const projMeta = useMemo(() => projectMonthlyBudget(0, bufferPct / 100), [bufferPct])

  const totalNew = rows.reduce((sum, r) => sum + (r.override ?? r.recommended), 0)
  const totalOld = rows.reduce((sum, r) => sum + r.budget.budgetAmount, 0)

  const exceedsRateLimit = rows.length > PRIMARY_LIMIT_PER_HOUR
  const estimatedMs = estimateBatchDurationMs(rows.length)

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const handleApply = async () => {
    if (rows.length === 0) return
    setSubmitting(true)
    setError(null)
    setProgress({
      total: rows.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      inFlight: 0,
      retrying: 0,
      startedAt: Date.now(),
    })
    setNowTick(Date.now())
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await onApply(
        rows.map(r => ({
          id: r.budget.id,
          user: r.budget.user,
          newAmount: r.override ?? r.recommended,
        })),
        { signal: controller.signal, onProgress: setProgress },
      )
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setSubmitting(false)
    }
  }

  if (selected.length === 0) return null

  // ETA during apply (recomputed every tick)
  const elapsedMs = progress && nowTick ? nowTick - progress.startedAt : 0
  const liveEta = (() => {
    if (!progress || progress.completed === 0 || elapsedMs <= 0) return null
    const perTask = elapsedMs / progress.completed
    return perTask * (progress.total - progress.completed)
  })()

  const percent = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0

  return (
    <Dialog
      open={open}
      onOpenChange={open => {
        if (submitting && !open) return // block close while running
        onOpenChange(open)
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogTitle>
          <span className="inline-flex items-center gap-2">
            <LockOpen size={18} weight="duotone" />
            Unblock {selected.length.toLocaleString()} user{selected.length === 1 ? '' : 's'} for the month
          </span>
        </DialogTitle>
        <DialogDescription>
          Raise each user's individual ULB so they remain unblocked through month-end. The
          recommendation projects this month's usage from their current daily rate and adds
          your growth buffer.
        </DialogDescription>

        {/* Projection inputs */}
        <div className="grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300 mb-3 p-3 rounded-md bg-neutral-100 dark:bg-neutral-800/60">
          <span className="text-neutral-500">Days elapsed</span>
          <span className="tabular-nums">{projMeta.daysElapsed} of {projMeta.daysInMonth}</span>
          <span className="text-neutral-500">Days remaining</span>
          <span className="tabular-nums">{projMeta.daysRemaining}</span>
          <span className="text-neutral-500">Growth buffer</span>
          <span className="inline-flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              value={bufferText}
              onChange={e => setBufferText(e.target.value.replace(/[^0-9.]/g, ''))}
              disabled={submitting}
              className="h-7 w-20 text-xs px-2"
            />
            <span className="text-neutral-500">%</span>
          </span>
        </div>

        {/* Rate limit pre-flight */}
        {exceedsRateLimit ? (
          <div className="flex items-start gap-2 text-xs mb-3 p-3 rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40">
            <Warning size={16} weight="duotone" className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <strong className="text-amber-900 dark:text-amber-100">
                {rows.length.toLocaleString()} updates exceed GitHub's 5,000 req/hr classic-PAT
                limit.
              </strong>
              <p className="text-amber-800 dark:text-amber-200 mt-1">
                The batch will pause for 60s when it hits a 429 and resume automatically. Plan
                for this taking at least an hour.
              </p>
            </div>
          </div>
        ) : rows.length >= 100 ? (
          <div className="text-xs mb-3 px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300">
            Estimated time: <strong>{formatDuration(estimatedMs)}</strong> at 5 in flight, 50ms
            spacing. The runner backs off automatically on 429s.
          </div>
        ) : null}

        {/* Rows preview / progress */}
        {progress ? (
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-md p-4 mb-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <strong>
                {progress.completed.toLocaleString()} of {progress.total.toLocaleString()} ({percent}%)
              </strong>
              <span className="text-xs text-neutral-500 tabular-nums">
                {progress.succeeded.toLocaleString()} ok · {progress.failed.toLocaleString()} failed
                {progress.retrying > 0 ? ` · ${progress.retrying} waiting` : ''}
              </span>
            </div>
            <div className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-neutral-500 mt-2 tabular-nums">
              <span>Elapsed {formatDuration(elapsedMs)}</span>
              {liveEta !== null ? <span>≈ {formatDuration(liveEta)} remaining</span> : null}
            </div>
            {progress.retrying > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                Paused for rate limit. Waiting for GitHub to lift the throttle…
              </p>
            ) : null}
          </div>
        ) : (
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-72 overflow-auto mb-3">
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
                      <td className="px-3 py-1.5 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {r.budget.user}
                          {r.lowConfidence ? (
                            <span
                              title="Recommendation is based on fewer than 5 days of usage. Review before applying."
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            >
                              low confidence
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(r.budget.consumedAmount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{formatCurrency(r.budget.budgetAmount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                        ${r.recommended.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*\.?[0-9]*"
                          value={String(final)}
                          onChange={e => {
                            const s = e.target.value.replace(/[^0-9.]/g, '')
                            const v = Number(s)
                            setOverrides(o => ({ ...o, [r.budget.id]: Number.isFinite(v) ? v : 0 }))
                          }}
                          disabled={submitting}
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
        )}

        <div className="flex items-center justify-between text-xs">
          <div className="text-neutral-500">
            Total cap: {formatCurrency(totalOld)} →{' '}
            <strong className="text-neutral-900 dark:text-neutral-100">{formatCurrency(totalNew)}</strong>
          </div>
          {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-start gap-2 text-xs mt-3 p-3 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
          <Warning size={16} weight="duotone" className="text-neutral-500 dark:text-neutral-400 mt-0.5 shrink-0" />
          <p className="text-neutral-700 dark:text-neutral-200">
            This only raises individual ULBs. Cost center and enterprise budgets can still
            block these users before they reach their new ULB ceiling.
          </p>
        </div>

        <details className="mt-2 text-xs text-neutral-600 dark:text-neutral-300 group">
          <summary className="cursor-pointer select-none inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
            How is the recommendation calculated?
          </summary>
          <div className="mt-2 p-3 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 space-y-2">
            <p>For each user we project this month's full spend from their current pace, then add the growth buffer:</p>
            <pre className="text-[11px] leading-relaxed tabular-nums whitespace-pre-wrap font-mono bg-white dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-700">
{`daily_rate    = consumed_so_far / days_elapsed
projected     = consumed_so_far + daily_rate × days_remaining
recommended   = ceil( projected × (1 + buffer / 100) )`}
            </pre>
            <p>
              Calendar days are used on both sides, so weekend / holiday patterns largely
              cancel out. The result is rounded up to whole dollars so cents can't re-block
              the user.
            </p>
            <p>
              The <strong className="text-amber-700 dark:text-amber-300">low confidence</strong> tag appears
              when fewer than 5 days have elapsed, since short windows make the daily rate noisy.
              Review those rows before applying.
            </p>
          </div>
        </details>

        <div className="flex justify-end gap-2 mt-4">
          {submitting ? (
            <Button type="button" variant="destructive" onClick={handleCancel}>
              <Stop size={14} weight="fill" />
              Cancel
            </Button>
          ) : (
            <DialogClose asChild>
              <Button type="button" variant="ghost">Close</Button>
            </DialogClose>
          )}
          <Button type="button" disabled={submitting || rows.length === 0} onClick={handleApply}>
            {submitting
              ? 'Applying…'
              : `Apply ${rows.length.toLocaleString()} update${rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
