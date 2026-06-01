import { cn } from '@/lib/utils'
import { CC_HEALTH_LABEL, CC_HEALTH_ORDER, type CcHealth } from '@/lib/ccStatus'

interface Props {
  /** Set of currently-selected health buckets. Empty = "All". */
  selected: ReadonlySet<CcHealth>
  onChange: (next: Set<CcHealth>) => void
  /** Total count per bucket (rendered in the chip). */
  counts: Record<CcHealth, number>
  /** Total rows across all buckets (rendered in the "All" chip). */
  total: number
  className?: string
}

const TONES: Record<CcHealth, { idle: string; active: string }> = {
  over: {
    idle:
      'border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40',
    active:
      'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200',
  },
  near: {
    idle:
      'border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40',
    active:
      'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  },
  healthy: {
    idle:
      'border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40',
    active:
      'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200',
  },
  uncapped: {
    idle:
      'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
    active:
      'bg-neutral-200 dark:bg-neutral-800 border-neutral-400 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100',
  },
}

/**
 * Chip row that toggles a multi-select status filter on the Dashboard
 * CC card. Empty selection means "All" (no filter applied) so the
 * default is the least-surprising state.
 */
export function CcStatusChips({ selected, onChange, counts, total, className }: Props) {
  const allActive = selected.size === 0
  const toggle = (h: CcHealth) => {
    const next = new Set(selected)
    if (next.has(h)) next.delete(h)
    else next.add(h)
    onChange(next)
  }
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      <button
        type="button"
        onClick={() => onChange(new Set())}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 h-6 text-[11px] font-medium tabular-nums',
          allActive
            ? 'bg-neutral-900 dark:bg-neutral-100 border-neutral-900 dark:border-neutral-100 text-white dark:text-neutral-900'
            : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800',
        )}
        aria-pressed={allActive}
      >
        All <span className="opacity-70">{total.toLocaleString()}</span>
      </button>
      {CC_HEALTH_ORDER.map(h => {
        const active = selected.has(h)
        const tones = TONES[h]
        const count = counts[h]
        return (
          <button
            key={h}
            type="button"
            onClick={() => toggle(h)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 h-6 text-[11px] font-medium tabular-nums',
              active ? tones.active : tones.idle,
              count === 0 ? 'opacity-50' : '',
            )}
            aria-pressed={active}
          >
            {CC_HEALTH_LABEL[h]} <span className="opacity-70">{count.toLocaleString()}</span>
          </button>
        )
      })}
    </div>
  )
}
