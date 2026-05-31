import { useMemo, useState } from 'react'
import { CheckCircle, Warning, XCircle, CaretDown, CaretUp } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { buildCostCenterIndex } from '@/lib/api'
import { computeBudgetConstraints } from '@/lib/budgetConstraints'
import { formatCurrency, cn } from '@/lib/utils'

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
  } = useCredentials()
  const [expanded, setExpanded] = useState(false)

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

  // Don't render anything if we have nothing to constrain against.
  // (e.g. demo mode, or a freshly connected enterprise before data loads)
  const hasAnyEnvelope =
    enterpriseBudget !== null || costCenterBudgetsByName.size > 0 || universalUlb !== null
  if (!hasAnyEnvelope) return null

  const failingChecks: string[] = []
  for (const c of result.checks.perCc) {
    if (!c.check.ok) {
      failingChecks.push(
        `Cost center "${c.costCenterName}" is over by ${formatCurrency(c.check.overBy)} — ${c.memberCount} member${c.memberCount === 1 ? '' : 's'} have effective ULBs totaling ${formatCurrency(c.check.actual)} against a ${formatCurrency(c.check.allowed)} budget.`,
      )
    }
  }
  if (result.checks.ccVsEnterprise && !result.checks.ccVsEnterprise.ok) {
    failingChecks.push(
      `Cost-center budgets total ${formatCurrency(result.checks.ccVsEnterprise.actual)}, which exceeds the enterprise budget of ${formatCurrency(result.checks.ccVsEnterprise.allowed)} by ${formatCurrency(result.checks.ccVsEnterprise.overBy)}.`,
    )
  }
  if (result.checks.unassignedLeftover && !result.checks.unassignedLeftover.ok) {
    failingChecks.push(
      `Users outside a budgeted cost center have effective ULBs totaling ${formatCurrency(result.checks.unassignedLeftover.actual)}, exceeding the ${result.mode === 'umbrella' ? 'leftover enterprise allowance' : 'enterprise budget'} of ${formatCurrency(result.checks.unassignedLeftover.allowed)} by ${formatCurrency(result.checks.unassignedLeftover.overBy)}.`,
    )
  }

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
                  <ul className="mt-1 list-disc pl-5 space-y-1 text-xs">
                    {failingChecks.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
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
