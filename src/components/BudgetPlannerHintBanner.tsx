import { Warning, X } from '@phosphor-icons/react'
import type { PlannerHighlightDetail } from '@/lib/navEvents'

interface Props {
  hint: PlannerHighlightDetail
  onDismiss: () => void
}

/**
 * Sticky contextual banner shown beneath the tab bar on the Budget model
 * page after the user deep-links from a constraint action (e.g. "Lower
 * cost-center budgets by $X"). Mirrors IndividualUlbTaskBanner so cross-tab
 * fix actions feel consistent. Stays put until the user dismisses it
 * (no auto-timeout) since the corrective edit may take a moment.
 */
export function BudgetPlannerHintBanner({ hint, onDismiss }: Props) {
  return (
    <div
      role="status"
      className="rounded-md border px-3 py-2 text-sm border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="flex items-start gap-2">
        <Warning size={18} weight="duotone" className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Adjustments needed here</div>
          <div className="mt-0.5 text-xs opacity-90">{hint.message}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
          title="Dismiss hint"
          aria-label="Dismiss hint"
        >
          Dismiss
          <X size={12} weight="bold" />
        </button>
      </div>
    </div>
  )
}
