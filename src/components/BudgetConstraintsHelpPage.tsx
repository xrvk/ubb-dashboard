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
          <Section title="The pieces">
            <p>
              Each Copilot user has an <Term>effective ULB</Term> — the per-user
              monthly budget GitHub will allow before blocking (hard cap) or
              alerting (soft cap). It comes from the maximum of three sources:
            </p>
            <Formula>
              effective ULB = max(individual ULB, universal ULB, plan default)
            </Formula>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Individual ULB</Term> — a per-user budget set explicitly
                (Individual ULBs tab).
              </li>
              <li>
                <Term>Universal ULB</Term> — one number applied to every
                Copilot user in the enterprise (Universal ULB tab).
              </li>
              <li>
                <Term>Plan default</Term> — the included monthly allowance from
                the user&apos;s Copilot SKU (Business: $0, Enterprise: included
                seat credits, etc.).
              </li>
            </ul>
          </Section>

          <Section title="The envelopes">
            <p>
              Effective ULBs are constrained by two types of budget envelopes
              you set on github.com:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Cost-center (CC) budget</Term> — a single budget shared
                by every member routed to that CC.
              </li>
              <li>
                <Term>Enterprise budget</Term> — the umbrella for the whole
                enterprise. Has an{' '}
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">
                  exclude_cost_center_usage
                </code>{' '}
                flag that picks one of two modes:
                <ul className="list-disc pl-6 mt-1 space-y-1">
                  <li>
                    <Term>umbrella</Term> (flag off) — CC spending counts
                    against the enterprise budget too. CC budgets must sum to
                    ≤ enterprise budget.
                  </li>
                  <li>
                    <Term>independent</Term> (flag on) — CC budgets are
                    isolated. The enterprise budget only covers users outside
                    a budgeted CC.
                  </li>
                </ul>
              </li>
            </ul>
          </Section>

          <Section title="The three checks">
            <p>The banner at the top of the Overview turns red when any of these fail:</p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>
                <Term>Per-CC sum check</Term> — for every CC that has a budget,
                <Formula>Σ effective ULBs of CC members ≤ CC budget</Formula>
              </li>
              <li>
                <Term>CC-vs-enterprise check</Term> (umbrella mode only),
                <Formula>Σ CC budgets ≤ enterprise budget</Formula>
              </li>
              <li>
                <Term>Unassigned leftover check</Term> — for users not routed
                to any budgeted CC,
                <Formula>
                  Σ effective ULBs of unassigned users ≤ enterprise budget − Σ
                  CC budgets (umbrella) / enterprise budget (independent)
                </Formula>
              </li>
            </ol>
          </Section>

          <Section title="Max safe universal ULB">
            <p>
              When you adjust the Universal ULB, only users whose individual
              ULB is <em>below</em> the universal value are affected (because
              effective ULB is a max). The dashboard computes the largest
              universal ULB that still keeps every check passing — holding
              individual ULBs and budgets constant. If even setting it to $0
              doesn&apos;t resolve a failure, that means the individual ULBs
              alone already exceed an envelope, and the only fixes are: raise
              the CC/enterprise budget, lower specific individual ULBs, or
              re-route members between cost centers.
            </p>
          </Section>

          <Section title="Worked example">
            <p>
              Suppose CC <Term>&quot;eng&quot;</Term> has a $500 budget and 3
              members, two with individual ULBs of $100 and one unset. With a
              universal ULB of $50:
            </p>
            <Formula>
              effective ULBs = max(100, 50) + max(100, 50) + max(0, 50) = 100 +
              100 + 50 = $250
            </Formula>
            <p>$250 ≤ $500, so the per-CC check passes. Raise the universal ULB to $200:</p>
            <Formula>
              effective ULBs = max(100, 200) + max(100, 200) + max(0, 200) =
              200 + 200 + 200 = $600
            </Formula>
            <p>
              $600 &gt; $500 — the check fails. Max safe universal ULB here is
              $150 ($150 + $150 + $150 = $450 ≤ $500).
            </p>
          </Section>

          <Section title="Where alerts come in">
            <p>
              All of the above is about <em>limits</em>, not notifications.
              Each budget can separately have alert thresholds and recipients
              configured on github.com — surfaced as the &quot;Alerts on / off&quot;
              flag on each row of the Budget planner. Alerts fire even on soft
              caps; hard caps stop usage entirely once the budget hits 100%.
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
