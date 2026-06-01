import { CurrencyDollar, TrendUp, Warning } from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, cn } from '@/lib/utils'
import type { Forecast } from '@/lib/status'

interface Props {
  forecast: Forecast
  /** Called when the user clicks the "projected over by EoM" tile. */
  onSelectProjectedOver?: () => void
}

/**
 * Three hero tiles at the top of the Individual UBB page that frame the
 * page's forward-looking story: where we are, where we're headed, and
 * which users are headed for trouble. Mirrors the Universal UBB hero row.
 */
export function ForecastHero({ forecast, onSelectProjectedOver }: Props) {
  const overDelta = forecast.projectedEom - forecast.totalBudgeted
  const dayCopy = `Day ${forecast.daysElapsed} of ${forecast.daysInMonth}`
  const totalAtRisk = forecast.alreadyOver + forecast.projectedOver
  const interactiveAtRisk = Boolean(onSelectProjectedOver && totalAtRisk > 0)

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
      <Card>
        <CardContent className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Spend to date</div>
            <div className="text-2xl font-semibold mt-1">
              {formatCurrency(forecast.spendMtd)}
            </div>
            <div className="text-xs text-neutral-500 mt-1">{dayCopy}</div>
            {forecast.projectedEom > 0 ? (
              <SpendProgressBar
                spendMtd={forecast.spendMtd}
                projectedEom={forecast.projectedEom}
              />
            ) : null}
          </div>
          <CurrencyDollar size={22} weight="duotone" className="text-neutral-400" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Projected end-of-month
              {forecast.lowConfidence && (
                <span className="ml-1 text-neutral-400" title="Few days of data; projection is noisy.">
                  ·&nbsp;low confidence
                </span>
              )}
            </div>
            <div className={cn(
              'text-2xl font-semibold mt-1',
              overDelta > 0 && forecast.totalBudgeted > 0 && 'text-amber-600 dark:text-amber-400',
            )}>
              {formatCurrency(forecast.projectedEom)}
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              {forecast.totalBudgeted > 0 ? (
                overDelta > 0
                  ? `${formatCurrency(overDelta)} over UBB total`
                  : `${formatCurrency(-overDelta)} headroom vs UBB total`
              ) : (
                'no UBB caps set'
              )}
            </div>
          </div>
          <TrendUp size={22} weight="duotone" className="text-neutral-400" />
        </CardContent>
      </Card>

      <Card className={interactiveAtRisk ? 'transition-colors hover:border-neutral-400 dark:hover:border-neutral-600' : ''}>
        {interactiveAtRisk ? (
          <button
            type="button"
            onClick={onSelectProjectedOver}
            title="Filter to users projected to exceed their UBB by end of month"
            className="w-full text-left cursor-pointer"
          >
            <ForecastAtRiskBody forecast={forecast} totalAtRisk={totalAtRisk} />
          </button>
        ) : (
          <ForecastAtRiskBody forecast={forecast} totalAtRisk={totalAtRisk} />
        )}
      </Card>
    </div>
  )
}

function SpendProgressBar({ spendMtd, projectedEom }: { spendMtd: number; projectedEom: number }) {
  const pct = Math.min(100, Math.max(0, (spendMtd / projectedEom) * 100))
  const remaining = Math.max(0, projectedEom - spendMtd)
  return (
    <div className="mt-2.5">
      <div
        className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Spend to date vs projected end of month"
      >
        <div
          className="h-full bg-neutral-700 dark:bg-neutral-300 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-neutral-500 flex items-center justify-between gap-2">
        <span>{Math.round(pct)}% of projected</span>
        <span>{formatCurrency(remaining)} expected</span>
      </div>
    </div>
  )
}

function ForecastAtRiskBody({ forecast, totalAtRisk }: { forecast: Forecast; totalAtRisk: number }) {
  return (
    <CardContent className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">At risk by EoM</div>
        <div className={cn(
          'text-2xl font-semibold mt-1',
          totalAtRisk > 0 && 'text-red-600 dark:text-red-400',
        )}>
          {totalAtRisk.toLocaleString()}
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          {forecast.alreadyOver.toLocaleString()} already over · {forecast.projectedOver.toLocaleString()} projected
        </div>
      </div>
      <Warning size={22} weight="duotone" className={cn(
        'text-neutral-400',
        totalAtRisk > 0 && 'text-red-500',
      )} />
    </CardContent>
  )
}
