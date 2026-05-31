import { cn } from '@/lib/utils'
import type { Summary } from '@/lib/status'

interface Props {
  summary: Summary
  active: 'all' | 'over' | 'near'
  onSelectAll: () => void
  onSelectOver: () => void
  onSelectNear: () => void
}

interface Chip {
  key: 'all' | 'over' | 'near'
  label: string
  count: number
  onClick: () => void
  activeClass: string
}

/**
 * Compact chip row replacing the legacy SummaryCards block. Each chip
 * applies one of the table's status filters; counts are sourced from
 * the same summary that drives the hero so the numbers never disagree.
 * "At risk by EoM" lives on the ForecastHero tile — not duplicated here.
 */
export function FilterChips({
  summary,
  active,
  onSelectAll,
  onSelectOver,
  onSelectNear,
}: Props) {
  const chips: Chip[] = [
    {
      key: 'all',
      label: 'All',
      count: summary.total,
      onClick: onSelectAll,
      activeClass: 'border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900',
    },
    {
      key: 'over',
      label: 'Capped today',
      count: summary.over,
      onClick: onSelectOver,
      activeClass: 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200',
    },
    {
      key: 'near',
      label: 'Reaching limit',
      count: summary.near,
      onClick: onSelectNear,
      activeClass: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200',
    },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(chip => {
        const isActive = active === chip.key
        return (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onClick}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
              isActive
                ? chip.activeClass
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            {chip.label}
            <span
              className={cn(
                'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] tabular-nums',
                isActive
                  ? 'bg-white/20 dark:bg-neutral-900/20'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
              )}
            >
              {chip.count.toLocaleString()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
