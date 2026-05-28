/* eslint-disable react-refresh/only-export-components */
import { Bar, BarChart, Cell, Label, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserBudget } from '@/lib/api'

export interface UtilBucket {
  id: string
  label: string
  short: string
  min: number
  max: number // exclusive; Infinity for last
  color: string
}

export const UTIL_BUCKETS: UtilBucket[] = [
  { id: 'b0-50', label: '0–50% (low)', short: '0–50', min: 0, max: 0.5, color: '#10b981' },
  { id: 'b50-80', label: '50–80% (moderate)', short: '50–80', min: 0.5, max: 0.8, color: '#22c55e' },
  { id: 'b80-90', label: '80–90% (getting close)', short: '80–90', min: 0.8, max: 0.9, color: '#f59e0b' },
  { id: 'b90-100', label: '90–100% (about to block)', short: '90–100', min: 0.9, max: 1, color: '#f97316' },
  { id: 'b100', label: '100%+ (blocked / over)', short: '100+', min: 1, max: Infinity, color: '#dc2626' },
]

export function bucketForBudget(b: UserBudget): UtilBucket {
  const ratio = b.budgetAmount > 0 ? b.consumedAmount / b.budgetAmount : b.consumedAmount > 0 ? Infinity : 0
  return UTIL_BUCKETS.find(c => ratio >= c.min && ratio < c.max) ?? UTIL_BUCKETS[UTIL_BUCKETS.length - 1]
}

interface Props {
  budgets: UserBudget[]
  selectedBucketId?: string | null
  onSelectBucket?: (bucketId: string | null) => void
}

export function UtilizationHistogram({ budgets, selectedBucketId, onSelectBucket }: Props) {
  const counts = UTIL_BUCKETS.map(b => ({ ...b, count: 0 }))
  for (const b of budgets) {
    const bucket = bucketForBudget(b)
    const idx = counts.findIndex(c => c.id === bucket.id)
    if (idx >= 0) counts[idx].count += 1
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Utilization distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={counts} margin={{ top: 8, right: 24, left: 32, bottom: 36 }}>
              <XAxis dataKey="short" stroke="#888" fontSize={11} tickMargin={6}>
                <Label
                  value="Utilization (%)"
                  position="insideBottom"
                  offset={-18}
                  style={{ fontSize: 11, fill: '#888' }}
                />
              </XAxis>
              <YAxis stroke="#888" fontSize={11} allowDecimals={false}>
                <Label
                  value="Users"
                  angle={-90}
                  position="insideLeft"
                  offset={10}
                  style={{ fontSize: 11, fill: '#888', textAnchor: 'middle' }}
                />
              </YAxis>
              <Tooltip
                cursor={{ fill: 'rgba(120,120,120,0.08)' }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(value, _name, item) => {
                  const p = (item as { payload?: UtilBucket })?.payload
                  return [`${value} users`, p?.label ?? '']
                }}
                labelFormatter={() => ''}
              />
              <Bar
                dataKey="count"
                radius={[4, 4, 0, 0]}
                cursor={onSelectBucket ? 'pointer' : undefined}
                onClick={(data: unknown) => {
                  if (!onSelectBucket) return
                  const d = data as { id?: string } | undefined
                  if (!d?.id) return
                  onSelectBucket(selectedBucketId === d.id ? null : d.id)
                }}
              >
                {counts.map(b => (
                  <Cell
                    key={b.id}
                    fill={b.color}
                    fillOpacity={selectedBucketId && selectedBucketId !== b.id ? 0.35 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {onSelectBucket
            ? 'Click a bar to filter the table to users in that bucket. Click again to clear.'
            : 'Distribution of users by utilization.'}
          {selectedBucketId ? (
            <button
              type="button"
              onClick={() => onSelectBucket?.(null)}
              className="ml-2 underline text-neutral-700 dark:text-neutral-200"
            >
              Clear bucket filter
            </button>
          ) : null}
        </p>
      </CardContent>
    </Card>
  )
}
