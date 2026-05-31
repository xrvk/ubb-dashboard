import { BudgetPlanner } from '@/components/BudgetPlanner'
import { BudgetStructureDiagram } from '@/components/BudgetStructureDiagram'
import { ConstraintsBanner } from '@/components/ConstraintsBanner'
import { useCredentials } from '@/hooks/use-credentials'
import { formatCurrency } from '@/lib/utils'

/**
 * Overview tab. Surfaces the enterprise-wide budget-constraint health
 * (the "golden rule" banner) plus a few headline numbers so the other
 * tabs can stay focused on per-user editing.
 */
export function OverviewPage() {
  const {
    enterpriseBudget,
    costCenterBudgetsByName,
    budgets,
    seats,
    universalUlb,
  } = useCredentials()

  const ccBudgetTotal = Array.from(costCenterBudgetsByName.values()).reduce(
    (acc, b) => acc + (b.budgetAmount ?? 0),
    0,
  )
  const individualBudgetCount = budgets.length

  const stats: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: 'Enterprise budget',
      value: enterpriseBudget ? formatCurrency(enterpriseBudget.budgetAmount) : '—',
      hint: enterpriseBudget?.preventFurtherUsage
        ? 'Hard cap enabled'
        : enterpriseBudget
          ? 'Soft cap (alerts only)'
          : 'No enterprise budget set',
    },
    {
      label: 'Cost-center budgets',
      value: costCenterBudgetsByName.size
        ? `${costCenterBudgetsByName.size} · ${formatCurrency(ccBudgetTotal)}`
        : '—',
      hint: costCenterBudgetsByName.size
        ? 'Sum of all cost-center caps'
        : 'No cost-center budgets',
    },
    {
      label: 'Universal ULB',
      value: universalUlb ? formatCurrency(universalUlb.budgetAmount) : '—',
      hint: universalUlb
        ? 'Default per-user limit'
        : 'No universal ULB set',
    },
    {
      label: 'Per-user overrides',
      value: individualBudgetCount.toLocaleString(),
      hint: `${seats.length.toLocaleString()} seats in scope`,
    },
  ]

  return (
    <div className="grid gap-6">
      <ConstraintsBanner />

      <BudgetStructureDiagram />

      <BudgetPlanner />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <div
            key={s.label}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3"
          >
            <div className="text-xs text-neutral-500">{s.label}</div>
            <div className="text-lg font-semibold mt-0.5">{s.value}</div>
            {s.hint ? (
              <div className="text-xs text-neutral-500 mt-0.5">{s.hint}</div>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  )
}
