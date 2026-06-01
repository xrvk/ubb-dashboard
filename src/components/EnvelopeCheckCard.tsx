import { useMemo } from 'react'
import { CheckCircle, Warning, ArrowsClockwise, ArrowSquareOut } from '@phosphor-icons/react'
import {
  computeBudgetConstraints,
  previewConstraintsWithProposedUbb,
  type BudgetCheck,
  type ComputeBudgetConstraintsInput,
  type PerCcCheck,
} from '@/lib/budgetConstraints'
import { proposeLowerUniversalUbb } from '@/lib/budgetAutoFix'
import { formatCurrency, cn } from '@/lib/utils'
import { NAV_TO_BUDGET_MODEL_EVENT } from '@/lib/navEvents'

interface Props {
  /** Proposed universal UBB in dollars (what the admin is about to apply). */
  proposedUsd: number
  /** Same inputs the live ConstraintsBanner uses. */
  constraintsInput: ComputeBudgetConstraintsInput
  /**
   * Called when the admin clicks "Snap UBB to max safe". Receives the safe
   * USD value, already rounded to a whole dollar so it matches what the
   * apply path will write (the planner ceils AICs→USD when applying).
   */
  onSnapToMaxSafe: (usd: number) => void
}

/**
 * A leftover/perCc check counts as caused by the proposed UBB when the
 * proposed value made it strictly worse than baseline. Pure failures that
 * already existed (e.g. CC budgets > ent budget, or a CC overcommitted by
 * existing individual UBBs) belong to ConstraintsBanner on other tabs, not
 * here — surfacing them on the Universal UBB page would misattribute blame
 * to the cap the admin is currently choosing.
 */
function wasWorsenedByProposal(baseline: BudgetCheck | null, preview: BudgetCheck | null): boolean {
  if (!preview || preview.ok) return false
  if (!baseline) return true
  return preview.actual > baseline.actual
}

function perCcWorsened(
  baseline: PerCcCheck | undefined,
  preview: PerCcCheck,
): boolean {
  if (preview.check.ok) return false
  if (!baseline) return true
  return preview.check.actual > baseline.check.actual
}

/**
 * Pre-flight envelope check rendered under Step 2 of the Universal-UBB
 * planner. Recomputes the constraint engine with the proposed UBB
 * substituted so the admin can see, before applying, whether the chosen
 * cap would breach the enterprise envelope or any per-cost-center budget.
 *
 * Renders nothing when the enterprise has no envelope at all — there's
 * nothing to check against, and the ConstraintsBanner already warns about
 * unbounded coverage on other tabs.
 */
export function EnvelopeCheckCard({ proposedUsd, constraintsInput, onSnapToMaxSafe }: Props) {
  const baseline = useMemo(
    () => computeBudgetConstraints(constraintsInput),
    [constraintsInput],
  )
  const preview = useMemo(
    () => previewConstraintsWithProposedUbb(constraintsInput, proposedUsd),
    [constraintsInput, proposedUsd],
  )

  // Snap proposal is computed against the *proposed* UBB, then floored to a
  // whole dollar so the displayed label matches what the apply path will
  // actually write (apply ceils AICs/100 → whole USD).
  const snap = useMemo(() => {
    const proposal = proposeLowerUniversalUbb(preview, proposedUsd)
    if (!proposal) return null
    const wholeUsd = Math.floor(proposal.newValue)
    if (wholeUsd <= 0) return null
    return { newValue: wholeUsd }
  }, [preview, proposedUsd])

  const { enterpriseBudget } = constraintsInput
  const hasEnvelope = enterpriseBudget !== null || constraintsInput.ccBudgetsByName.size > 0
  if (!hasEnvelope) return null

  // Only surface failures the proposed UBB introduced or worsened — pure
  // pre-existing breaches are ConstraintsBanner's job on other tabs. Note
  // ccVsEnterprise doesn't depend on the universal UBB at all, so we never
  // attribute it to the proposal.
  const leftover = preview.checks.unassignedLeftover
  const leftoverFail = wasWorsenedByProposal(
    baseline.checks.unassignedLeftover,
    leftover,
  )
  const baselineCcById = new Map(baseline.checks.perCc.map(c => [c.costCenterId, c]))
  const failingCcs = preview.checks.perCc.filter(c =>
    perCcWorsened(baselineCcById.get(c.costCenterId), c),
  )
  const anyFail = leftoverFail || failingCcs.length > 0

  const styles = anyFail
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200'
    : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'
  const Icon = anyFail ? Warning : CheckCircle

  const projected = leftover?.actual ?? null
  const allowance = leftover?.allowed ?? null
  const overBy = leftover && !leftover.ok ? leftover.overBy : 0
  const headroom = leftover && leftover.ok ? leftover.allowed - leftover.actual : 0

  // Raise-ent is only a useful remediation when the failure actually
  // involves the ent envelope (leftover check). For pure perCc failures,
  // raising ent doesn't fix the bound CC budget — admins should adjust the
  // CC budget or lower the UBB for those CC's members instead.
  const showRaiseEnt = leftoverFail && enterpriseBudget !== null

  return (
    <div role="status" className={cn('rounded-md border px-3 py-2 text-xs', styles)}>
      <div className="flex items-start gap-2">
        <Icon size={16} weight="duotone" className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">
            {anyFail
              ? leftoverFail
                ? 'Proposed UBB exceeds the enterprise envelope'
                : 'Proposed UBB exceeds a cost-center budget'
              : 'Within enterprise envelope'}
          </div>

          {leftover ? (
            <div className="mt-1 grid gap-1 sm:grid-cols-3">
              <div>
                <div className="opacity-70">Projected leftover spend</div>
                <div className="font-semibold">{formatCurrency(projected ?? 0)}</div>
              </div>
              <div>
                <div className="opacity-70">
                  {preview.mode === 'umbrella' ? 'Enterprise leftover allowance' : 'Enterprise budget'}
                </div>
                <div className="font-semibold">{formatCurrency(allowance ?? 0)}</div>
              </div>
              <div>
                <div className="opacity-70">{leftoverFail ? 'Over by' : 'Headroom'}</div>
                <div className="font-semibold">
                  {leftoverFail ? formatCurrency(overBy) : formatCurrency(headroom)}
                </div>
              </div>
            </div>
          ) : null}

          {failingCcs.length > 0 ? (
            <ul className="mt-1.5 list-disc pl-5 space-y-0.5 opacity-90">
              {failingCcs.map(c => (
                <li key={c.costCenterId}>
                  Cost center <span className="font-medium">"{c.costCenterName}"</span>{' '}
                  would be over by {formatCurrency(c.check.overBy)} ({c.memberCount} member{c.memberCount === 1 ? '' : 's'}, {formatCurrency(c.check.actual)} of {formatCurrency(c.check.allowed)}).
                </li>
              ))}
            </ul>
          ) : null}

          {anyFail ? (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {snap ? (
                <button
                  type="button"
                  onClick={() => onSnapToMaxSafe(snap.newValue)}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-current/10 hover:bg-current/20"
                >
                  <ArrowsClockwise size={10} weight="bold" />
                  Snap UBB to max safe ({formatCurrency(snap.newValue)})
                </button>
              ) : null}
              {showRaiseEnt ? (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(NAV_TO_BUDGET_MODEL_EVENT))}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-current/10 hover:bg-current/20"
                >
                  Raise enterprise budget
                  <ArrowSquareOut size={10} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
