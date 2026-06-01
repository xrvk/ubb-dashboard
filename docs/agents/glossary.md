# Glossary

Read this first if any of the abbreviations in the codebase, PR titles,
or commit messages look like alphabet soup.

## Core acronyms

| Term | Long form | What it means here |
|---|---|---|
| **UBB** | Usage-Based Billing | GitHub's billing model where Copilot consumption is metered in AI credits and any overage gets charged. The dashboard is named "UBB Dashboard" because it's a tool *for* Usage-Based Billing. Do not conflate with **ULB** below — they are different things, even though the repo history and many code identifiers (`IndividualUbbPage`, `universalUbb`, …) still use "UBB" for the user-level cap concept. That naming is historical drift; treat "UBB" in prose as Usage-Based Billing only. |
| **ULB** | User-Level Budget | A spending cap that applies to a single user (or to a default "everyone without their own cap"). Two flavors in this app: *individual ULB* and *universal ULB*. This is the per-user budget concept — distinct from the broader Usage-Based Billing system (UBB). |
| **Individual ULB** | — | A per-user cap. The thing this dashboard exists to manage in bulk. |
| **Universal ULB** | — | A single cap that applies to every user who does *not* have an individual ULB set. Acts as the org-wide default. |
| **CC** | Cost Center | A named grouping of users with its own budget. Used to roll up spend by team / department / project. |
| **AIC** | AI Credit | The unit of Copilot consumption. **1 AIC = $0.01 USD.** Most user-facing numbers are dollars; internally many calculations stay in credits to avoid floating-point drift. |
| **CB** | Copilot Business | One of two Copilot seat plans. Bundles a per-seat AIC allowance into the pool. |
| **CE** | Copilot Enterprise | The other seat plan. Larger per-seat AIC allowance. |
| **MTD** | Month-To-Date | Spend so far in the current billing month. Reset each cycle. |
| **EoM** | End of Month | The projected spend by the end of the current billing month. The dashboard's forecast. |
| **PAT** | Personal Access Token | The credential the user pastes to talk to the GitHub billing API. Lives in tab memory; never persisted to disk by this app. |
| **GHEC / GHE.com / dotcom** | GitHub Enterprise Cloud / `*.ghe.com` / `github.com` | The two flavors of GitHub that have a billing API. `ghe.com` is the data-resident variant. The connection menu lets users pick either. |

## Spend / budget concepts

| Term | Meaning |
|---|---|
| **Pool** | The shared, enterprise-wide bucket of *included* AICs. Sized as `(CB seats × CB allowance) + (CE seats × CE allowance)`. Drained first, by every user, regardless of CC or ULB. See [ai-credit-pool.md](./ai-credit-pool.md). |
| **Gross** | Raw consumption from the billing API, *before* any refunds / credits / adjustments. The pool drains on gross. |
| **Net** | Gross minus refunds. Used for actual billing math. The dashboard uses gross for pool depletion and forecasts. |
| **Metered AICs** | Spend *after* the pool is drained — i.e. true overage that lands against a ULB / CC / enterprise budget. See [metered-ai-credits.md](./metered-ai-credits.md). |
| **Pool draw** | Synonym for gross AIC consumption. |
| **Routing precedence** | The order in which a metered AIC charge gets attributed: individual ULB → CC budget → universal ULB → enterprise budget. The first matching scope owns the charge. |
| **Promo / promo window** | Time-boxed bump to per-seat allowance for CB/CE customers transitioning to usage-based billing. Hard-coded date range in `pricing.ts`. No API exposes per-seat promo eligibility, so it's modeled as a UI override the user can toggle. |
| **Forecast** | Linear extrapolation: `(MTD / days elapsed) × days in month`. Cheap, intentional. Don't replace it with anything fancier without a real need. |

## App / UI shorthand

| Term | Meaning |
|---|---|
| **Bulk unblock** | One-click action: raise the ULB cap on N selected users so they stop being blocked for the rest of the month. The headline feature. |
| **Bullet chart** | The horizontal bar with a target marker used in the CC table. Each row is a CC's MTD vs budget. |
| **Sepia theme** | The light-mode palette: warm amber / emerald / stone / neutral. No sky, no orange-500, no green-500. See `tone-and-voice.md` for the palette. |
| **Demo mode** | URL-driven mock-data mode. No API calls. Toggled by `?demo=N` and friends. See `workflow.md`. |
| **Asof** | Synthetic "today" for demo mode. `?asof=YYYY-MM-DD` overrides the current date so screenshots stay stable. |
| **Allocation diagram** | The visual that explains how a $X enterprise budget breaks into CC and ULB sub-budgets. Two display modes: independent bars and rolled-up. |
| **Constraint** | A computed flag for "this budget structure has a problem" — e.g. CC budgets sum exceeds enterprise budget. Surfaced in the constraints banner. |

## Things people *call* shorthand but actually have specific meanings

- **"Pool"** always means the *included* AIC pool, not the enterprise
  budget. If someone says "users are draining the pool," they mean gross
  AIC consumption, not metered overage.
- **"Universal ULB"** is *not* a synonym for "enterprise budget." A
  universal ULB caps individuals (it's still a ULB); the enterprise
  budget caps everything.
- **"Budget"** is overloaded. It can mean any of: individual ULB cap,
  universal ULB cap, CC budget, enterprise budget. When writing code or
  prose, pick a specific one and say it.
- **"Credits"** in customer-facing copy usually means dollars-worth of
  AICs. Internally we sometimes keep raw AIC counts to avoid `× 0.01`
  drift, but anything rendered to a user is a dollar amount.
