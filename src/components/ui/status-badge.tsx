import { cn } from '@/lib/utils'
import type { Status } from '@/lib/status'

const styles: Record<Status, string> = {
  over: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-900',
  near: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-900',
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900',
}

const labels: Record<Status, string> = {
  over: 'Over budget',
  near: 'Near limit',
  ok: 'OK',
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', styles[status], className)}>
      {labels[status]}
    </span>
  )
}
