/**
 * Consumption Curve — SVG line graph with draggable threshold + UBB lines.
 *
 * Vendored from xrvk/copilot-budget-command-calculator
 * (src/components/ConsumptionAnalysisPanel.tsx → ConsumptionCurve sub-component).
 *
 * Simplifications from the upstream:
 *   - Primary unit is AICs (not USD). The UBB line is expressed in AICs.
 *   - The "Power user UBB" line is optional (pass `powerUbbAICs={undefined}`
 *     to hide). Our universal-UBB sizing only needs one UBB line.
 *   - No enterprise-budget / pool-overrun warning (CCC-specific math).
 *   - Theme classes translated from CCC's semantic tokens (primary/warning/
 *     muted-foreground) to this project's raw Tailwind palette.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CsvUserUsage } from '@/lib/consumptionAnalysis'

function formatAICs(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

const AICS_PER_USD = 100
function formatUsd(aics: number): string {
  const usd = Math.ceil(aics / AICS_PER_USD)
  return `$${usd.toLocaleString('en-US')}`
}

interface ConsumptionCurveProps {
  /** Users sorted DESCENDING by totalAICs (heaviest first). */
  sortedUsers: CsvUserUsage[]
  thresholdAICs: number
  powerUserCount: number
  /** Universal UBB in AICs (the cap the admin is sizing). */
  ubbAICs: number
  /** Optional: power-user UBB in AICs. Hidden when undefined. */
  powerUbbAICs?: number
  ubbIsOverridden?: boolean
  powerUbbIsOverridden?: boolean
  onUbbChange?: (newAICs: number | null) => void
  onPowerUbbChange?: (newAICs: number | null) => void
  onSetCutoff?: (aics: number) => void
}

export function ConsumptionCurve({
  sortedUsers,
  thresholdAICs,
  powerUserCount,
  ubbAICs,
  powerUbbAICs,
  ubbIsOverridden,
  powerUbbIsOverridden,
  onUbbChange,
  onPowerUbbChange,
  onSetCutoff,
}: ConsumptionCurveProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [dragging, setDragging] = useState<'ubb' | 'power' | 'threshold' | null>(null)
  const [autoZoom, setAutoZoom] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const totalN = sortedUsers.length
  const VB_W = 1000
  const VB_H = 220
  const PAD_L = 8
  const PAD_R = 8
  const PAD_T = 12
  const PAD_B = 28
  const plotW = VB_W - PAD_L - PAD_R
  const plotH = VB_H - PAD_T - PAD_B

  // Auto-zoom strategy: target the exponential takeoff (users with >= 10% of
  // top-consumer AICs) to occupy ~25% of the chart width. We find that
  // "knee" cohort then keep ~4x as many users in total, so the flat tail
  // fills the left 75% and the curve fills the right 25%. Stable while the
  // user drags UBB because the anchor is top-consumer AICs, not UBB.
  const trimmedSorted = useMemo(() => {
    if (!autoZoom || totalN === 0) return sortedUsers
    const topAICs = sortedUsers[0].totalAICs
    if (topAICs <= 0) return sortedUsers
    const kneeFloor = topAICs * 0.1
    const firstBelowKnee = sortedUsers.findIndex(u => u.totalAICs < kneeFloor)
    const kneeCount = firstBelowKnee === -1 ? totalN : firstBelowKnee
    const targetVisible = Math.max(20, kneeCount * 4)
    const keep = Math.max(powerUserCount + 1, Math.min(totalN, targetVisible))
    return sortedUsers.slice(0, keep)
  }, [sortedUsers, autoZoom, totalN, powerUserCount])
  const hiddenTailCount = totalN - trimmedSorted.length
  const displayUsers = useMemo(() => [...trimmedSorted].reverse(), [trimmedSorted])
  const n = displayUsers.length

  // Power users occupy the RIGHT end: indices [powerStartIdx .. n-1].
  const powerStartIdx = Math.max(0, n - powerUserCount)

  const maxAICs = useMemo(() => {
    if (n === 0) return 1
    return Math.max(1, sortedUsers[0].totalAICs)
  }, [sortedUsers, n])

  const xForIndex = useCallback(
    (i: number) => (n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * plotW),
    [n, plotW],
  )
  const yForAICs = useCallback(
    (aics: number) => PAD_T + plotH - (aics / maxAICs) * plotH,
    [maxAICs, plotH],
  )

  const pathD = useMemo(() => {
    if (n === 0) return ''
    return displayUsers
      .map(
        (u, i) =>
          `${i === 0 ? 'M' : 'L'}${xForIndex(i).toFixed(2)},${yForAICs(u.totalAICs).toFixed(2)}`,
      )
      .join(' ')
  }, [displayUsers, n, xForIndex, yForAICs])

  const baselineY = PAD_T + plotH
  const buildArea = useCallback(
    (startIdx: number, endIdx: number) => {
      if (endIdx < startIdx) return ''
      const points = displayUsers
        .slice(startIdx, endIdx + 1)
        .map(
          (u, i) =>
            `L${xForIndex(startIdx + i).toFixed(2)},${yForAICs(u.totalAICs).toFixed(2)}`,
        )
        .join(' ')
      return `M${xForIndex(startIdx).toFixed(2)},${baselineY} ${points} L${xForIndex(endIdx).toFixed(2)},${baselineY} Z`
    },
    [displayUsers, xForIndex, yForAICs, baselineY],
  )

  const regularAreaD = useMemo(() => {
    if (powerStartIdx <= 0) return ''
    return buildArea(0, powerStartIdx - 1)
  }, [buildArea, powerStartIdx])

  const powerAreaD = useMemo(() => {
    if (powerUserCount === 0 || powerStartIdx >= n) return ''
    return buildArea(powerStartIdx, n - 1)
  }, [buildArea, powerStartIdx, powerUserCount, n])

  const thresholdX =
    powerUserCount > 0 && powerStartIdx < n && powerStartIdx > 0
      ? (xForIndex(powerStartIdx - 1) + xForIndex(powerStartIdx)) / 2
      : powerUserCount === 0
        ? VB_W - PAD_R
        : PAD_L

  const ubbY = ubbAICs > 0 && ubbAICs <= maxAICs ? yForAICs(ubbAICs) : null
  const powerUbbY =
    powerUbbAICs !== undefined && powerUbbAICs > 0 && powerUbbAICs <= maxAICs
      ? yForAICs(powerUbbAICs)
      : null
  const labelsOverlap =
    ubbY !== null && powerUbbY !== null && Math.abs(powerUbbY - ubbY) < 14

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      if (!svgRef.current || n === 0) return null
      const rect = svgRef.current.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * VB_W
      if (relX < PAD_L) return 0
      if (relX > VB_W - PAD_R) return n - 1
      const ratio = (relX - PAD_L) / plotW
      return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))))
    },
    [n, plotW],
  )

  const aicsFromClientY = useCallback(
    (clientY: number): number => {
      if (!svgRef.current) return 0
      const rect = svgRef.current.getBoundingClientRect()
      const relY = ((clientY - rect.top) / rect.height) * VB_H
      const clampedY = Math.max(PAD_T, Math.min(PAD_T + plotH, relY))
      const aics = maxAICs * (1 - (clampedY - PAD_T) / plotH)
      return Math.max(1, Math.round(aics))
    },
    [plotH, maxAICs],
  )

  const handleLinePointerDown = useCallback(
    (line: 'ubb' | 'power' | 'threshold', e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation()
      if (line === 'ubb' && !onUbbChange) return
      if (line === 'power' && !onPowerUbbChange) return
      if (line === 'threshold' && !onSetCutoff) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(line)
    },
    [onUbbChange, onPowerUbbChange, onSetCutoff],
  )

  const handleLinePointerMove = useCallback(
    (line: 'ubb' | 'power' | 'threshold', e: React.PointerEvent<SVGGElement>) => {
      if (dragging !== line) return
      e.stopPropagation()
      if (line === 'threshold' && onSetCutoff) {
        const idx = indexFromClientX(e.clientX)
        if (idx !== null) onSetCutoff(Math.round(displayUsers[idx].totalAICs))
        return
      }
      if (line === 'ubb' && onUbbChange) onUbbChange(aicsFromClientY(e.clientY))
      if (line === 'power' && onPowerUbbChange) onPowerUbbChange(aicsFromClientY(e.clientY))
    },
    [dragging, aicsFromClientY, onUbbChange, onPowerUbbChange, onSetCutoff, indexFromClientX, displayUsers],
  )

  const handleLinePointerUp = useCallback(
    (_line: 'ubb' | 'power' | 'threshold', e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation()
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      setDragging(null)
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => setHoverIndex(indexFromClientX(e.clientX)),
    [indexFromClientX],
  )
  const handleMouseLeave = useCallback(() => setHoverIndex(null), [])

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onSetCutoff || dragging !== null) return
      const idx = indexFromClientX(e.clientX)
      if (idx === null) return
      onSetCutoff(Math.round(displayUsers[idx].totalAICs))
    },
    [onSetCutoff, dragging, indexFromClientX, displayUsers],
  )

  const hoverUser = hoverIndex !== null ? displayUsers[hoverIndex] : null
  const hoverX = hoverIndex !== null ? xForIndex(hoverIndex) : null
  const hoverY = hoverUser ? yForAICs(hoverUser.totalAICs) : null
  const hoverRank = hoverIndex !== null ? n - hoverIndex : null

  if (n === 0) {
    return (
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 p-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
        No user data to display. Upload a usage report CSV to populate the curve.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md bg-neutral-50 dark:bg-neutral-900/40 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className={`w-full h-[220px] select-none ${onSetCutoff ? 'cursor-crosshair' : ''}`}
          onClick={handleSvgClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Gridlines */}
          {[0.25, 0.5, 0.75].map(frac => (
            <line
              key={frac}
              x1={PAD_L}
              x2={VB_W - PAD_R}
              y1={PAD_T + plotH * frac}
              y2={PAD_T + plotH * frac}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2,4"
              className="text-neutral-300 dark:text-neutral-700"
            />
          ))}

          {/* Filled areas */}
          {powerAreaD && <path d={powerAreaD} className="fill-orange-300/55 dark:fill-orange-500/20" />}
          {regularAreaD && <path d={regularAreaD} className="fill-amber-200/50 dark:fill-amber-500/10" />}

          {/* Curve line */}
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-neutral-700 dark:text-neutral-300"
          />

          {/* UBB reference line (draggable) */}
          {ubbY !== null && (
            <g
              style={{ cursor: onUbbChange ? 'ns-resize' : 'default' }}
              onPointerDown={e => handleLinePointerDown('ubb', e)}
              onPointerMove={e => handleLinePointerMove('ubb', e)}
              onPointerUp={e => handleLinePointerUp('ubb', e)}
              onPointerCancel={e => handleLinePointerUp('ubb', e)}
              onMouseMove={e => {
                e.stopPropagation()
                setHoverIndex(null)
              }}
              onMouseEnter={() => setHoverIndex(null)}
              onClick={e => e.stopPropagation()}
            >
              <line x1={PAD_L} x2={VB_W - PAD_R} y1={ubbY} y2={ubbY} stroke="transparent" strokeWidth={12} />
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={ubbY}
                y2={ubbY}
                stroke="currentColor"
                strokeWidth={dragging === 'ubb' ? 2 : 1}
                strokeDasharray="4,3"
                className="text-amber-800 dark:text-amber-300"
              />
              {onUbbChange && (
                <circle
                  cx={VB_W - PAD_R}
                  cy={ubbY}
                  r={dragging === 'ubb' ? 5 : 3.5}
                  className="fill-amber-800 dark:fill-amber-300"
                />
              )}
              <text
                x={VB_W - PAD_R - 12}
                y={ubbY - 3}
                textAnchor="end"
                className="fill-amber-900 dark:fill-amber-200 text-[10px] font-medium pointer-events-none"
              >
                Universal UBB {formatUsd(ubbAICs)}{ubbIsOverridden ? ' (custom)' : ''}
              </text>
            </g>
          )}

          {/* Power UBB line (draggable, optional) */}
          {powerUbbY !== null && powerUbbAICs !== undefined && (
            <g
              style={{ cursor: onPowerUbbChange ? 'ns-resize' : 'default' }}
              onPointerDown={e => handleLinePointerDown('power', e)}
              onPointerMove={e => handleLinePointerMove('power', e)}
              onPointerUp={e => handleLinePointerUp('power', e)}
              onPointerCancel={e => handleLinePointerUp('power', e)}
              onMouseMove={e => {
                e.stopPropagation()
                setHoverIndex(null)
              }}
              onMouseEnter={() => setHoverIndex(null)}
              onClick={e => e.stopPropagation()}
            >
              <line x1={PAD_L} x2={VB_W - PAD_R} y1={powerUbbY} y2={powerUbbY} stroke="transparent" strokeWidth={12} />
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={powerUbbY}
                y2={powerUbbY}
                stroke="currentColor"
                strokeWidth={dragging === 'power' ? 2 : 1}
                strokeDasharray="4,3"
                className="text-orange-700 dark:text-orange-400"
              />
              {onPowerUbbChange && (
                <circle
                  cx={VB_W - PAD_R}
                  cy={powerUbbY}
                  r={dragging === 'power' ? 5 : 3.5}
                  className="fill-orange-700 dark:fill-orange-400"
                />
              )}
              <text
                x={VB_W - PAD_R - 12}
                y={labelsOverlap ? powerUbbY + 11 : powerUbbY - 3}
                textAnchor="end"
                className="fill-orange-800 dark:fill-orange-300 text-[10px] font-medium pointer-events-none"
              >
                Power UBB {formatUsd(powerUbbAICs)}{powerUbbIsOverridden ? ' (custom)' : ''}
              </text>
            </g>
          )}

          {/* Threshold line (draggable horizontally) */}
          <g
            style={{ cursor: onSetCutoff ? 'ew-resize' : 'default' }}
            onPointerDown={e => handleLinePointerDown('threshold', e)}
            onPointerMove={e => handleLinePointerMove('threshold', e)}
            onPointerUp={e => handleLinePointerUp('threshold', e)}
            onPointerCancel={e => handleLinePointerUp('threshold', e)}
            onMouseMove={e => {
              e.stopPropagation()
              setHoverIndex(null)
            }}
            onMouseEnter={() => setHoverIndex(null)}
          >
            <line x1={thresholdX} x2={thresholdX} y1={PAD_T} y2={PAD_T + plotH} stroke="transparent" strokeWidth={12} />
            <line
              x1={thresholdX}
              x2={thresholdX}
              y1={PAD_T}
              y2={PAD_T + plotH}
              stroke="currentColor"
              strokeWidth={dragging === 'threshold' ? 3 : 2}
              className="text-amber-800 dark:text-amber-300"
            />
            {onSetCutoff && (
              <circle
                cx={thresholdX}
                cy={PAD_T}
                r={dragging === 'threshold' ? 5 : 3.5}
                className="fill-amber-800 dark:fill-amber-300"
              />
            )}
          </g>

          {/* Hover indicator */}
          {hoverX !== null && hoverY !== null && hoverUser && (
            <g pointerEvents="none">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={PAD_T}
                y2={PAD_T + plotH}
                stroke="currentColor"
                strokeWidth={1}
                className="text-neutral-400 dark:text-neutral-500"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r={4}
                className="fill-white dark:fill-neutral-900 stroke-neutral-700 dark:stroke-neutral-200"
                strokeWidth={1.5}
              />
            </g>
          )}

          {/* Axis labels */}
          <text x={PAD_L} y={VB_H - 8} className="fill-neutral-500 dark:fill-neutral-400 text-[10px]">
            #{n} {hiddenTailCount > 0 ? '(lowest shown)' : '(lowest)'}
          </text>
          <text
            x={VB_W - PAD_R}
            y={VB_H - 8}
            textAnchor="end"
            className="fill-neutral-500 dark:fill-neutral-400 text-[10px]"
          >
            #1 (top consumer)
          </text>
        </svg>
      </div>

      {/* Zoom toggle: dynamically trim the flat low-consumption tail so the
          exponential takeoff occupies the rightmost ~quarter of the chart. */}
      {totalN > 5 && (
        <div className="flex items-center justify-end gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 px-1">
          {autoZoom && hiddenTailCount > 0 ? (
            <span>
              Auto-zoomed · showing top {n.toLocaleString()} of {totalN.toLocaleString()}{' '}
              ({hiddenTailCount.toLocaleString()} low-consumption hidden)
            </span>
          ) : (
            <span>Showing all {totalN.toLocaleString()} users</span>
          )}
          <button
            type="button"
            onClick={() => setAutoZoom(v => !v)}
            className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            {autoZoom ? 'show all' : 'auto-zoom'}
          </button>
        </div>
      )}

      {/* Legend / split summary */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2">
          <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 dark:bg-amber-400" />
            Regular users · UBB {formatUsd(ubbAICs)}{ubbIsOverridden ? ' (custom)' : ''}
          </div>
          <p className="text-neutral-600 dark:text-neutral-400 mt-0.5">
            {totalN - powerUserCount} {totalN - powerUserCount === 1 ? 'user' : 'users'} below threshold
            {onUbbChange && (
              <span className="block text-[10px] italic mt-0.5">Drag the amber line to adjust.</span>
            )}
          </p>
        </div>
        <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-800 px-3 py-2">
          <div className="flex items-center gap-1.5 text-orange-800 dark:text-orange-300 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 dark:bg-orange-400" />
            Outliers · need individual UBB
          </div>
          <p className="text-neutral-600 dark:text-neutral-400 mt-0.5">
            {powerUserCount} {powerUserCount === 1 ? 'user' : 'users'} at or above {formatUsd(thresholdAICs)}
            <span className="block text-[10px] italic mt-0.5">
              Drag the vertical line to change the cutoff.
            </span>
          </p>
        </div>
      </div>

      {/* Hover detail */}
      <div className="text-xs text-neutral-500 dark:text-neutral-400 h-4 px-1">
        {hoverUser ? (
          <span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{hoverUser.login}</span>
            {' · '}
            <span className="tabular-nums">{formatUsd(hoverUser.totalAICs)}</span>
            <span className="text-neutral-400 dark:text-neutral-500"> · ~{formatAICs(hoverUser.totalAICs)} AICs</span>
            {' · '}rank #{hoverRank ?? 1}
          </span>
        ) : (
          <span>
            Hover the curve to inspect a user. Drag the vertical line to split regular vs outliers,
            then drag the dashed line to set the UBB.
          </span>
        )}
      </div>
    </div>
  )
}
