import { Warning, ShieldWarning, ArrowRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useBudgetConstraints } from '@/hooks/use-budget-constraints'
import { formatCurrency } from '@/lib/utils'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_ORG_BUDGET_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
} from '@/lib/navEvents'

/**
 * Surface for the single golden-rule check in the org variant:
 *   Σ effective ULBs ≤ org budget
 *
 * When the check fails, we show:
 *   - The over-by amount + the actual vs. allowed totals.
 *   - Two corrective actions: raise the org budget OR lower the universal ULB
 *     (with `maxSafeUniversalUlb` already computed by the constraint engine).
 *
 * Soft warnings (`prevent_further_usage_off`, `unbounded_user_coverage`) are
 * surfaced separately at the bottom so the user sees them even when the hard
 * check passes.
 */
export function ConstraintsBanner() {
  const result = useBudgetConstraints()
  const { mode, mainCheck, warnings, maxSafeUniversalUlb, universalSeatCount } = result

  const failing = mainCheck && !mainCheck.ok
  const hasWarnings = warnings.length > 0

  // Nothing to show when everything is fine and there are no warnings.
  if (!failing && !hasWarnings) return null

  const dispatch = (event: string) => window.dispatchEvent(new CustomEvent(event))

  return (
    <div className="grid gap-3">
      {failing && mainCheck ? (
        <div className="rounded-md border border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 px-4 py-3">
          <div className="flex items-start gap-2">
            <Warning size={20} weight="duotone" className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                ULB allocations exceed the org budget by{' '}
                {formatCurrency(mainCheck.overBy)}
              </div>
              <p className="mt-1 text-sm opacity-90">
                Total effective per-user caps sum to{' '}
                <span className="font-semibold">{formatCurrency(mainCheck.actual)}</span>{' '}
                across all Copilot seats, but the org-level budget only
                allows <span className="font-semibold">{formatCurrency(mainCheck.allowed)}</span>.
                Pick one of the actions below to bring the totals back in line.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => dispatch(NAV_TO_ORG_BUDGET_EVENT)}
                >
                  Raise org budget to {formatCurrency(mainCheck.actual)}
                  <ArrowRight size={12} weight="bold" />
                </Button>
                {Number.isFinite(maxSafeUniversalUlb) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dispatch(NAV_TO_UNIVERSAL_EVENT)}
                  >
                    Lower universal ULB to {formatCurrency(maxSafeUniversalUlb)}
                    <ArrowRight size={12} weight="bold" />
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dispatch(NAV_TO_INDIVIDUAL_EVENT)}
                >
                  Review individual ULBs
                  <ArrowRight size={12} weight="bold" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dispatch(NAV_TO_BUDGET_MODEL_EVENT)}
                >
                  How this is calculated
                </Button>
              </div>
              {universalSeatCount > 0 && Number.isFinite(maxSafeUniversalUlb) ? (
                <p className="mt-2 text-xs opacity-75">
                  {universalSeatCount.toLocaleString()} seat
                  {universalSeatCount === 1 ? '' : 's'} draw from the universal
                  ULB. Lowering the universal cap is usually the lowest-impact
                  fix because it only affects users without an individual ULB.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {hasWarnings ? (
        <div className="rounded-md border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldWarning size={20} weight="duotone" className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                {warnings.length === 1
                  ? 'One soft warning'
                  : `${warnings.length} soft warnings`}
              </div>
              <ul className="mt-1 space-y-1 text-sm opacity-90">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'no-org-budget' && !failing ? (
        <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 px-4 py-3 text-sm">
          No org-level budget set, so there's no envelope to check ULBs against.{' '}
          <button
            className="underline underline-offset-2 hover:no-underline"
            onClick={() => dispatch(NAV_TO_ORG_BUDGET_EVENT)}
          >
            Create one
          </button>{' '}
          to enforce the cap.
        </div>
      ) : null}
    </div>
  )
}
