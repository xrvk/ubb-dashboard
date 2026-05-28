import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserBudget } from '@/lib/api'

interface Bucket {
  label: string
  short: string
  min: number
  max: number // exclusive; Infinity for last
  color: string
}

const BUCKETS: Bucket[] = [
  { label: '0–25%', short: '<25', min: 0, max: 0.25, color: '#10b981' },
  { label: '25–50%', short: '25–50', min: 0.25, max: 0.5, color: '#10b981' },
  { label: '50–80%', short: '50–80', min: 0.5, max: 0.8, color: '#22c55e' },
  { label: '80–100% (near)', short: '80–100', min: 0.8, max: 1, color: '#f59e0b' },
  { label: '100–150%', short: '100–150', min: 1, max: 1.5, color: '#ef4444' },
  { label: '150%+', short: '>150', min: 1.5, max: Infinity, color: '#b91c1c' },
]

interface Props {
  budgets: UserBudget[]
}

export function UtilizationHistogram({ budgets }: Props) {
  const counts = BUCKETS.map(b => ({ ...b, count: 0 }))
  for (const b of budgets) {
    const ratio = b.budgetAmount > 0 ? b.consumedAmount / b.budgetAmount : b.consumedAmount > 0 ? Infinity : 0
    const idx = counts.findIndex(c => ratio >= c.min && ratio < c.max)
    if (idx >= 0) counts[idx].count += 1
    else counts[counts.length - 1].count += 1
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Utilization distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={counts} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <XAxis dataKey="short" stroke="#888" fontSize={11} />
              <YAxis stroke="#888" fontSize={11} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(120,120,120,0.08)' }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(value, _name, item) => {
                  const p = (item as { payload?: Bucket })?.payload
                  return [`${value} users`, p?.label ?? '']
                }}
                labelFormatter={() => ''}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {counts.map(b => (
                  <Cell key={b.label} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Distribution of users by consumed ÷ budgeted ratio. The two right bars are over their cap.
        </p>
      </CardContent>
    </Card>
  )
}
