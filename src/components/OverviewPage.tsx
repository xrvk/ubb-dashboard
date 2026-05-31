import { BudgetPlanner } from '@/components/BudgetPlanner'
import { BudgetStructureDiagram } from '@/components/BudgetStructureDiagram'
import { ConstraintsBanner } from '@/components/ConstraintsBanner'

/**
 * Overview tab. Surfaces the enterprise-wide budget-constraint health
 * (the "golden rule" banner), the structure diagram, and the planner.
 */
export function OverviewPage() {
  return (
    <div className="grid gap-6">
      <ConstraintsBanner />

      <BudgetStructureDiagram />

      <BudgetPlanner />
    </div>
  )
}
