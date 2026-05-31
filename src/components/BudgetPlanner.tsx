import { useEffect, useMemo, useState } from 'react'
import {
  Buildings,
  Stack,
  CaretDown,
  CaretUp,
  CheckCircle,
  Warning,
  ArrowCounterClockwise,
  ArrowSquareOut,
  Bell,
  BellSlash,
  Lock,
  LockOpen,
  Plus,
  Users,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCredentials } from '@/hooks/use-credentials'
import { useBudgetConstraints } from '@/hooks/use-budget-constraints'
import { computeRequiredMinimums } from '@/lib/budgetAutoFix'
import { formatCurrency, formatCurrencyShort, cn, openExternal } from '@/lib/utils'
import {
  patchEnterpriseBudget,
  patchCostCenterBudget,
  createCostCenterBudget,
  budgetEditUrl,
  costCenterUrl,
  enterpriseSeatsUrl,
} from '@/lib/api'
import { runBatch } from '@/lib/batch'

type Draft = Map<string, string> // key: 'ent' or `cc:<budgetId>` or `cc-nobudget:<ccId>`. Value: raw amount string.

/**
 * One unit of work to dispatch when the user hits Apply. Discriminated by
 * `kind` so the apply pipeline can fan out to the right API helper without
 * sniffing fields. We deliberately model "create CC budget" as its own kind
 * (instead of an "amount went from 0 to N" patch) so the diff preview reads
 * accurately and we can call the POST endpoint.
 */
type PendingChange =
  | {
      kind: 'patch-ent'
      key: 'ent'
      name: string
      budgetId: string
      amountBefore?: number
      amountAfter?: number
      preventBefore?: boolean
      preventAfter?: boolean
    }
  | {
      kind: 'patch-cc'
      key: string
      name: string
      budgetId: string
      amountBefore?: number
      amountAfter?: number
      preventBefore?: boolean
      preventAfter?: boolean
    }
  | {
      kind: 'create-cc'
      key: string
      name: string
      ccId: string
      amountAfter: number
      preventAfter: boolean
    }

/**
 * Small chip rendered next to a budget input that shows the minimum dollar
 * amount required to cover current ULB allocation. Helps the user satisfy the
 * constraint without bouncing to another tab to read it.
 *
 * Color: neutral when the current value already covers requirement, amber when
 * short. Tooltip explains where the number comes from.
 */
function RequiredChip({
  current,
  required,
  tip,
}: {
  current: number
  required: number | null
  tip: string
}) {
  if (required == null) return null
  const short = current < required
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono cursor-help select-none',
            short
              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
              : 'bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400',
          )}
        >
          {short ? <Warning size={10} weight="fill" /> : null}
          Min needed: {formatCurrency(required)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Hard-cap / soft-cap inline toggle. Hard cap = `prevent_further_usage: true`
 * (GitHub blocks usage past budget). Soft cap = `false` (alerts only). The
 * pending change shows up in the apply diff like any other edit.
 */
function CapToggle({
  value,
  apiValue,
  onChange,
}: {
  value: boolean
  apiValue: boolean | null
  onChange: (next: boolean) => void
}) {
  const dirty = apiValue !== null && value !== apiValue
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium border transition-colors',
            value
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
            dirty && 'ring-2 ring-amber-400/50',
          )}
          aria-pressed={value}
        >
          {value ? <Lock size={10} weight="fill" /> : <LockOpen size={10} weight="fill" />}
          {value ? 'Hard cap' : 'Soft cap'}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {value
          ? 'Blocks usage past the budget. Click to switch to soft cap (alerts only).'
          : 'Alerts only — usage can exceed the budget. Click to switch to hard cap.'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Deep-link to the GHEC budget edit page. We don't manage alert thresholds or
 * recipients from this app because GitHub already has a richer UI for them;
 * pointing admins at that page keeps a single source of truth.
 *
 * When `willAlert` is provided we surface the on/off state inline so admins
 * can tell at a glance which budgets have alerts wired up vs. which are
 * silently overspending. The link target is the same either way.
 */
function AlertsLink({
  href,
  willAlert,
  alertRecipients,
}: {
  href: string
  willAlert?: boolean
  alertRecipients?: string[]
}) {
  const known = typeof willAlert === 'boolean'
  const on = known && willAlert
  const off = known && !willAlert
  const recipientCount = alertRecipients?.length ?? 0
  const stateClass = on
    ? 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300'
    : off
    ? 'text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300'
    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
  const Icon = on ? Bell : off ? BellSlash : null
  const label = on ? 'Alerts on' : off ? 'Alerts off' : 'Alerts'
  const tooltip = on
    ? recipientCount > 0
      ? `Alerts on — ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}. Click to manage on github.com.`
      : 'Alerts on. Click to manage thresholds and recipients on github.com.'
    : off
    ? 'No alerts configured for this budget. Click to add alert thresholds and recipients on github.com.'
    : 'Configure alert thresholds and recipients on github.com.'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openExternal(href)}
          className={cn('inline-flex items-center gap-1 text-[11px] hover:underline', stateClass)}
        >
          {Icon ? <Icon size={11} weight={on ? 'fill' : 'regular'} /> : null}
          {label}
          <ArrowSquareOut size={10} />
        </a>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Clickable seat count → deep-link to the GHEC page where membership lives.
 * For a cost center: the CC detail page. For the enterprise row: the people
 * page. Behaves as a static span when no link is available (e.g. demo mode
 * with no credentials).
 */
function SeatsLink({ seats, href }: { seats: number; href: string | null }) {
  const label = seats.toLocaleString()
  if (!href) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-neutral-600 dark:text-neutral-400">
        <Users size={11} />
        {label}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openExternal(href)}
          className="inline-flex items-center gap-1 font-mono text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
        >
          <Users size={11} />
          {label}
          <ArrowSquareOut size={9} />
        </a>
      </TooltipTrigger>
      <TooltipContent>View members on github.com</TooltipContent>
    </Tooltip>
  )
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
    budgets,
    seats,
    universalUlb,
    apiFetch,
    credentials,
    refresh,
  } = useCredentials()

  // Editable drafts. Three parallel pieces of state so we can keep the
  // existing amount-input typing UX untouched while layering on the new
  // hard/soft cap toggle and the "create new CC budget" flow.
  //
  //   drafts:     raw amount strings, keyed by row.key. Empty string + NaN allowed.
  //   prevents:   hard-cap overrides, keyed by row.key. true = hard cap, false = soft cap.
  //   creating:   set of `cc-nobudget:<ccId>` keys the user has opened for creation.
  //
  // All three reset together on Discard and on source refresh.
  const [drafts, setDrafts] = useState<Draft>(new Map())
  const [prevents, setPrevents] = useState<Map<string, boolean>>(new Map())
  const [creating, setCreating] = useState<Set<string>>(new Set())

  // Track the source-of-truth signature so we can reset drafts (without an
  // effect) whenever the underlying budgets change — e.g. after refresh().
  const sourceSig = `${enterpriseBudget?.id ?? ''}|${enterpriseBudget?.budgetAmount ?? ''}|${enterpriseBudget?.preventFurtherUsage ?? ''}|${costCenterBudgetsByName.size}`
  const [lastSig, setLastSig] = useState(sourceSig)
  if (sourceSig !== lastSig) {
    setLastSig(sourceSig)
    setDrafts(new Map())
    setPrevents(new Map())
    setCreating(new Set())
  }

  const [showAll, setShowAll] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [lastAppliedAt, setLastAppliedAt] = useState<number | null>(null)

  // Required minimums — what each envelope would need to be to cover current ULBs.
  const constraintResult = useBudgetConstraints()
  const requiredMins = useMemo(() => computeRequiredMinimums(constraintResult), [constraintResult])

  // Per-CC floor: sum of effective ULBs of all Copilot seats in that CC.
  // For uncapped CCs this is the minimum spend that members will commit
  // (assuming they each consume their full cap). Used to render
  // "at least $X" hints + a column footer total.
  const ccFloorByCcId = useMemo(() => {
    const individualByLogin = new Map<string, number>()
    for (const b of budgets) {
      if (b.user) individualByLogin.set(b.user.toLowerCase(), b.budgetAmount)
    }
    const universal = universalUlb?.budgetAmount ?? 0
    const sums = new Map<string, number>()
    for (const seat of seats) {
      const login = seat.login.toLowerCase()
      const r = loginToCostCenter.get(login)
      if (!r) continue
      const eff = individualByLogin.get(login) ?? universal
      sums.set(r.cc.id, (sums.get(r.cc.id) ?? 0) + eff)
    }
    return sums
  }, [budgets, seats, loginToCostCenter, universalUlb])

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
    floor: number
    willAlert: boolean
    alertRecipients: string[]
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
          floor: ccFloorByCcId.get(cc.id) ?? 0,
          willAlert: b?.willAlert ?? false,
          alertRecipients: b?.alertRecipients ?? [],
        }
      })
      .sort((a, b) => {
        if (a.affectsCopilot !== b.affectsCopilot) return a.affectsCopilot ? -1 : 1
        if (!!a.budgetId !== !!b.budgetId) return a.budgetId ? -1 : 1
        if (a.apiAmount !== b.apiAmount) return b.apiAmount - a.apiAmount
        return a.name.localeCompare(b.name)
      })
  }, [costCenters, costCenterBudgetsByName, ccIdsAffectingCopilot, ccFloorByCcId])

  const affectingCount = rows.filter(r => r.affectsCopilot).length
  const notAffectingCount = rows.length - affectingCount
  const uncappedAffecting = useMemo(
    () => rows.filter(r => r.affectsCopilot && r.budgetId === null),
    [rows],
  )
  const visibleRows = showAll ? rows : rows.filter(r => r.affectsCopilot)

  // --- Diff calculation ---
  const pending: PendingChange[] = useMemo(() => {
    const out: PendingChange[] = []

    if (enterpriseBudget) {
      const draftAmount = drafts.get('ent')
      const draftPrevent = prevents.get('ent')
      let amountAfter: number | undefined
      if (draftAmount !== undefined) {
        const n = Number(draftAmount)
        if (Number.isFinite(n) && n >= 0 && n !== enterpriseBudget.budgetAmount) {
          amountAfter = n
        }
      }
      const preventAfter =
        draftPrevent !== undefined && draftPrevent !== enterpriseBudget.preventFurtherUsage
          ? draftPrevent
          : undefined
      if (amountAfter !== undefined || preventAfter !== undefined) {
        out.push({
          kind: 'patch-ent',
          key: 'ent',
          name: 'Enterprise budget',
          budgetId: enterpriseBudget.id,
          amountBefore: amountAfter !== undefined ? enterpriseBudget.budgetAmount : undefined,
          amountAfter,
          preventBefore: preventAfter !== undefined ? enterpriseBudget.preventFurtherUsage : undefined,
          preventAfter,
        })
      }
    }

    for (const row of rows) {
      // Existing CC budget: collect amount and/or prevent diffs as a single patch.
      if (row.budgetId) {
        const draftAmount = drafts.get(row.key)
        const draftPrevent = prevents.get(row.key)
        let amountAfter: number | undefined
        if (draftAmount !== undefined) {
          const n = Number(draftAmount)
          if (Number.isFinite(n) && n >= 0 && n !== row.apiAmount) {
            amountAfter = n
          }
        }
        const preventAfter =
          draftPrevent !== undefined && draftPrevent !== row.preventFurtherUsage
            ? draftPrevent
            : undefined
        if (amountAfter !== undefined || preventAfter !== undefined) {
          out.push({
            kind: 'patch-cc',
            key: row.key,
            name: row.name,
            budgetId: row.budgetId,
            amountBefore: amountAfter !== undefined ? row.apiAmount : undefined,
            amountAfter,
            preventBefore: preventAfter !== undefined ? row.preventFurtherUsage : undefined,
            preventAfter,
          })
        }
        continue
      }
      // No existing budget: only a create candidate when the user opened the
      // row AND typed a positive amount.
      if (!creating.has(row.key)) continue
      const draftAmount = drafts.get(row.key)
      if (draftAmount === undefined) continue
      const n = Number(draftAmount)
      if (!Number.isFinite(n) || n <= 0) continue
      out.push({
        kind: 'create-cc',
        key: row.key,
        name: row.name,
        ccId: row.ccId,
        amountAfter: n,
        preventAfter: prevents.get(row.key) ?? true,
      })
    }
    return out
  }, [drafts, prevents, creating, rows, enterpriseBudget])

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

  const setPrevent = (key: string, value: boolean) => {
    setPrevents(prev => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }

  const startCreating = (key: string) => {
    setCreating(prev => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
    // Seed sensible defaults so the row shows a usable starting state.
    if (drafts.get(key) === undefined) setDraft(key, '')
    if (prevents.get(key) === undefined) setPrevent(key, true)
  }

  const cancelCreating = (key: string) => {
    setCreating(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setDrafts(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setPrevents(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  const resetField = (key: string) => {
    setDrafts(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setPrevents(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  const handleDiscardAll = () => {
    setDrafts(new Map())
    setPrevents(new Map())
    setCreating(new Set())
    setApplyError(null)
  }

  const totalDirty = drafts.size + prevents.size + creating.size

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
        if (change.kind === 'patch-ent') {
          await patchEnterpriseBudget(fetcher, change.budgetId, {
            budgetAmount: change.amountAfter,
            preventFurtherUsage: change.preventAfter,
          })
        } else if (change.kind === 'patch-cc') {
          await patchCostCenterBudget(fetcher, change.budgetId, {
            budgetAmount: change.amountAfter,
            preventFurtherUsage: change.preventAfter,
          })
        } else {
          await createCostCenterBudget(fetcher, {
            costCenterEntityName: change.name,
            budgetAmount: change.amountAfter,
            preventFurtherUsage: change.preventAfter,
          })
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
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-4">
        {/* Card 1 — Enterprise budget */}
        <Card>
          <CardContent className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Buildings size={14} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
                  Enterprise budget
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  The top-level envelope. Must cover everything below it.
                </p>
              </div>
              {lastAppliedAt && pending.length === 0 ? (
                <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 shrink-0">
                  <CheckCircle size={12} weight="fill" />
                  Synced
                </div>
              ) : null}
            </div>

            {!hasEnterprise ? (
              <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
                No enterprise ai_credits budget configured — nothing to plan against yet.
              </div>
            ) : (
              <div
                id="bp-ent"
                data-bp-target="ent"
                className="rounded-md border border-neutral-200 dark:border-neutral-800 py-2.5 grid items-center gap-3 scroll-mt-24"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 5.5rem 23rem' }}
              >
                <div className="px-3">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    Currently {formatCurrency(enterpriseBudget.budgetAmount)}
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                    <CapToggle
                      value={prevents.get('ent') ?? enterpriseBudget.preventFurtherUsage}
                      apiValue={enterpriseBudget.preventFurtherUsage}
                      onChange={next => setPrevent('ent', next)}
                    />
                    {enterpriseBudget.excludeCostCenterUsage && credentials ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={budgetEditUrl(credentials.base, credentials.ent, enterpriseBudget.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={openExternal(budgetEditUrl(credentials.base, credentials.ent, enterpriseBudget.id))}
                            className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                          >
                            CC exclusion on
                            <ArrowSquareOut size={10} weight="bold" className="opacity-70" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Cost centers are billed independently and don't draw from this
                          enterprise pool. Click to edit on github.com.
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    {credentials ? (
                      <AlertsLink
                        href={budgetEditUrl(credentials.base, credentials.ent, enterpriseBudget.id)}
                        willAlert={enterpriseBudget.willAlert}
                        alertRecipients={enterpriseBudget.alertRecipients}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="text-center text-xs px-3">
                  <SeatsLink
                    seats={seats.length}
                    href={credentials ? enterpriseSeatsUrl(credentials.base, credentials.ent) : null}
                  />
                </div>
                <div className="px-3 flex items-center gap-1.5 justify-end">
                  <RequiredChip
                    current={Number(drafts.get('ent') ?? enterpriseBudget.budgetAmount) || 0}
                    required={requiredMins.enterprise}
                    tip={
                      constraintResult.mode === 'umbrella'
                        ? 'Minimum to avoid capping: cost center budgets plus limits for users outside them.'
                        : 'Minimum to avoid capping: limits for users not in any budgeted cost center.'
                    }
                  />
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
                  {drafts.get('ent') !== undefined ? (
                    <button
                      type="button"
                      onClick={() => resetField('ent')}
                      className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                      title="Reset to saved value"
                      aria-label="Reset enterprise budget"
                    >
                      <ArrowCounterClockwise size={14} />
                    </button>
                  ) : (
                    <span className="w-[14px]" aria-hidden />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Cost centers */}
        <Card id="bp-cc-card">
          <CardContent className="grid gap-3">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Stack size={14} weight="duotone" className="text-emerald-700 dark:text-emerald-400" />
                Cost centers
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Group-level budgets for subsets of users. Each must cover its members' ULBs.
              </p>
            </div>

            {uncappedAffecting.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                <div className="font-medium">
                  {uncappedAffecting.length} cost center{uncappedAffecting.length === 1 ? '' : 's'} affecting Copilot
                  {uncappedAffecting.length === 1 ? ' has' : ' have'} no per-CC budget
                </div>
                <div className="mt-0.5 opacity-90">
                  Usage is only bounded by the enterprise pool. Use{' '}
                  <span className="font-medium">Set budget</span> on{' '}
                  {uncappedAffecting.slice(0, 3).map((r, i) => (
                    <span key={r.ccId}>
                      {i > 0 ? ', ' : ''}
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`bp-cc-${r.ccId}`)
                          if (!el) return
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          // bg flash because ring doesn't render on <tr> in
                          // collapsed tables; keep ring too for non-tr targets.
                          const cls = [
                            'ring-2',
                            'ring-amber-400',
                            'ring-offset-2',
                            'dark:ring-offset-neutral-950',
                            'bg-amber-100',
                            'dark:bg-amber-900/40',
                          ]
                          el.classList.add(...cls)
                          window.setTimeout(() => {
                            el.classList.remove(...cls)
                          }, 2000)
                        }}
                        className="underline-offset-2 hover:underline font-medium"
                      >
                        {r.name}
                      </button>
                    </span>
                  ))}
                  {uncappedAffecting.length > 3 ? ` + ${uncappedAffecting.length - 3} more` : ''}{' '}
                  below to set one.
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
                  <div className="font-medium">
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
                        <th className="px-3 py-1.5 font-medium text-center" style={{ width: '5.5rem' }}>Seats</th>
                        <th className="px-3 py-1.5 font-medium text-right" style={{ width: '23rem' }}>Budget ($)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(row => {
                        const state = row.budgetId ? inputState(row.key, row.apiAmount) : 'clean'
                        const draftVal = drafts.get(row.key)
                        const isCreating = creating.has(row.key)
                        const editable = !!row.budgetId || isCreating
                        const preventVal = prevents.get(row.key) ?? (row.budgetId ? row.preventFurtherUsage : true)
                        const showResetBtn = !isCreating && row.budgetId && (draftVal !== undefined || prevents.has(row.key))
                        return (
                          <tr
                            key={row.key}
                            id={`bp-cc-${row.ccId}`}
                            data-bp-target={`cc-${row.ccId}`}
                            className={cn(
                              'border-t border-neutral-200 dark:border-neutral-800 align-top scroll-mt-24',
                              !row.affectsCopilot && 'opacity-60',
                              isCreating && 'bg-amber-500/5',
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {row.name}
                                {!row.affectsCopilot && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-500">no Copilot seats</span>
                                )}
                                {isCreating && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">new budget</span>
                                )}
                              </div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                                {editable ? (
                                  <CapToggle
                                    value={preventVal}
                                    apiValue={row.budgetId ? row.preventFurtherUsage : null}
                                    onChange={next => setPrevent(row.key, next)}
                                  />
                                ) : null}
                                {row.budgetId && credentials ? (
                                  <AlertsLink
                                    href={budgetEditUrl(credentials.base, credentials.ent, row.budgetId)}
                                    willAlert={row.willAlert}
                                    alertRecipients={row.alertRecipients}
                                  />
                                ) : null}
                                {!editable && !row.budgetId ? (
                                  <span className="text-[11px] text-neutral-500">No budget set</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <SeatsLink
                                seats={row.seatCount}
                                href={credentials ? costCenterUrl(credentials.base, credentials.ent, row.ccId) : null}
                              />
                            </td>
                            <td className="px-3 py-2">
                              {editable ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <RequiredChip
                                    current={Number(draftVal ?? row.apiAmount) || 0}
                                    required={requiredMins.perCc.get(row.ccId) ?? null}
                                    tip="Minimum to avoid capping: total limits for everyone assigned to this cost center."
                                  />
                                  <span className="text-sm text-neutral-500">$</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step="1"
                                    inputMode="numeric"
                                    placeholder={isCreating ? '0' : undefined}
                                    value={draftVal ?? String(row.apiAmount)}
                                    onChange={e => setDraft(row.key, e.target.value)}
                                    className={cn(
                                      'w-36 text-right font-mono',
                                      state === 'dirty' && 'border-amber-500 dark:border-amber-400',
                                      state === 'invalid' && 'border-red-500 dark:border-red-400',
                                      isCreating && 'border-amber-500 dark:border-amber-400',
                                    )}
                                  />
                                  {isCreating ? (
                                    <button
                                      type="button"
                                      onClick={() => cancelCreating(row.key)}
                                      className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                      title="Cancel new budget"
                                      aria-label={`Cancel ${row.name} budget`}
                                    >
                                      <ArrowCounterClockwise size={14} />
                                    </button>
                                  ) : showResetBtn ? (
                                    <button
                                      type="button"
                                      onClick={() => resetField(row.key)}
                                      className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                                      title="Reset to saved value"
                                      aria-label={`Reset ${row.name}`}
                                    >
                                      <ArrowCounterClockwise size={14} />
                                    </button>
                                  ) : (
                                    <span className="w-[14px]" aria-hidden />
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  {row.affectsCopilot && row.floor > 0 ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-[11px] font-mono text-neutral-500 cursor-help">
                                          at least {formatCurrency(row.floor)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Floor from per-user limits: {row.seatCount.toLocaleString()} Copilot seat{row.seatCount === 1 ? '' : 's'} × their effective ULBs.
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => startCreating(row.key)}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                    title="Set a budget for this cost center"
                                  >
                                    <Plus size={10} weight="bold" />
                                    Set budget
                                  </button>
                                  <span className="w-[14px]" aria-hidden />
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {(() => {
                      let cappedTotal = 0
                      let uncappedFloor = 0
                      let uncappedCount = 0
                      for (const row of visibleRows) {
                        const draftVal = drafts.get(row.key)
                        const isCreating = creating.has(row.key)
                        const editable = !!row.budgetId || isCreating
                        if (editable) {
                          const n = Number(draftVal ?? row.apiAmount)
                          if (Number.isFinite(n) && n >= 0) cappedTotal += n
                        } else if (row.affectsCopilot) {
                          uncappedFloor += row.floor
                          uncappedCount += 1
                        }
                      }
                      if (cappedTotal === 0 && uncappedCount === 0) return null
                      return (
                        <tfoot className="bg-neutral-50 dark:bg-neutral-900/40 border-t border-neutral-200 dark:border-neutral-800">
                          <tr className="text-[11px]">
                            <td className="px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400">
                              Total
                              {uncappedCount > 0 && (
                                <span className="ml-1.5 text-neutral-500">
                                  · {uncappedCount} uncapped
                                </span>
                              )}
                              {uncappedCount > 0 && uncappedFloor > 0 ? (
                                <span className="ml-1.5 text-neutral-500">
                                  · Includes {formatCurrency(uncappedFloor)} floor from uncapped cost centers
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-right font-mono">
                              <div className="flex items-center justify-end gap-1.5 pr-[18px]">
                                {uncappedCount > 0 ? (
                                  <span className="text-neutral-500">at least</span>
                                ) : null}
                                <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                                  {formatCurrency(cappedTotal + uncappedFloor)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        </tfoot>
                      )
                    })()}
                  </table>
                </div>
              </div>
            )}

            {/* Review & apply footer — shared across both cards */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 dark:border-neutral-800 mt-1 pt-3">
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
                      {(() => {
                        const entCount = pending.filter(p => p.kind === 'patch-ent').length
                        const ccPatch = pending.filter(p => p.kind === 'patch-cc').length
                        const ccCreate = pending.filter(p => p.kind === 'create-cc').length
                        const parts: string[] = []
                        if (entCount > 0) parts.push('enterprise budget')
                        if (ccPatch > 0) parts.push(`${ccPatch} cost-center update${ccPatch === 1 ? '' : 's'}`)
                        if (ccCreate > 0) parts.push(`${ccCreate} new cost-center budget${ccCreate === 1 ? '' : 's'}`)
                        return parts.join(', ')
                      })()}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={handleDiscardAll}
                  disabled={totalDirty === 0 || applying}
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
        </Card>

        {/* Review dialog */}
        <Dialog open={confirmOpen} onOpenChange={o => !applying && setConfirmOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Apply budget changes</DialogTitle>
          <DialogDescription>
            Review the diff below — applying will write each change to GitHub. New cost-center
            budgets are created via POST; existing ones are updated via PATCH (one PATCH per
            changed field). Alert recipients are configured on github.com.
          </DialogDescription>
          <div className="grid gap-3 mt-2">
            <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-100/60 dark:bg-neutral-900/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-1.5 font-medium">Action</th>
                    <th className="px-3 py-1.5 font-medium">Name</th>
                    <th className="px-3 py-1.5 font-medium">Field</th>
                    <th className="px-3 py-1.5 font-medium text-right">Before</th>
                    <th className="px-3 py-1.5 font-medium text-right">After</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.flatMap(p => {
                    const action = p.kind === 'patch-ent' ? 'Update' : p.kind === 'patch-cc' ? 'Update' : 'Create'
                    const scope = p.kind === 'patch-ent' ? 'Enterprise' : 'Cost center'
                    const rows: React.ReactNode[] = []
                    if (p.kind === 'create-cc') {
                      rows.push(
                        <tr key={`${p.key}:amt`} className="border-t border-neutral-200 dark:border-neutral-800">
                          <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400">{action}</td>
                          <td className="px-3 py-1.5 font-medium">{p.name} <span className="text-neutral-500">({scope})</span></td>
                          <td className="px-3 py-1.5 text-neutral-500">Budget</td>
                          <td className="px-3 py-1.5 text-right font-mono text-neutral-500">—</td>
                          <td className="px-3 py-1.5 text-right font-mono" title={formatCurrency(p.amountAfter)}>{formatCurrencyShort(p.amountAfter)}</td>
                        </tr>,
                      )
                      rows.push(
                        <tr key={`${p.key}:cap`} className="border-t border-neutral-200 dark:border-neutral-800">
                          <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400">{action}</td>
                          <td className="px-3 py-1.5 font-medium">{p.name} <span className="text-neutral-500">({scope})</span></td>
                          <td className="px-3 py-1.5 text-neutral-500">Enforcement</td>
                          <td className="px-3 py-1.5 text-right font-mono text-neutral-500">—</td>
                          <td className="px-3 py-1.5 text-right font-mono">{p.preventAfter ? 'Hard cap' : 'Soft cap'}</td>
                        </tr>,
                      )
                    } else {
                      if (p.amountAfter !== undefined && p.amountBefore !== undefined) {
                        const delta = p.amountAfter - p.amountBefore
                        rows.push(
                          <tr key={`${p.key}:amt`} className="border-t border-neutral-200 dark:border-neutral-800">
                            <td className="px-3 py-1.5 text-neutral-500">{action}</td>
                            <td className="px-3 py-1.5 font-medium">{p.name} <span className="text-neutral-500">({scope})</span></td>
                            <td className="px-3 py-1.5 text-neutral-500">Budget</td>
                            <td className="px-3 py-1.5 text-right font-mono text-neutral-500" title={formatCurrency(p.amountBefore)}>{formatCurrencyShort(p.amountBefore)}</td>
                            <td className={cn(
                              'px-3 py-1.5 text-right font-mono',
                              delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
                            )} title={`${formatCurrency(p.amountAfter)} (${delta > 0 ? '+' : ''}${formatCurrency(delta)})`}>
                              {formatCurrencyShort(p.amountAfter)} ({delta > 0 ? '+' : ''}{formatCurrencyShort(delta)})
                            </td>
                          </tr>,
                        )
                      }
                      if (p.preventAfter !== undefined && p.preventBefore !== undefined) {
                        rows.push(
                          <tr key={`${p.key}:cap`} className="border-t border-neutral-200 dark:border-neutral-800">
                            <td className="px-3 py-1.5 text-neutral-500">{action}</td>
                            <td className="px-3 py-1.5 font-medium">{p.name} <span className="text-neutral-500">({scope})</span></td>
                            <td className="px-3 py-1.5 text-neutral-500">Enforcement</td>
                            <td className="px-3 py-1.5 text-right font-mono text-neutral-500">{p.preventBefore ? 'Hard cap' : 'Soft cap'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{p.preventAfter ? 'Hard cap' : 'Soft cap'}</td>
                          </tr>,
                        )
                      }
                    }
                    return rows
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
      </div>
    </TooltipProvider>
  )
}
