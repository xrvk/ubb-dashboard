import { Users, Warning, Gauge, CurrencyDollar, Coins } from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import type { Summary } from '@/lib/status'

interface Props {
  summary: Summary
}

export function SummaryCards({ summary }: Props) {
  const items: Array<{
    label: string
    value: string
    icon: React.ReactNode
    accent?: string
  }> = [
    {
      label: 'Users with ULB',
      value: summary.total.toLocaleString(),
      icon: <Users size={20} weight="duotone" className="text-neutral-500" />,
    },
    {
      label: 'Over budget',
      value: summary.over.toLocaleString(),
      icon: <Warning size={20} weight="duotone" className="text-red-600" />,
      accent: summary.over > 0 ? 'text-red-600 dark:text-red-400' : '',
    },
    {
      label: 'Near limit',
      value: summary.near.toLocaleString(),
      icon: <Gauge size={20} weight="duotone" className="text-amber-600" />,
      accent: summary.near > 0 ? 'text-amber-600 dark:text-amber-400' : '',
    },
    {
      label: 'Total consumed',
      value: formatCurrency(summary.totalConsumed),
      icon: <CurrencyDollar size={20} weight="duotone" className="text-neutral-500" />,
    },
    {
      label: 'Total budgeted',
      value: formatCurrency(summary.totalBudgeted),
      icon: <Coins size={20} weight="duotone" className="text-neutral-500" />,
    },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(item => (
        <Card key={item.label}>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{item.label}</div>
              <div className={`text-2xl font-semibold mt-1 ${item.accent ?? ''}`}>{item.value}</div>
            </div>
            {item.icon}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
