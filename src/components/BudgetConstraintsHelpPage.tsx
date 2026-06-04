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
 *
 * Org variant: 3 layers (org budget → universal ULB → individual ULBs),
 * no enterprise envelope, no cost centers. The dashboard enforces a single
 * golden rule rather than a layered cascade of checks.
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
          <Section title="The three budget controls">
            <p>
              GitHub Copilot's usage-based billing for a single organization
              exposes three layered controls. The dashboard treats them as a
              hierarchy and validates them against one golden rule.
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Individual user-level budget (individual ULB)</Term>. A
                per-user metered-spend cap. Use these for outliers who need
                higher (or lower) limits than the org-wide default.
              </li>
              <li>
                <Term>Universal user-level budget (universal ULB)</Term>. One
                cap applied to every Copilot seat that doesn't have an
                individual ULB.
              </li>
              <li>
                <Term>Organization budget</Term>. A metered-spend cap covering
                all Copilot AI-credit consumption in the org — the highest
                envelope in the hierarchy.
              </li>
            </ul>
            <p className="text-xs opacity-75">
              Each budget can alert only, or{' '}
              <Term>Stop usage when budget limit is reached</Term>. The banner
              raises a warning if the org budget is configured as alerts-only,
              since the hard-cap check below stops being enforced.
            </p>
          </Section>

          <Section title="The AI-credit pool">
            <p>
              Included credits are an org-wide <Term>shared pool</Term>. Every
              assigned Copilot Business seat contributes a monthly allowance
              (1,900 AI credits = $19 at list price; promotional rates apply
              through Sept 1, 2026). The pool is consumed first, before any
              metered charges hit the org budget.
            </p>
            <Formula>{`pool value = Copilot Business seats × $19 (standard)
            = Copilot Business seats × $30 (promo, through Sept 1, 2026)`}</Formula>
            <p>
              Once the pool is drained, every subsequent AI-credit dollar is a{' '}
              <Term>metered charge</Term> that draws against the per-user ULBs
              and ultimately the org budget.
            </p>
          </Section>

          <Section title="The golden rule">
            <p>
              The dashboard enforces a single invariant on every edit:
            </p>
            <Formula>Σ effective ULB(seat) ≤ org budget</Formula>
            <p>where, for each Copilot seat, the <Term>effective ULB</Term> is:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>the user's <Term>individual ULB</Term> if one is set,</li>
              <li>otherwise the <Term>universal ULB</Term> amount,</li>
              <li>otherwise <Term>$0</Term> (the seat is unbounded only up to the org cap, then blocked).</li>
            </ul>
            <p>
              When the sum exceeds the org budget, the configuration is{' '}
              <Term>overcommitted</Term>: every user could theoretically draw
              up to their ULB and the org would breach its top-level cap. The
              red banner surfaces this with two one-click fixes:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Raise org budget to $X</Term> — sets the org cap to
                exactly cover current commitments (Σ effective ULBs).
              </li>
              <li>
                <Term>Lower universal ULB to $Y</Term> — drops the universal
                cap to the largest value that satisfies the rule, holding
                individual ULBs constant.
              </li>
            </ul>
            <p>
              The "lower universal ULB" fix is hidden when individual ULBs
              alone already exceed the cap — in that case raising the org
              budget (or reducing some individual ULBs) is the only way out.
            </p>
          </Section>

          <Section title="Max-safe universal ULB">
            <p>
              The Universal ULB tab shows an inline headroom card with the max
              value that keeps the golden rule passing:
            </p>
            <Formula>{`max safe universal ULB =
  (org budget − Σ individual ULBs) ÷ (seats without an individual ULB)`}</Formula>
            <p>
              When every seat has an individual ULB, the universal ULB is
              decoupled from the org budget (the denominator is zero), so the
              max-safe value is reported as unbounded.
            </p>
            <p>
              When there is no org budget configured, the dashboard skips the
              hard check entirely and only surfaces soft warnings (e.g. seats
              with no ULB coverage). Sizing the universal ULB then falls back
              to per-user heuristics on the CSV upload page.
            </p>
          </Section>

          <Section title="Soft warnings">
            <p>The banner also raises non-blocking warnings:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Term>Prevent further usage is off</Term>. The org budget is
                set to alert only, so the hard cap is not enforced and the
                golden rule becomes advisory rather than enforced.
              </li>
              <li>
                <Term>Unbounded user coverage</Term>. One or more Copilot seats
                have neither an individual nor a universal ULB. Those users
                can consume AI credits up to the org budget without a
                per-user ceiling.
              </li>
            </ul>
          </Section>

          <Section title="What this dashboard does not check">
            <p className="text-xs opacity-75">
              The golden rule is a <em>commitment</em> check, not a <em>consumption</em>
              {' '}check. It treats every ULB as fully used, which is the worst
              case. In practice, real spend depends on how much each user
              actually consumes — see the Dashboard tab for spend-to-date and
              the projected end-of-month forecast.
            </p>
            <p className="text-xs opacity-75">
              The dashboard also does not enforce minimum ULB amounts, alert
              recipient lists, or notification cadence — those live in the
              native GitHub admin UI.
            </p>
            <p className="text-xs">
              Further reading:{' '}
              <a
                href="https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-the-spending-policy-for-github-copilot-in-your-organization"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-80"
              >
                Managing the spending policy for GitHub Copilot in your organization
              </a>
              {', '}
              <a
                href="https://docs.github.com/en/billing/managing-your-billing/about-budgets-and-spending-limits"
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
