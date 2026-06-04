import { useEffect, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'

interface Props {
  loaded: number
  total: number | undefined
}

/**
 * Threshold above which we surface a "this may take a minute" hint.
 * Below this, initial load is fast enough that the running counter
 * alone communicates progress without setting wait expectations.
 */
const LARGE_ENTERPRISE_BUDGET_THRESHOLD = 5000

/**
 * Defer mounting the banner briefly so sub-second loads (the common
 * case) don't flash a banner that disappears before it can be read.
 */
const REVEAL_DELAY_MS = 300

/**
 * App-wide sticky banner shown beneath the tab bar during initial
 * connect/refresh, while the budgets fetch streams in. Driven by
 * `loadProgress` from useCredentials, which today is emitted only by
 * `fetchAllAiCreditsBudgets`. Once budgets are done but other parallel
 * fetches (seats, cost centers, usage summary) are still in flight,
 * we switch the copy to "Finalizing…" rather than implying the load
 * is complete.
 */
export function LoadProgressBanner({ loaded, total }: Props) {
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setRevealed(true), REVEAL_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!revealed) return null

  const knownTotal = typeof total === 'number' && total > 0
  const finalizing = knownTotal && loaded >= total
  const isLargeOrg = knownTotal && total > LARGE_ENTERPRISE_BUDGET_THRESHOLD
  const pct = knownTotal ? Math.min(100, (loaded / total) * 100) : null

  const message = finalizing
    ? 'Finalizing organization data…'
    : knownTotal
      ? `Loading budgets… ${loaded.toLocaleString()} of ${total.toLocaleString()}`
      : `Loading budgets… ${loaded.toLocaleString()}`

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border px-3 py-2 text-sm border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-200"
    >
      <div className="flex items-start gap-2">
        <CircleNotch size={18} weight="duotone" className="mt-0.5 shrink-0 animate-spin" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{message}</div>
          {isLargeOrg ? (
            <div className="mt-0.5 text-xs opacity-90">
              Large organization — initial load may take ~1 min.
            </div>
          ) : null}
          {pct !== null ? (
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-sky-200/60 dark:bg-sky-900/60"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out dark:bg-sky-400"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
