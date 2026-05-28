import { Users, Warning, Gauge, CurrencyDollar, Coins } from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, cn } from '@/lib/utils'
import type { Summary } from '@/lib/status'

interface Props {
  summary: Summary
  onSelectOver?: () => void
  onSelectNear?: () => void
  onReset?: () => void
}

export function SummaryCards({ summary, onSelectOver, onSelectNear, onReset }: Props) {
  const items: Array<{
    label: string
    value: string
    icon: React.ReactNode
    accent?: string
    onClick?: () => void
    clickable?: boolean
    hint?: string
  }> = [
    {
      label: 'Users with ULB',
      value: summary.total.toLocaleString(),
      icon: <Users size={20} weight="duotone" className="text-neutral-500" />,
      onClick: onReset,
      clickable: Boolean(onReset),
      hint: 'Click to clear filters',
    },
    {
      label: 'Over budget',
      value: summary.over.toLocaleString(),
      icon: <Warning size={20} weight="duotone" className="text-red-600" />,
      accent: summary.over > 0 ? 'text-red-600 dark:text-red-400' : '',
      onClick: summary.over > 0 ? onSelectOver : undefined,
      clickable: Boolean(onSelectOver && summary.over > 0),
      hint: 'Filter to users over budget',
    },
    {
      label: 'Near limit',
      value: summary.near.toLocaleString(),
      icon: <Gauge size={20} weight="duotone" className="text-amber-600" />,
      accent: summary.near > 0 ? 'text-amber-600 dark:text-amber-400' : '',
      onClick: summary.near > 0 ? onSelectNear : undefined,
      clickable: Boolean(onSelectNear && summary.near > 0),
      hint: 'Filter to users near limit',
    },
    {
      label: 'Total consumed',
      value: formatCurrency(summary.totalConsumed),
      icon: <CurrencyDollar size={20} weight="duotone" className="text-neutral-500" />,
    },
    {
      label: 'ULB total',
      value: formatCurrency(summary.totalBudgeted),
      icon: <Coins size={20} weight="duotone" className="text-neutral-500" />,
    },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(item => {
        const interactive = item.clickable && item.onClick
        const Comp = interactive ? 'button' : 'div'
        return (
          <Card key={item.label} className={interactive ? 'transition-colors hover:border-neutral-400 dark:hover:border-neutral-600' : ''}>
            <Comp
              type={interactive ? 'button' : undefined}
              onClick={interactive ? item.onClick : undefined}
              title={interactive ? item.hint : undefined}
              className={cn(
                'w-full text-left',
                interactive && 'cursor-pointer',
              )}
            >
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{item.label}</div>
                  <div className={`text-2xl font-semibold mt-1 ${item.accent ?? ''}`}>{item.value}</div>
                </div>
                {item.icon}
              </CardContent>
            </Comp>
          </Card>
        )
      })}
    </div>
  )
}
