import { useMemo, useState } from 'react'
import { CheckCircle, Warning, XCircle, CaretDown, CaretUp, ArrowDown, ArrowUp, ArrowSquareOut, Users, ArrowsClockwise } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { buildCostCenterIndex, budgetEditUrl } from '@/lib/api'
import { computeBudgetConstraints } from '@/lib/budgetConstraints'
import { computeRequiredMinimums, proposeLowerUniversalUbb } from '@/lib/budgetAutoFix'
import { formatCurrency, cn, openExternal } from '@/lib/utils'
import { EMPTY_FILTERS } from '@/components/BudgetsTable'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
  PLANNER_HIGHLIGHT_EVENT,
  type NavToIndividualDetail,
  type NavToIndividualTask,
  type PlannerHighlightDetail,
} from '@/lib/navEvents'

/**
 * Scroll to a BudgetPlanner row (ent card or a specific CC row) and flash a
 * highlight ring so the user can see where to type the fix. The id is set on
 * the row container by BudgetPlanner.
 */
const HIGHLIGHT_CLASSES = [
  'ring-2',
  'ring-amber-400',
  'ring-offset-2',
  'dark:ring-offset-neutral-950',
  'bg-amber-100',
  'dark:bg-amber-900/40',
] as const

function scrollToPlanner(targetId: string) {
  const el = document.getElementById(targetId)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Ring (box-shadow) doesn't render on <tr> in collapsed tables, and the
  // enterprise row is a div — so apply both ring + bg flash and let
  // whichever is visible do the job.
  el.classList.add(...HIGHLIGHT_CLASSES)
  window.setTimeout(() => {
    el.classList.remove(...HIGHLIGHT_CLASSES)
  }, 2000)
}

interface FailingCheck {
  kind: 'cc-over' | 'cc-vs-ent' | 'leftover'
  message: string
  actions: Array<{
    label: string
    onClick?: () => void
    href?: string
    icon?: 'scroll-up' | 'scroll-down' | 'external' | 'users' | 'universal'
    primary?: boolean
  }>
}

/**
 * Banner that surfaces the budget-constraint health for the current enterprise.
 *
 * Enforces the "golden rule": sum of effective per-user UBBs must remain the
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
    universalUbb,
    enterpriseBudget,
    costCenterBudgetsByName,
    credentials,
  } = useCredentials()

  const result = useMemo(() => {
    // Rebuild the index with budget awareness so we get org-collision detection.
    const index = buildCostCenterIndex(costCenters, costCenterBudgetsByName)
    return computeBudgetConstraints({
      enterpriseBudget,
      universalUbb,
      costCenters,
      costCenterIndex: index,
      ccBudgetsByName: costCenterBudgetsByName,
      seats,
      userBudgets: budgets,
    })
  }, [enterpriseBudget, universalUbb, costCenters, costCenterBudgetsByName, seats, budgets])

  const requiredMins = useMemo(() => computeRequiredMinimums(result), [result])
  const lowerUniversalProposal = useMemo(
    () => proposeLowerUniversalUbb(result, universalUbb?.budgetAmount ?? null),
    [result, universalUbb],
  )

  // For the cc-vs-ent failing check, we don't suggest a specific cost center
  // to lower — there are many ways to redistribute, and prescribing a single
  // row is too prescriptive. Instead we offer an abstract "lower the total"
  // action that scrolls to the CC card and shows a banner with the gap.
  const ccLowerProposal = useMemo(() => {
    const ccvs = result.checks.ccVsEnterprise
    if (!ccvs || ccvs.ok) return null
    return { overBy: ccvs.overBy, target: ccvs.allowed, actual: ccvs.actual }
  }, [result])

  const hasFailingCheck = result.checks.perCc.some(c => !c.check.ok)
    || (result.checks.ccVsEnterprise ? !result.checks.ccVsEnterprise.ok : false)
    || (result.checks.unassignedLeftover ? !result.checks.unassignedLeftover.ok : false)

  // Auto-expand when something needs attention so the actionable fix list is
  // visible without an extra click; collapsed by default when all-clear.
  const [expanded, setExpanded] = useState(hasFailingCheck)

  // Don't render anything if we have nothing to constrain against.
  // (e.g. demo mode, or a freshly connected enterprise before data loads)
  const hasAnyEnvelope =
    enterpriseBudget !== null || costCenterBudgetsByName.size > 0 || universalUbb !== null

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
            icon: 'scroll-up',
            primary: true,
          })
        }
        actions.push({
          label: `Reduce UBBs for ${c.memberCount} member${c.memberCount === 1 ? '' : 's'}`,
          onClick: () => {
            const task: NavToIndividualTask = {
              id: `cc-over:${c.costCenterId}`,
              kind: 'cc-over',
              costCenterId: c.costCenterId,
              costCenterName: c.costCenterName,
              memberCount: c.memberCount,
              actualUbbSum: c.check.actual,
              ccBudget: c.check.allowed,
              overBy: c.check.overBy,
            }
            const detail: NavToIndividualDetail = {
              filter: { ...EMPTY_FILTERS, costCenter: c.costCenterId },
              task,
            }
            window.dispatchEvent(
              new CustomEvent<NavToIndividualDetail>(NAV_TO_INDIVIDUAL_EVENT, { detail }),
            )
          },
          icon: 'users',
        })
        if (lowerUniversalProposal) {
          actions.push({
            label: lowerUniversalProposal.label,
            onClick: () => window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT)),
            icon: 'universal',
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
          message: `Cost center "${c.costCenterName}" is over by ${formatCurrency(c.check.overBy)} — ${c.memberCount} member${c.memberCount === 1 ? '' : 's'} have effective UBBs totaling ${formatCurrency(c.check.actual)} against a ${formatCurrency(c.check.allowed)} budget.`,
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
          icon: 'scroll-up',
          primary: true,
        })
      }
      if (ccLowerProposal) {
        actions.push({
          label: `Lower cost-center budgets by ${formatCurrency(ccLowerProposal.overBy)}`,
          onClick: () => {
            const detail: PlannerHighlightDetail = {
              target: 'cc-card',
              message: `Adjust cost-center budgets so they total ${formatCurrency(ccLowerProposal.target)} or less (currently ${formatCurrency(ccLowerProposal.actual)}, over by ${formatCurrency(ccLowerProposal.overBy)}).`,
            }
            window.dispatchEvent(
              new CustomEvent<PlannerHighlightDetail>(PLANNER_HIGHLIGHT_EVENT, { detail }),
            )
          },
          icon: 'scroll-down',
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
          icon: 'scroll-up',
          primary: true,
        })
      }
      if (lowerUniversalProposal) {
        actions.push({
          label: lowerUniversalProposal.label,
          onClick: () => window.dispatchEvent(new CustomEvent(NAV_TO_UNIVERSAL_EVENT)),
          icon: 'universal',
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
        message: `Users outside a budgeted cost center have effective UBBs totaling ${formatCurrency(result.checks.unassignedLeftover.actual)}, exceeding the ${result.mode === 'umbrella' ? 'leftover enterprise allowance' : 'enterprise budget'} of ${formatCurrency(result.checks.unassignedLeftover.allowed)} by ${formatCurrency(result.checks.unassignedLeftover.overBy)}.`,
        actions,
      })
    }
    return arr
  }, [result, requiredMins, costCenterBudgetsByName, credentials, enterpriseBudget, lowerUniversalProposal, ccLowerProposal])

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
    result.mode === 'no-enterprise-budget'
      ? 'No enterprise budget configured'
      : null

  const headline = hasFailure
    ? `Budget overcommitted — ${failingChecks.length} constraint${failingChecks.length === 1 ? '' : 's'} failing`
    : hasWarning
      ? `Budget OK — ${result.warnings.length} advisory ${result.warnings.length === 1 ? 'warning' : 'warnings'}`
      : 'Budgets are well-constrained'

  // We expand only when there's something actionable: failures or warnings.
  // (Previously this also expanded to surface "Max safe universal UBB" in the
  // healthy state, but that wasn't a question users actually asked.) The
  // alt-fix line below is shown only when expanded for a failure that has a
  // viable lower-UBB workaround, so it doesn't need its own trigger.
  const canExpand = hasFailure || hasWarning

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
                      return (
                      <li key={i} className="rounded border border-current/20 bg-white/40 dark:bg-black/20 px-2.5 py-2 text-xs">
                        <div>{fc.message}</div>
                        {fc.actions.length > 0 ? (
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            {fc.actions.map((a, j) => {
                              const isExternalLink = a.icon === 'external'
                              const baseClass = cn(
                                'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                                isExternalLink
                                  ? 'opacity-70 hover:opacity-100 hover:underline'
                                  : 'bg-current/10 hover:bg-current/20',
                              )
                              const iconEl =
                                a.icon === 'scroll-up' ? (
                                  <ArrowUp size={10} weight="bold" />
                                ) : a.icon === 'scroll-down' ? (
                                  <ArrowDown size={10} weight="bold" />
                                ) : a.icon === 'external' ? (
                                  <ArrowSquareOut size={10} />
                                ) : a.icon === 'users' ? (
                                  <Users size={10} weight="bold" />
                                ) : a.icon === 'universal' ? (
                                  <ArrowsClockwise size={10} weight="bold" />
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
              {result.maxSafeUniversalUbb !== Infinity ? (() => {
                const safe = result.maxSafeUniversalUbb
                const currentUbb = universalUbb?.budgetAmount ?? null
                // When hasFailure && safe === 0, there's nothing useful to say
                // here that isn't already in the failing-checks actions above.
                // The previous "individual UBBs alone exceed per-CC budgets"
                // message was wrong when the binding cap was actually the
                // unassigned-leftover allowance, so we just suppress it.
                if (hasFailure && safe === 0) return null
                if (hasFailure && safe > 0 && currentUbb !== null && currentUbb > safe) {
                  return (
                    <div className="text-xs opacity-90">
                      <span className="font-semibold">Alternative fix:</span>{' '}
                      lowering the universal UBB from {formatCurrency(currentUbb)} to{' '}
                      {formatCurrency(safe)} would satisfy the per-cost-center budgets
                      (edit it on the Universal UBB tab).
                    </div>
                  )
                }
                // In the healthy state we deliberately don't surface the max
                // safe UBB — that's an internal computation, not a question
                // users ask. The "How the budget model works" link below covers
                // anyone who wants to dig into how the math is derived.
                return null
              })() : null}
              <div className="text-xs opacity-75">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT))}
                  className="underline-offset-2 hover:underline cursor-pointer text-current"
                >
                  How the budget model works →
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
