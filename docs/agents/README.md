# Agent reference docs

On-ramp for any AI agent (Copilot CLI, coding agent, review agent) working
in this repo. Read what's relevant before touching the corresponding area.

## Working here

| File | When to read |
|---|---|
| [glossary.md](./glossary.md) | First. Decodes the alphabet soup (ULB, AIC, CB/CE, CC, MTD, gross vs net, …). |
| [architecture.md](./architecture.md) | 10-minute map of how the app is wired: entry points, state, persistence, demo mode. |
| [external-systems.md](./external-systems.md) | Before touching `api.ts` or anything that talks to GitHub. Endpoints, auth, version pin, quirks. |
| [tone-and-voice.md](./tone-and-voice.md) | Before writing UI copy, commit messages, PR bodies, toasts, or docs. |
| [workflow.md](./workflow.md) | Before opening a PR. Build / lint / test commands, demo knobs, branch conventions, anti-patterns. |

## Domain primers

Read before touching anything that computes spend, budgets, or forecasts.

- **[ai-credit-pool.md](./ai-credit-pool.md)** — the included monthly AI
  credit pool: how it's sized, where the numbers come from, how the
  dashboard renders pool drawdown.
- **[metered-ai-credits.md](./metered-ai-credits.md)** — what happens
  after the pool is drained: budget scopes, routing precedence, which
  scopes expose consumed spend and which don't, and the formulas the
  dashboard uses.
- **[dashboard-data-flow.md](./dashboard-data-flow.md)** — end-to-end
  map of API → fetcher → math helper → tile, and the audit tooling
  (`scripts/probe-dashboard.ts`, `?debug=1` overlay) you can use to
  verify the dashboard against any enterprise.

## Facts to internalize immediately

- **Public repo.** Anything you commit is world-readable. Never paste
  PATs, real enterprise slugs, customer names, internal URLs, or
  screenshots with real data. When unsure, ask.
- **Not an official GitHub product.** See the disclaimer in the top-level
  `README.md`. Match that framing.
- **Single-purpose tool.** This dashboard exists to make per-user Copilot
  AI Credit budgets (individual ULBs) operable at scale. Resist scope
  creep — push back before building anything that isn't in service of
  "see who's near / over their cap and fix it in one click."
- **Browser-only, static-hosted on GitHub Pages.** No server, no backend,
  no persistence beyond the user's tab / `localStorage`. PAT + enterprise
  URL live in tab memory. Anything that assumes a server (cookies,
  sessions, API routes) is wrong for this app.

