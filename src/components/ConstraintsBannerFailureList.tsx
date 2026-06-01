import { useState } from 'react'
import {
  CaretDown,
  CaretUp,
  ArrowDown,
  ArrowUp,
  ArrowSquareOut,
  Users,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import { cn, formatCurrency, openExternal } from '@/lib/utils'
import {
  type FailingCheck,
  splitFailingChecks,
} from '@/lib/constraintsBannerFailures'

function FailingCheckItem({ fc }: { fc: FailingCheck }) {
  return (
    <li className="rounded border border-current/20 bg-white/40 dark:bg-black/20 px-2.5 py-2 text-xs">
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
}

/**
 * Renders the failing-checks list with a top-N cap on `cc-over` items.
 * Singletons (`cc-vs-ent`, `leftover`) always render in full. When the
 * per-CC list exceeds `CC_OVER_VISIBLE_CAP`, the top N stay inline and
 * the rest are tucked behind a scrollable "Show all N more" toggle so
 * the banner can never blow past viewport height at scale.
 */
export function FailureList({ checks }: { checks: readonly FailingCheck[] }) {
  const split = splitFailingChecks(checks)
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = split.ccOverHidden.length
  const hasHidden = hiddenCount > 0

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Failing checks</div>
      {hasHidden ? (
        <div className="mt-1 text-[11px] opacity-75">
          Showing top {split.ccOverVisible.length} of {split.ccOverTotal} cost centers over budget · total overshoot {formatCurrency(split.ccOverTotalOverBy)}
        </div>
      ) : null}
      <ul className="mt-1 space-y-2">
        {split.singletons.map((fc, i) => (
          <FailingCheckItem key={`s-${i}`} fc={fc} />
        ))}
        {split.ccOverVisible.map((fc, i) => (
          <FailingCheckItem key={`v-${i}`} fc={fc} />
        ))}
      </ul>
      {hasHidden ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
            aria-expanded={showAll}
          >
            {showAll ? `Hide ${hiddenCount} more` : `Show all ${hiddenCount} more`}
            {showAll ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
          </button>
          {showAll ? (
            <ul className="mt-2 space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {split.ccOverHidden.map((fc, i) => (
                <FailingCheckItem key={`h-${i}`} fc={fc} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
