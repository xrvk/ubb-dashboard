import { useMemo } from 'react'
import { Target, X } from '@phosphor-icons/react'
import { useCredentials } from '@/hooks/use-credentials'
import { formatCurrency } from '@/lib/utils'
import type { NavToIndividualTask } from '@/lib/navEvents'

interface Props {
  task: NavToIndividualTask
  onDismiss: () => void
}

/**
 * Sticky contextual banner shown beneath the tab bar on the Individual UBBs
 * page after the user deep-links from a constraint action (e.g. "Reduce UBBs
 * for N members"). Re-computes effective UBB totals live from the credentials
 * context so progress updates as the user edits per-user budgets without
 * having to scroll back up to a stale banner.
 */
export function IndividualUbbTaskBanner({ task, onDismiss }: Props) {
  const { budgets, costCenters, universalUbb } = useCredentials()

  const progress = useMemo(() => {
    const cc = costCenters.find(c => c.id === task.costCenterId)
    if (!cc) return null
    const memberLogins = new Set(
      cc.resources.filter(r => r.type === 'User').map(r => r.name.toLowerCase()),
    )
    const universalAmount = universalUbb?.budgetAmount ?? 0
    const individualByUser = new Map(
      budgets.map(b => [b.user.toLowerCase(), b.budgetAmount]),
    )
    let sum = 0
    for (const login of memberLogins) {
      const ind = individualByUser.get(login)
      sum += ind !== undefined ? ind : universalAmount
    }
    const overBy = Math.max(0, sum - task.ccBudget)
    const reducedBy = Math.max(0, task.actualUbbSum - sum)
    const resolved = sum <= task.ccBudget
    return { currentSum: sum, overBy, reducedBy, resolved }
  }, [task, costCenters, budgets, universalUbb])

  if (!progress) return null

  return (
    <div
      role="status"
      className={
        progress.resolved
          ? 'rounded-md border px-3 py-2 text-sm border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'
          : 'rounded-md border px-3 py-2 text-sm border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
      }
    >
      <div className="flex items-start gap-2">
        <Target size={18} weight="duotone" className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {progress.resolved
              ? `Cost center "${task.costCenterName}" now fits its budget`
              : `Reducing UBBs for cost center "${task.costCenterName}"`}
          </div>
          <div className="mt-0.5 text-xs opacity-90">
            {task.memberCount} member{task.memberCount === 1 ? '' : 's'},{' '}
            effective UBBs total <span className="font-semibold">{formatCurrency(progress.currentSum)}</span>{' '}
            against a <span className="font-semibold">{formatCurrency(task.ccBudget)}</span> cost center budget.{' '}
            {progress.resolved ? (
              <span>All set.</span>
            ) : (
              <span>
                Reduce by another <span className="font-semibold">{formatCurrency(progress.overBy)}</span> to fit.
              </span>
            )}
            {progress.reducedBy > 0 ? (
              <span className="opacity-80"> (reduced {formatCurrency(progress.reducedBy)} so far)</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
          title="Dismiss task"
          aria-label="Dismiss task"
        >
          {progress.resolved ? 'Done' : 'Dismiss'}
          <X size={12} weight="bold" />
        </button>
      </div>
    </div>
  )
}
