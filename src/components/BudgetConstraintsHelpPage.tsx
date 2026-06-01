import { ArrowLeft, BookOpen } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  onBack: () => void
}

/**
 * Full-page explainer for the budget constraint model used throughout the
 * dashboard. Lives in-app (rather than a static markdown file) so it can
 * deep-link to other tabs in the future and stays in sync with the actual
 * implementation in `src/lib/budgetConstraints.ts`.
 */
export function BudgetConstraintsHelpPage({ onBack }: Props) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft size={14} weight="bold" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <BookOpen size={20} weight="duotone" className="text-emerald-600" />
          <h2 className="text-lg font-semibold">How the budget model works</h2>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6 text-sm leading-relaxed">
          <Section title="The four budget controls">
            <p>
              Before you adjust budgets, make sure you understand how the four
              budget controls work and how this dashboard evaluates them. This
              page focuses on what the red banner checks before it warns about
              blocking risk.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Universal user-level budget (universal UBB)</Term>. One
                cap applied to every regular user.
              </li>
              <li>
                <Term>Individual user-level budget</Term>. A per-user cap for
                exceptions who need higher (or lower) limits than the universal
                UBB.
              </li>
              <li>
                <Term>Cost center budget</Term>. A metered-spend cap for users
                assigned to that cost center.
              </li>
              <li>
                <Term>Enterprise budget</Term>. A metered-spend cap for the
                enterprise.
              </li>
            </ul>
            <p className="text-xs opacity-75">
              Each budget can alert only, or{' '}
              <Term>Stop usage when budget limit is reached</Term>. The banner
              checks are most important when stop usage is enabled, because that
              is when users can be blocked.
            </p>
          </Section>

          <Section title="Effective UBB">
            <p>GitHub evaluates an effective UBB for each user:</p>
            <Formula>
              effective UBB = max(individual UBB, universal UBB)
            </Formula>
            <p>
              <Term>Regular users</Term> are users without an individual UBB.
              Their effective UBB is the universal UBB.
            </p>
          </Section>

          <Section title="Shared AI Credit Pool and metered charges">
            <p>
              Included credits are one enterprise-wide <Term>shared pool</Term>.
              There is no per-user included allowance. There is no per-user plan
              default.
            </p>
            <Formula>
              pool value = (Copilot Business seats × $19) + (Copilot Enterprise
              seats × $39)
            </Formula>
            <p>
              If user-level budgets collectively allow more consumption than the
              pool value provides, the difference becomes{' '}
              <Term>metered charges</Term>. Cost center budgets and enterprise
              budget need to be high enough to cover that gap.
            </p>
            <p>Here&apos;s how to estimate:</p>
            <Formula>
              max user consumption = (regular users × universal UBB) + Σ
              individual UBBs{'\n'}
              gap = max user consumption − pool value{'\n'}
              required spend coverage = Σ cost center budgets + enterprise
              budget ≥ gap
            </Formula>
            <p className="text-xs opacity-75">
              <strong>Tip:</strong> Whenever you raise the universal UBB or any
              individual user-level budget, re-check this calculation. Raising
              UBBs without raising shared budgets can block users before they
              reach their individual limits.
            </p>
          </Section>

          <Section title="Cost center exclusion">
            <p>
              The enterprise budget has a <Term>cost center exclusion</Term>{' '}
              setting that changes scope.
            </p>
            <p>Here&apos;s how it works:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Cost center exclusion off</Term> (default). Cost center
                spend also draws from enterprise budget capacity. If the sum of
                cost center budgets is above the enterprise budget, the
                enterprise budget can block cost center users early.
              </li>
              <li>
                <Term>Cost center exclusion on</Term>. Cost centers are capped
                by their own budgets, and enterprise budget covers only users
                outside budgeted cost centers.
              </li>
            </ul>
          </Section>

          <Section title="The three coherence checks">
            <p>
              The red banner appears when any check fails. This means your
              configuration can block usage earlier than intended.
            </p>
            <p>Here&apos;s how to read it:</p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>
                <Term>Per-cost-center fit</Term>. For every cost center that has
                a budget,
                <Formula>Σ effective UBBs of CC members ≤ CC budget</Formula>
              </li>
              <li>
                <Term>Cost-center vs enterprise fit</Term>. When cost center
                exclusion is off,
                <Formula>Σ cost center budgets ≤ enterprise budget</Formula>
              </li>
              <li>
                <Term>Unassigned-users fit</Term>. For users not routed to a
                budgeted cost center,
                <Formula>
                  Σ effective UBBs of unassigned users ≤ leftover enterprise
                  budget{'\n'}
                  (leftover = enterprise budget − Σ CC budgets when exclusion
                  is off, full enterprise budget when on)
                </Formula>
              </li>
            </ol>
            <p className="text-xs opacity-75">
              <strong>Tip:</strong> Start by fixing per-cost-center fit, then
              check cost-center vs enterprise fit (when exclusion is off), then
              re-check unassigned-users fit.
            </p>
          </Section>

          <Section title="Max safe universal UBB">
            <p>
              The dashboard computes the highest universal UBB that keeps all
              three checks passing, with budgets and individual user-level
              budgets held fixed.
            </p>
            <p>
              Situation: You want to raise universal UBB but keep the current
              budgets.
            </p>
            <p>
              Configuration: Raise universal UBB only up to the max safe
              universal UBB value. If even universal UBB = $0 fails, individual
              user-level budgets already exceed your current envelopes. Raise
              budgets, lower specific individual UBBs, or reroute users between
              cost centers.
            </p>
          </Section>

          <Section title="Worked example">
            <p>
              Cost center <Term>&quot;eng&quot;</Term> has a $500 budget and 3
              members. Two have individual UBBs of $100. The third has none.
              With universal UBB = $50:
            </p>
            <Formula>
              effective UBBs = max(100, 50) + max(100, 50) + max(0, 50) = 100 +
              100 + 50 = $250
            </Formula>
            <p>
              $250 ≤ $500, so the per-cost-center check passes. Raise universal
              UBB to $200:
            </p>
            <Formula>
              effective UBBs = max(100, 200) + max(100, 200) + max(0, 200) =
              200 + 200 + 200 = $600
            </Formula>
            <p>
              $600 &gt; $500, so the check fails. The max safe universal UBB is
              $150 ($150 + $150 + $150 = $450 ≤ $500).
            </p>
            <p className="text-xs opacity-75">
              <strong>Tip:</strong> This example is a per-cost-center fit check.
              If cost center exclusion is off, you still need the other two
              checks to pass.
            </p>
          </Section>

          <Section title="Alerts and hard stops">
            <p>
              Alerts and limits are separate. Alerts notify. Blocking only
              happens when <Term>Stop usage when budget limit is reached</Term>{' '}
              is enabled.
            </p>
          </Section>

          <Section title="See also">
            <p className="text-xs">
              GitHub Docs:{' '}
              <a
                href="https://docs.github.com/en/enterprise-cloud@latest/billing/managing-your-billing/budgets-for-usage-based-billing"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
              >
                Budgets for usage-based billing
              </a>
              {', '}
              <a
                href="https://docs.github.com/en/enterprise-cloud@latest/billing/managing-your-billing/about-budgets-and-spending-limits"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
              >
                Optimizing your budget configuration
              </a>
              .
            </p>
          </Section>
        </CardContent>
      </Card>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
        {title}
      </h3>
      <div className="space-y-2 text-neutral-700 dark:text-neutral-300">{children}</div>
    </section>
  )
}

function Term({ children }: { children: ReactNode }) {
  return <strong className="text-neutral-900 dark:text-neutral-100">{children}</strong>
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="rounded bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-xs whitespace-pre-wrap font-mono text-neutral-800 dark:text-neutral-200">
      {children}
    </pre>
  )
}
