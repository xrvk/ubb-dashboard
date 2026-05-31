# Agent reference docs

Concise primers for future Copilot CLI / coding agents working in this repo.
Read these before touching anything that computes spend, budgets, or
forecasts.

- **[ai-credit-pool.md](./ai-credit-pool.md)** — the included monthly AI
  credit pool: how it's sized, where the numbers come from, how the
  dashboard renders pool drawdown.
- **[metered-ai-credits.md](./metered-ai-credits.md)** — what happens
  after the pool is drained: budget scopes, routing precedence, which
  scopes expose consumed spend and which don't, and the formulas the
  dashboard uses.
- **[dashboard-data-flow.md](./dashboard-data-flow.md)** — short
  end-to-end map of API → fetcher → math helper → tile, and the audit
  tooling (`scripts/probe-dashboard.ts`, `?debug=1` overlay) you can
  use to verify the dashboard against any enterprise.
