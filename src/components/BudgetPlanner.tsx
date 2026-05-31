import { useMemo, useState } from 'react'
import {
  Buildings,
  Stack,
  CaretDown,
  CaretUp,
  CheckCircle,
  Warning,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog'
import { useCredentials } from '@/hooks/use-credentials'
import { formatCurrency, cn } from '@/lib/utils'
import { patchEnterpriseBudget, patchCostCenterBudget } from '@/lib/api'
import { runBatch } from '@/lib/batch'

type Draft = Map<string, string> // key: 'ent' or `cc:<budgetId>`

interface PendingChange {
  key: string
  scope: 'enterprise' | 'cost_center'
  name: string
  budgetId: string
  before: number
  after: number
}

/**
 * Editable mirror of the enterprise + cost-center ai_credits budgets, with a
 * single "Apply changes" action that PATCHes the diffs in a rate-limited batch.
 * Mirrors CCC's BudgetPlanner pattern but reuses our card/button/input idiom
 * from UniversalUlbPage.
 */
export function BudgetPlanner() {
  const {
    enterpriseBudget,
    costCenterBudgetsByName,
    costCenters,
    loginToCostCenter,
    apiFetch,
    refresh,
  } = useCredentials()

  // Editable drafts keyed by budget id (or 'ent'). Values are raw strings so
  // we can let users type freely; we parse + validate at apply time.
  const [drafts, setDrafts] = useState<Draft>(new Map())
  // Track the source-of-truth signature so we can reset drafts (without an
  // effect) whenever the underlying budgets change — e.g. after refresh().
  const sourceSig = `${enterpriseBudget?.id ?? ''}|${enterpriseBudget?.budgetAmount ?? ''}|${costCenterBudgetsByName.size}`
  const [lastSig, setLastSig] = useState(sourceSig)
  if (sourceSig !== lastSig) {
    setLastSig(sourceSig)
    setDrafts(new Map())
  }

  const [showAll, setShowAll] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [lastAppliedAt, setLastAppliedAt] = useState<number | null>(null)

  // Which cost centers actually route Copilot today?
  const ccIdsAffectingCopilot = useMemo(() => {
    const set = new Set<string>()
    for (const r of loginToCostCenter.values()) {
      if (r) set.add(r.cc.id)
    }
    return set
  }, [loginToCostCenter])

  // Build the editable rows. A row only exists if the CC has an ai_credits
  // budget (no-budget CCs have nothing to patch — show them disabled).
  interface Row {
    key: string
    ccId: string
    name: string
    budgetId: string | null
    apiAmount: number
    preventFurtherUsage: boolean
    seatCount: number
    affectsCopilot: boolean
  }
  const rows: Row[] = useMemo(() => {
    const seatsByCcId = new Map<string, number>()
    for (const r of loginToCostCenter.values()) {
      if (!r) continue
      seatsByCcId.set(r.cc.id, (seatsByCcId.get(r.cc.id) ?? 0) + 1)
    }
    const named = costCenters.filter(cc => cc.name.trim().length > 0)
    return named
      .map(cc => {
        const b = costCenterBudgetsByName.get(cc.name.toLowerCase())
        return {
          key: b ? `cc:${b.id}` : `cc-nobudget:${cc.id}`,
          ccId: cc.id,
          name: cc.name,
          budgetId: b?.id ?? null,
          apiAmount: b?.budgetAmount ?? 0,
          preventFurtherUsage: b?.preventFurtherUsage ?? false,
          seatCount: seatsByCcId.get(cc.id) ?? 0,
          affectsCopilot: ccIdsAffectingCopilot.has(cc.id),
        }
      })
      .sort((a, b) => {
        if (a.affectsCopilot !== b.affectsCopilot) return a.affectsCopilot ? -1 : 1
        if (!!a.budgetId !== !!b.budgetId) return a.budgetId ? -1 : 1
        if (a.apiAmount !== b.apiAmount) return b.apiAmount - a.apiAmount
        return a.name.localeCompare(b.name)
      })
  }, [costCenters, costCenterBudgetsByName, ccIdsAffectingCopilot])

  const affectingCount = rows.filter(r => r.affectsCopilot).length
  const notAffectingCount = rows.length - affectingCount
  const visibleRows = showAll ? rows : rows.filter(r => r.affectsCopilot)

  // --- Diff calculation ---
  const pending: PendingChange[] = useMemo(() => {
    const out: PendingChange[] = []

    if (enterpriseBudget) {
      const draft = drafts.get('ent')
      if (draft !== undefined) {
        const n = Number(draft)
        if (Number.isFinite(n) && n >= 0 && n !== enterpriseBudget.budgetAmount) {
          out.push({
            key: 'ent',
            scope: 'enterprise',
            name: 'Enterprise budget',
            budgetId: enterpriseBudget.id,
            before: enterpriseBudget.budgetAmount,
            after: n,
          })
        }
      }
    }

    for (const row of rows) {
      if (!row.budgetId) continue
      const draft = drafts.get(row.key)
      if (draft === undefined) continue
      const n = Number(draft)
      if (!Number.isFinite(n) || n < 0) continue
      if (n === row.apiAmount) continue
      out.push({
        key: row.key,
        scope: 'cost_center',
        name: row.name,
        budgetId: row.budgetId,
        before: row.apiAmount,
        after: n,
      })
    }
    return out
  }, [drafts, rows, enterpriseBudget])

  // --- Field-level invalid (negative, NaN) tracking for input styling ---
  const isInvalid = (key: string, apiAmount: number): boolean => {
    const v = drafts.get(key)
    if (v === undefined) return false
    if (v.trim() === '') return true
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return true
    return n !== apiAmount // surfaces "dirty" via different styling, but only invalid styling is red
  }

  // Just a tri-state classifier for the input border.
  const inputState = (key: string, apiAmount: number): 'clean' | 'dirty' | 'invalid' => {
    const v = drafts.get(key)
    if (v === undefined) return 'clean'
    if (v.trim() === '') return 'invalid'
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return 'invalid'
    return n === apiAmount ? 'clean' : 'dirty'
  }

  const setDraft = (key: string, value: string) => {
    setDrafts(prev => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }

  const resetField = (key: string) => {
    setDrafts(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  const handleDiscardAll = () => {
    setDrafts(new Map())
    setApplyError(null)
  }

  const handleApply = async () => {
    if (pending.length === 0) return
    if (!apiFetch) {
      setApplyError('Not connected to GitHub.')
      return
    }
    const fetcher = apiFetch
    setApplying(true)
    setApplyError(null)
    try {
      const outcomes = await runBatch(pending, async change => {
        if (change.scope === 'enterprise') {
          await patchEnterpriseBudget(fetcher, change.budgetId, change.after)
        } else {
          await patchCostCenterBudget(fetcher, change.budgetId, change.after)
        }
      })
      const failed = outcomes.filter(o => !o.ok)
      if (failed.length > 0) {
        setApplyError(
          `${failed.length} of ${outcomes.length} update${outcomes.length === 1 ? '' : 's'} failed. ` +
            failed
              .slice(0, 3)
              .map(f => `${f.item.name}: ${f.error instanceof Error ? f.error.message : 'error'}`)
              .join(' · '),
        )
      } else {
        setLastAppliedAt(Date.now())
      }
      await refresh()
      setConfirmOpen(false)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const hasEnterprise = !!enterpriseBudget

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Buildings size={14} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
              Budget planner
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Adjust the enterprise budget and individual cost-center budgets, then apply
              the diff to GitHub. The structure diagram above reflects the saved state.
            </p>
          </div>
          {lastAppliedAt && pending.length === 0 ? (
            <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 shrink-0">
              <CheckCircle size={12} weight="fill" />
              Synced
            </div>
          ) : null}
        </div>

        {/* Enterprise budget */}
        {!hasEnterprise ? (
          <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
            No enterprise ai_credits budget configured — nothing to plan against yet.
          </div>
        ) : (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Enterprise budget</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Currently {formatCurrency(enterpriseBudget.budgetAmount)} ·{' '}
                {enterpriseBudget.excludeCostCenterUsage ? 'Cost center exclusion on · ' : ''}
                {enterpriseBudget.preventFurtherUsage ? 'Hard cap' : 'Soft cap'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-neutral-500">$</span>
              <Input
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                value={drafts.get('ent') ?? String(enterpriseBudget.budgetAmount)}
                onChange={e => setDraft('ent', e.target.value)}
                className={cn(
                  'w-36 text-right font-mono',
                  inputState('ent', enterpriseBudget.budgetAmount) === 'dirty' && 'border-amber-500 dark:border-amber-400',
                  isInvalid('ent', enterpriseBudget.budgetAmount) && inputState('ent', enterpriseBudget.budgetAmount) === 'invalid' && 'border-red-500 dark:border-red-400',
                )}
              />
              {drafts.get('ent') !== undefined && (
                <button
                  type="button"
                  onClick={() => resetField('ent')}
                  className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  title="Reset to saved value"
                  aria-label="Reset enterprise budget"
                >
                  <ArrowCounterClockwise size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cost-center budgets */}
        {rows.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
              <div className="flex items-center gap-1.5 font-medium">
                <Stack size={12} weight="duotone" />
                {showAll
                  ? `All ${rows.length} cost center${rows.length === 1 ? '' : 's'}`
                  : `${affectingCount} cost center${affectingCount === 1 ? '' : 's'} affecting Copilot`}
              </div>
              {notAffectingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(v => !v)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal opacity-75 hover:opacity-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
                  aria-expanded={showAll}
                >
                  {showAll
                    ? `Hide ${notAffectingCount} not affecting Copilot`
                    : `Show ${notAffectingCount} not affecting Copilot`}
                  {showAll ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />}
                </button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100/60 dark:bg-neutral-900/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-1.5 font-medium">Cost center</th>
                    <th className="px-3 py-1.5 font-medium text-right">Seats</th>
                    <th className="px-3 py-1.5 font-medium text-right w-44">Budget ($)</th>
                    <th className="px-3 py-1.5 font-medium">Enforcement</th>
                    <th className="px-3 py-1.5 font-medium w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(row => {
                    const state = row.budgetId ? inputState(row.key, row.apiAmount) : 'clean'
                    const draftVal = drafts.get(row.key)
                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          'border-t border-neutral-200 dark:border-neutral-800',
                          !row.affectsCopilot && 'opacity-60',
                        )}
                      >
                        <td className="px-3 py-1.5 font-medium">
                          {row.name}
                          {!row.affectsCopilot && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-500">no Copilot seats</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-neutral-600 dark:text-neutral-400">
                          {row.seatCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.budgetId ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-sm text-neutral-500">$</span>
                              <Input
                                type="number"
                                min={0}
                                step="1"
                                inputMode="numeric"
                                value={draftVal ?? String(row.apiAmount)}
                                onChange={e => setDraft(row.key, e.target.value)}
                                className={cn(
                                  'h-7 w-28 text-right font-mono px-2',
                                  state === 'dirty' && 'border-amber-500 dark:border-amber-400',
                                  state === 'invalid' && 'border-red-500 dark:border-red-400',
                                )}
                              />
                            </div>
                          ) : (
                            <div className="text-right text-neutral-500 italic">No CC budget</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {row.budgetId ? (
                            row.preventFurtherUsage ? (
                              <span className="text-emerald-700 dark:text-emerald-400">Hard cap</span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">Soft cap</span>
                            )
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {row.budgetId && draftVal !== undefined ? (
                            <button
                              type="button"
                              onClick={() => resetField(row.key)}
                              className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                              title="Reset to saved value"
                              aria-label={`Reset ${row.name}`}
                            >
                              <ArrowCounterClockwise size={12} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Review & apply footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-xs text-neutral-600 dark:text-neutral-400 min-w-0">
            {pending.length === 0 ? (
              <span className="text-neutral-500">No pending changes.</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Warning size={12} weight="fill" className="text-amber-600 dark:text-amber-400" />
                <span className="font-medium">
                  {pending.length} pending change{pending.length === 1 ? '' : 's'}
                </span>
                <span className="text-neutral-500">
                  ·{' '}
                  {pending.filter(p => p.scope === 'enterprise').length > 0 && 'enterprise budget'}
                  {pending.filter(p => p.scope === 'enterprise').length > 0 &&
                    pending.filter(p => p.scope === 'cost_center').length > 0 &&
                    ', '}
                  {pending.filter(p => p.scope === 'cost_center').length > 0 &&
                    `${pending.filter(p => p.scope === 'cost_center').length} cost-center budget${pending.filter(p => p.scope === 'cost_center').length === 1 ? '' : 's'}`}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleDiscardAll}
              disabled={drafts.size === 0 || applying}
            >
              Discard
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={pending.length === 0 || applying}
            >
              {applying ? 'Applying…' : `Review & apply (${pending.length})`}
            </Button>
          </div>
        </div>

        {applyError ? (
          <div className="rounded-md border border-red-500/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {applyError}
          </div>
        ) : null}
      </CardContent>

      {/* Review dialog */}
      <Dialog open={confirmOpen} onOpenChange={o => !applying && setConfirmOpen(o)}>
        <DialogContent>
          <DialogTitle>Apply budget changes</DialogTitle>
          <DialogDescription>
            Review the diff below — applying will PATCH each budget on GitHub. Existing alerts and
            enforcement settings are preserved.
          </DialogDescription>
          <div className="grid gap-3 mt-2">
            <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100/60 dark:bg-neutral-900/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-1.5 font-medium">Scope</th>
                    <th className="px-3 py-1.5 font-medium">Name</th>
                    <th className="px-3 py-1.5 font-medium text-right">Before</th>
                    <th className="px-3 py-1.5 font-medium text-right">After</th>
                    <th className="px-3 py-1.5 font-medium text-right">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(p => {
                    const delta = p.after - p.before
                    return (
                      <tr key={p.key} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="px-3 py-1.5 capitalize text-neutral-500">
                          {p.scope === 'enterprise' ? 'Enterprise' : 'Cost center'}
                        </td>
                        <td className="px-3 py-1.5 font-medium">{p.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-neutral-500">
                          {formatCurrency(p.before)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {formatCurrency(p.after)}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-1.5 text-right font-mono',
                            delta > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {delta > 0 ? '+' : ''}
                          {formatCurrency(delta)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {applyError ? (
              <div className="text-xs text-red-700 dark:text-red-300">{applyError}</div>
            ) : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" disabled={applying}>Cancel</Button>
              </DialogClose>
              <Button onClick={handleApply} disabled={applying || pending.length === 0}>
                {applying ? 'Applying…' : `Apply ${pending.length} change${pending.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
