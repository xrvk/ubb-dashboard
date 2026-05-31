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
              GitHub Copilot governs spend with four controls. This dashboard
              helps you size and align them so usage limits behave the way you
              expect.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Universal user-level budget (universal ULB)</Term> — one
                cap applied to every Copilot user in the enterprise.
              </li>
              <li>
                <Term>Individual user-level budget overrides</Term> — per-user
                caps that replace the universal ULB for specific people (power
                users, exceptions, etc.).
              </li>
              <li>
                <Term>Cost center budgets</Term> — metered-spend caps on a
                group of users routed to a cost center.
              </li>
              <li>
                <Term>Enterprise budget</Term> — the failsafe metered-spend
                cap covering the whole enterprise (or just the users outside
                any budgeted cost center, depending on the cost-center
                exclusion setting).
              </li>
            </ul>
            <p className="text-xs opacity-75">
              Each budget can be configured to either alert only or{' '}
              <Term>Stop usage when budget limit is reached</Term>. The
              constraint checks below assume the hard-stop behavior — that&apos;s
              the configuration this dashboard is designed to keep coherent.
            </p>
          </Section>

          <Section title="Effective ULB">
            <p>
              For any user, the cap GitHub actually enforces is the
              <Term> effective ULB</Term>, the maximum of the individual
              override and the universal ULB:
            </p>
            <Formula>
              effective ULB = max(individual ULB override, universal ULB)
            </Formula>
            <p>
              <Term>Regular users</Term> are users without an individual
              override — their effective ULB is just the universal ULB.
            </p>
          </Section>

          <Section title="Pool, metered, and the sizing gap">
            <p>
              Your enterprise has a <Term>shared pool</Term> of included
              credits each month:
            </p>
            <Formula>
              pool value = (Copilot Business seats × $19) + (Copilot Enterprise
              seats × $39)
            </Formula>
            <p>
              If user-level budgets collectively allow more consumption than
              the pool covers, the difference becomes <Term>metered charges</Term>.
              Your cost center and enterprise budgets need to be high enough to
              cover that gap, or users will hit a budget block before they
              reach their own ULB.
            </p>
            <Formula>
              max user consumption = (regular users × universal ULB) + Σ
              individual ULB overrides{'\n'}
              gap = max user consumption − pool value{'\n'}
              required spend coverage = Σ cost center budgets + enterprise
              budget ≥ gap
            </Formula>
            <p className="text-xs opacity-75">
              Tip: whenever you raise the universal ULB or add overrides,
              re-check this — raising ULBs without raising the enterprise
              budget can cause the enterprise budget to block users before
              they reach their individual budgets.
            </p>
          </Section>

          <Section title="Cost center exclusion">
            <p>
              The enterprise budget has a <Term>cost center exclusion</Term>{' '}
              setting that decides whether cost center spend also counts
              against it:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Cost center exclusion off</Term> (default) — cost-center
                spend draws from the enterprise budget too. The sum of cost
                center budgets must be ≤ the enterprise budget, otherwise the
                enterprise budget will block CC users before their own CC
                budgets do.
              </li>
              <li>
                <Term>Cost center exclusion on</Term> — cost centers operate
                independently. CC users can keep spending even if the
                enterprise budget hits $0; their metered charges are only
                capped by their own CC budget. The enterprise budget then only
                covers users not assigned to a budgeted cost center.
              </li>
            </ul>
          </Section>

          <Section title="The three coherence checks">
            <p>
              The Overview banner turns red when any of these fail — that&apos;s
              the dashboard&apos;s way of saying &quot;your budgets will block
              users earlier than you intended&quot;:
            </p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>
                <Term>Per-cost-center fit</Term> — for every cost center that
                has a budget,
                <Formula>Σ effective ULBs of CC members ≤ CC budget</Formula>
              </li>
              <li>
                <Term>Cost-center vs enterprise fit</Term> (when cost center
                exclusion is off),
                <Formula>Σ cost center budgets ≤ enterprise budget</Formula>
              </li>
              <li>
                <Term>Unassigned-users fit</Term> — for users not routed to a
                budgeted cost center,
                <Formula>
                  Σ effective ULBs of unassigned users ≤ leftover enterprise
                  budget{'\n'}
                  (leftover = enterprise budget − Σ CC budgets when exclusion
                  is off, full enterprise budget when on)
                </Formula>
              </li>
            </ol>
          </Section>

          <Section title="Max safe universal ULB">
            <p>
              When you change the universal ULB, only regular users — those
              without an individual override at or above the universal value —
              are affected. The dashboard computes the largest universal ULB
              that still keeps every check passing, holding individual
              overrides and budgets constant. If even $0 won&apos;t resolve a
              failure, individual overrides alone already exceed an envelope,
              and the fix has to be one of: raise the CC or enterprise budget,
              lower specific individual overrides, or re-route members between
              cost centers.
            </p>
          </Section>

          <Section title="Worked example">
            <p>
              Cost center <Term>&quot;eng&quot;</Term> has a $500 budget and 3
              members; two have individual overrides of $100, the third has
              none. With a universal ULB of $50:
            </p>
            <Formula>
              effective ULBs = max(100, 50) + max(100, 50) + max(0, 50) = 100 +
              100 + 50 = $250
            </Formula>
            <p>$250 ≤ $500, so the per-cost-center check passes. Raise the universal ULB to $200:</p>
            <Formula>
              effective ULBs = max(100, 200) + max(100, 200) + max(0, 200) =
              200 + 200 + 200 = $600
            </Formula>
            <p>
              $600 &gt; $500 — the check fails. The max safe universal ULB here
              is $150 ($150 + $150 + $150 = $450 ≤ $500).
            </p>
          </Section>

          <Section title="Alerts vs hard stops">
            <p>
              Everything above is about <em>limits</em>, not notifications.
              Each budget independently has alert thresholds and recipients
              you configure on github.com — surfaced as the{' '}
              <Term>Alerts on / off</Term> flag on each row of the Budget
              planner. Alerts fire whether or not{' '}
              <Term>Stop usage when budget limit is reached</Term> is enabled;
              the hard-stop behavior is what actually blocks consumption at
              100%.
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
