/**
 * Collapsible banner that surfaces secondary-fetch failures from
 * `use-credentials`. Replaces the previous silent `.catch(() => [])` pattern
 * where missing cost-center attribution looked like an empty state.
 *
 * Each warning is independently dismissable; dismissing only hides it from
 * the current session (next refresh will re-evaluate).
 */

import { useState } from 'react'
import { CaretDown, CaretUp, Warning, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { PartialLoadWarning, PartialLoadFeature } from '@/hooks/use-credentials'

interface Props {
  warnings: PartialLoadWarning[]
  onDismiss: (feature: PartialLoadFeature) => void
}

export function PartialLoadBanner({ warnings, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (warnings.length === 0) return null

  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <Warning size={16} weight="duotone" className="text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="font-medium text-amber-900 dark:text-amber-100">
          Some data couldn't be loaded ({warnings.length})
        </span>
        <span className="ml-auto text-amber-700 dark:text-amber-300">
          {expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
        </span>
      </button>
      {expanded ? (
        <div className="px-3 pb-3 space-y-2 border-t border-amber-200 dark:border-amber-900">
          {warnings.map(w => (
            <div key={w.feature} className="flex items-start gap-2 pt-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-amber-900 dark:text-amber-100 text-xs">
                  {w.label}
                </div>
                <div className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 break-words">
                  {w.reason}
                </div>
                {w.suggestedAction ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 italic">
                    {w.suggestedAction}
                  </div>
                ) : null}
                {w.actionUrl ? (
                  <div className="text-xs mt-1">
                    <a
                      href={w.actionUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline font-medium text-amber-900 dark:text-amber-100 hover:text-amber-700 dark:hover:text-amber-200"
                    >
                      {w.actionLabel ?? 'Open link'} ↗
                    </a>
                  </div>
                ) : null}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Dismiss ${w.label} warning`}
                onClick={() => onDismiss(w.feature)}
                className="h-6 w-6 shrink-0 text-amber-700 dark:text-amber-300"
              >
                <X size={12} />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
