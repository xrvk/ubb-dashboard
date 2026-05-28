import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { classifyStatus } from '@/lib/status'
import type { UserBudget } from '@/lib/api'

const COLORS = {
  over: '#dc2626',
  near: '#f59e0b',
  ok: '#10b981',
} as const

interface Props {
  budgets: UserBudget[]
  limit?: number
}

export function TopConsumersChart({ budgets, limit = 10 }: Props) {
  const data = [...budgets]
    .sort((a, b) => b.consumedAmount - a.consumedAmount)
    .slice(0, limit)
    .map(b => ({
      user: b.user,
      consumed: b.consumedAmount,
      budget: b.budgetAmount,
      status: classifyStatus(b),
    }))

  if (data.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top {data.length} consumers</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: Math.max(220, data.length * 32) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <XAxis type="number" tickFormatter={v => formatCurrency(v)} stroke="#888" fontSize={11} />
              <YAxis dataKey="user" type="category" width={120} stroke="#888" fontSize={12} />
              <Tooltip
                cursor={{ fill: 'rgba(120,120,120,0.08)' }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(value, _name, item) => {
                  const p = (item as { payload?: { budget?: number } })?.payload
                  const budget = p?.budget ?? 0
                  const v = typeof value === 'number' ? value : Number(value)
                  return [`${formatCurrency(v)} / ${formatCurrency(budget)} budget`, 'Consumed']
                }}
              />
              <Bar dataKey="consumed" radius={[0, 4, 4, 0]}>
                {data.map(d => (
                  <Cell key={d.user} fill={COLORS[d.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
