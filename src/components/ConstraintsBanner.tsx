import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Warning, XCircle, CaretDown, CaretUp, ArrowDown, ArrowSquareOut } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { buildCostCenterIndex, budgetEditUrl } from '@/lib/api'
import { computeBudgetConstraints } from '@/lib/budgetConstraints'
import { computeRequiredMinimums } from '@/lib/budgetAutoFix'
import { formatCurrency, cn, openExternal } from '@/lib/utils'

/**
 * Scroll to a BudgetPlanner row (ent card or a specific CC row) and flash a
 * highlight ring so the user can see where to type the fix. The id is set on
 * the row container by BudgetPlanner.
 */
function scrollToPlanner(targetId: string) {
  const el = document.getElementById(targetId)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'dark:ring-offset-neutral-950')
  window.setTimeout(() => {
    el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'dark:ring-offset-neutral-950')
  }, 2000)
}

interface FailingCheck {
  kind: 'cc-over' | 'cc-vs-ent' | 'leftover'
  message: string
  actions: Array<{
    label: string
    onClick?: () => void
    href?: string
    icon?: 'scroll' | 'external'
    primary?: boolean
    // If set, this action will be hidden when the element with this id is
    // already in the viewport — no point scrolling to something the user can
    // already see.
    scrollTargetId?: string
  }>
}

/**
 * Track which of the given DOM ids are currently in the viewport.
 * Used to hide "scroll to row" actions when the target is already visible.
 */
function useVisibleTargets(targetIds: string[]): Set<string> {
  const key = targetIds.slice().sort().join('|')
  const [visible, setVisible] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (targetIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(prev => (prev.size === 0 ? prev : new Set()))
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        // IntersectionObserver callbacks run async (microtask after layout),
        // not during render — setState here is safe.
        setVisible(prev => {
          const next = new Set(prev)
          for (const entry of entries) {
            if (entry.isIntersecting) next.add(entry.target.id)
            else next.delete(entry.target.id)
          }
          return next
        })
      },
      { threshold: 0.5 },
    )
    for (const id of targetIds) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // targetIds identity changes every render; key is the stable comparator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return visible
}

/**
 * Banner that surfaces the budget-constraint health for the current enterprise.
 *
 * Enforces the "golden rule": sum of effective per-user ULBs must remain the
 * binding constraint, never the enterprise pool or a cost-center cap.
 *
 * Three visual states:
 *   - 🛑 RED:   any hard check (B, C, D) failed
 *   - ⚠️  AMBER: only soft warnings
 *   - ✅ GREEN: all clear
 *
 * See docs/budget-constraints.md for the constraint model.
 */
export function ConstraintsBanner() {
  const {
    budgets,
    seats,
    costCenters,
    universalUlb,
    enterpriseBudget,
    costCenterBudgetsByName,
    credentials,
  } = useCredentials()

  const result = useMemo(() => {
    // Rebuild the index with budget awareness so we get org-collision detection.
    const index = buildCostCenterIndex(costCenters, costCenterBudgetsByName)
    return computeBudgetConstraints({
      enterpriseBudget,
      universalUlb,
      costCenters,
      costCenterIndex: index,
      ccBudgetsByName: costCenterBudgetsByName,
      seats,
      userBudgets: budgets,
    })
  }, [enterpriseBudget, universalUlb, costCenters, costCenterBudgetsByName, seats, budgets])

  const requiredMins = useMemo(() => computeRequiredMinimums(result), [result])

  const hasFailingCheck = result.checks.perCc.some(c => !c.check.ok)
    || (result.checks.ccVsEnterprise ? !result.checks.ccVsEnterprise.ok : false)
    || (result.checks.unassignedLeftover ? !result.checks.unassignedLeftover.ok : false)

  // Auto-expand when something needs attention so the actionable fix list is
  // visible without an extra click; collapsed by default when all-clear.
  const [expanded, setExpanded] = useState(hasFailingCheck)

  // Don't render anything if we have nothing to constrain against.
  // (e.g. demo mode, or a freshly connected enterprise before data loads)
  const hasAnyEnvelope =
    enterpriseBudget !== null || costCenterBudgetsByName.size > 0 || universalUlb !== null

  const failingChecks: FailingCheck[] = useMemo(() => {
    const arr: FailingCheck[] = []
    for (const c of result.checks.perCc) {
      if (!c.check.ok) {
        const required = requiredMins.perCc.get(c.costCenterId)
        const ccBudget = costCenterBudgetsByName.get(c.costCenterName)
        const actions: FailingCheck['actions'] = []
        if (required !== undefined) {
          actions.push({
            label: `Raise CC budget to ${formatCurrency(required)}`,
            onClick: () => scrollToPlanner(`bp-cc-${c.costCenterId}`),
            icon: 'scroll',
            primary: true,
            scrollTargetId: `bp-cc-${c.costCenterId}`,
          })
        }
        if (ccBudget && credentials) {
          actions.push({
            label: 'Edit on github.com',
            href: budgetEditUrl(credentials.base, credentials.ent, ccBudget.id),
            icon: 'external',
          })
        }
        arr.push({
          kind: 'cc-over',
          message: `Cost center "${c.costCenterName}" is over by ${formatCurrency(c.check.overBy)} — ${c.memberCount} member${c.memberCount === 1 ? '' : 's'} have effective ULBs totaling ${formatCurrency(c.check.actual)} against a ${formatCurrency(c.check.allowed)} budget.`,
          actions,
        })
      }
    }
    if (result.checks.ccVsEnterprise && !result.checks.ccVsEnterprise.ok) {
      const actions: FailingCheck['actions'] = []
      if (requiredMins.enterprise !== null) {
        actions.push({
          label: `Raise enterprise budget to ${formatCurrency(requiredMins.enterprise)}`,
          onClick: () => scrollToPlanner('bp-ent'),
          icon: 'scroll',
          primary: true,
          scrollTargetId: 'bp-ent',
        })
      }
      if (enterpriseBudget && credentials) {
        actions.push({
          label: 'Edit on github.com',
          href: budgetEditUrl(credentials.base, credentials.ent, enterpriseBudget.id),
          icon: 'external',
        })
      }
      arr.push({
        kind: 'cc-vs-ent',
        message: `Cost-center budgets total ${formatCurrency(result.checks.ccVsEnterprise.actual)}, which exceeds the enterprise budget of ${formatCurrency(result.checks.ccVsEnterprise.allowed)} by ${formatCurrency(result.checks.ccVsEnterprise.overBy)}.`,
        actions,
      })
    }
    if (result.checks.unassignedLeftover && !result.checks.unassignedLeftover.ok) {
      const actions: FailingCheck['actions'] = []
      if (requiredMins.enterprise !== null) {
        actions.push({
          label: `Raise enterprise budget to ${formatCurrency(requiredMins.enterprise)}`,
          onClick: () => scrollToPlanner('bp-ent'),
          icon: 'scroll',
          primary: true,
          scrollTargetId: 'bp-ent',
        })
      }
      if (enterpriseBudget && credentials) {
        actions.push({
          label: 'Edit on github.com',
          href: budgetEditUrl(credentials.base, credentials.ent, enterpriseBudget.id),
          icon: 'external',
        })
      }
      arr.push({
        kind: 'leftover',
        message: `Users outside a budgeted cost center have effective ULBs totaling ${formatCurrency(result.checks.unassignedLeftover.actual)}, exceeding the ${result.mode === 'umbrella' ? 'leftover enterprise allowance' : 'enterprise budget'} of ${formatCurrency(result.checks.unassignedLeftover.allowed)} by ${formatCurrency(result.checks.unassignedLeftover.overBy)}.`,
        actions,
      })
    }
    return arr
  }, [result, requiredMins, costCenterBudgetsByName, credentials, enterpriseBudget])

  // Watch the scroll-action targets so we can hide the "scroll to row" buttons
  // when the row is already in view.
  const scrollTargetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const fc of failingChecks) {
      for (const a of fc.actions) {
        if (a.scrollTargetId) ids.add(a.scrollTargetId)
      }
    }
    return Array.from(ids)
  }, [failingChecks])
  const visibleTargets = useVisibleTargets(scrollTargetIds)

  if (!hasAnyEnvelope) return null

  const hasFailure = failingChecks.length > 0
  const hasWarning = result.warnings.length > 0
  const state: 'red' | 'amber' | 'green' = hasFailure ? 'red' : hasWarning ? 'amber' : 'green'

  const styles =
    state === 'red'
      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200'
      : state === 'amber'
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'

  const Icon = state === 'red' ? XCircle : state === 'amber' ? Warning : CheckCircle

  const modeLabel =
    result.mode === 'independent'
      ? 'Cost center exclusion is on'
      : result.mode === 'no-enterprise-budget'
        ? 'No enterprise budget configured'
        : null

  const headline = hasFailure
    ? `Budget overcommitted — ${failingChecks.length} constraint${failingChecks.length === 1 ? '' : 's'} failing`
    : hasWarning
      ? `Budget OK — ${result.warnings.length} advisory ${result.warnings.length === 1 ? 'warning' : 'warnings'}`
      : 'Budgets are well-constrained'

  const canExpand = hasFailure || hasWarning || result.maxSafeUniversalUlb !== Infinity

  return (
    <div role="status" className={cn('rounded-md border px-3 py-2 text-sm', styles)}>
      <div className="flex items-start gap-2">
        <Icon size={18} weight="duotone" className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{headline}</div>
            {canExpand ? (
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                aria-expanded={expanded}
              >
                {expanded ? 'Hide details' : 'Show details'}
                {expanded ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
              </button>
            ) : null}
          </div>
          {modeLabel ? <div className="mt-0.5 text-xs opacity-80">{modeLabel}</div> : null}

          {expanded ? (
            <div className="mt-2 space-y-2">
              {hasFailure ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Failing checks</div>
                  <ul className="mt-1 space-y-2">
                    {failingChecks.map((fc, i) => {
                      const visibleActions = fc.actions.filter(
                        a => !a.scrollTargetId || !visibleTargets.has(a.scrollTargetId),
                      )
                      return (
                      <li key={i} className="rounded border border-current/20 bg-white/40 dark:bg-black/20 px-2.5 py-2 text-xs">
                        <div>{fc.message}</div>
                        {visibleActions.length > 0 ? (
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {visibleActions.map((a, j) => {
                              const baseClass = cn(
                                'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                                a.primary
                                  ? 'bg-current/15 hover:bg-current/25'
                                  : 'opacity-80 hover:opacity-100 hover:bg-current/10',
                              )
                              const iconEl =
                                a.icon === 'scroll' ? (
                                  <ArrowDown size={10} weight="bold" />
                                ) : a.icon === 'external' ? (
                                  <ArrowSquareOut size={10} />
                                ) : null
                              if (a.href) {
                                return (
                                  <a
                                    key={j}
                                    href={a.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={openExternal(a.href)}
                                    className={baseClass}
                                  >
                                    {a.label}
                                    {iconEl}
                                  </a>
                                )
                              }
                              return (
                                <button
                                  key={j}
                                  type="button"
                                  onClick={a.onClick}
                                  className={baseClass}
                                >
                                  {iconEl}
                                  {a.label}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
              {hasWarning ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Warnings</div>
                  <ul className="mt-1 list-disc pl-5 space-y-1 text-xs">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.maxSafeUniversalUlb !== Infinity ? (
                <div className="text-xs opacity-90">
                  <span className="font-semibold">Max safe universal ULB:</span>{' '}
                  {formatCurrency(result.maxSafeUniversalUlb)}{' '}
                  <span className="opacity-70">
                    (the largest universal ULB value that keeps every check passing, holding individual ULBs and budgets constant)
                  </span>
                </div>
              ) : null}
              <div className="text-xs opacity-75">
                See <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/5">docs/budget-constraints.md</code> for the constraint model.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
