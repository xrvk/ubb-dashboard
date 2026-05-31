/* eslint-disable react-refresh/only-export-components */
/**
 * `?debug=1` opt-in inspector. Renders a tiny "ⓘ" badge next to a tile that
 * pops a tooltip describing the data lineage: source API field(s), formula,
 * and the raw input values used to derive the rendered value.
 *
 * Disabled (renders null) unless the URL has `?debug=1`. Safe to leave in
 * production — has no effect for normal users.
 */
import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

export interface DebugInfo {
  /** Where the value comes from. E.g. `multi_user_customer budget.consumed_amount`. */
  source: string
  /** Plain-text formula. E.g. `mtd + (mtd/daysElapsed) × daysRemaining`. */
  formula: string
  /** Inputs, as key/value pairs. Pre-formatted strings. */
  inputs: Record<string, string | number>
  /** Optional: longer note shown beneath the inputs. */
  note?: string
}

function isDebugMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('debug') === '1'
}

export function useDebugMode(): boolean {
  const [on, setOn] = useState(isDebugMode)
  useEffect(() => {
    const fn = () => setOn(isDebugMode())
    window.addEventListener('popstate', fn)
    return () => window.removeEventListener('popstate', fn)
  }, [])
  return on
}

/**
 * Inline "ⓘ" badge that reveals a tooltip with the tile's data lineage.
 * Returns null when debug mode is off.
 */
export function DebugBadge({ debug }: { debug: DebugInfo }) {
  const on = useDebugMode()
  if (!on) return null
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-amber-500 text-[10px] font-mono text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            aria-label="Show data lineage"
          >
            i
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-md text-left">
          <div className="grid gap-1.5 p-1">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Source</div>
            <div className="font-mono text-[11px] leading-snug">{debug.source}</div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 mt-1">Formula</div>
            <div className="font-mono text-[11px] leading-snug">{debug.formula}</div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 mt-1">Inputs</div>
            <div className="font-mono text-[11px] leading-snug">
              {Object.entries(debug.inputs).map(([k, v]) => (
                <div key={k}>
                  <span className="text-neutral-500">{k}</span> = {String(v)}
                </div>
              ))}
            </div>
            {debug.note ? (
              <div className="text-[10px] text-neutral-500 mt-1 italic">{debug.note}</div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
