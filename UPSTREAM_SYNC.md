# Upstream sync log

This repo (`xrvk/ubb-dashboard-org`) is a sibling of
[`xrvk/ind-ulb-dashboard`](https://github.com/xrvk/ind-ulb-dashboard) (the GHEC
enterprise variant of the same app). Both repos share a meaningful chunk of
infrastructure code (rate-limit-aware batching, CSV parsing, snapshot/revert,
projection math, the consumption curve, the individual-ULB table mechanics)
that we want to keep in sync without forcing them to be a literal GitHub fork.

This file tracks every commit cherry-picked between the two repos.

## Setup

In a local clone of this repo, add the parent as a remote:

```bash
git remote add upstream https://github.com/xrvk/ind-ulb-dashboard.git
git fetch upstream
```

## What's in scope for cherry-picks

Cherry-pick (in either direction) when the change is one of:

- **Pure bug fix** in a shared lib (`src/lib/api.ts` rate-limit handling, CSV
  parser, batch runner, snapshot, projection, pricing, demo RNG).
- **Bug fix in a shared component** (individual-ULB table, CSV import,
  consumption curve, edit dialogs, error sinks, partial-load banner).
- **Security fix** anywhere.
- **Dependency bump** that we want to land identically on both repos.

Do **not** cherry-pick:

- Changes that touch the enterprise envelope (`EnterpriseBudget`), cost
  centers, the `costCenters` / `costCenterBudgetsByName` plumbing, or any
  4-layer constraint logic. None of that exists here.
- Changes to `parseEnterpriseUrl`, GHES host handling, or the
  `manage_billing:enterprise` PAT scope copy.
- Changes that depend on the `BudgetStructureDiagram`, `EnvelopeCheckCard`,
  `BudgetPlanner`, or `OverviewPage` components — all deleted in this variant.
- Tab structure / routing changes — the tab set is different here
  (`dashboard | org-budget | universal | individual`).

## How to cherry-pick

```bash
# From this repo, with `upstream` configured per Setup above:
git fetch upstream
git cherry-pick <sha-from-upstream>

# Resolve any conflicts (usually around credentials shape: `ent` vs `org`,
# or the deleted CC-aware code paths). Then:
git cherry-pick --continue

# Note the SHA below.
```

The other direction (org → enterprise) is the mirror: from a clone of
`xrvk/ind-ulb-dashboard`, add this repo as `org-variant` and cherry-pick by SHA.

## Log

> Format: `YYYY-MM-DD · direction · short-sha · summary · notes`

| Date | Direction | SHA | Summary | Notes |
|---|---|---|---|---|
| 2026-05-29 | seed | `5069490` | Initial org-variant foundation | First commit on `xrvk/silver-parakeet` after cloning `xrvk/ind-ulb-dashboard`. Not a cherry-pick — this is the seed point. |

<!-- Add new rows at the bottom. Keep the table chronological. -->

## Divergence notes

These intentional divergences exist between the two repos and will produce
conflicts on most cherry-picks that touch the listed files:

- `src/lib/api.ts`
  - `parseOrgUrl` (here) vs. `parseEnterpriseUrl` (upstream)
  - `Credentials.org` (here) vs. `Credentials.ent` (upstream)
  - Path prefix: `/orgs/{org}` vs. `/enterprises/{ent}`
  - `per_page` cap: 10 (here) vs. 100 (upstream)
  - `OrgBudget` type (here) vs. `EnterpriseBudget` (upstream)
  - No `excludeCostCenterUsage` field here
  - No `fetchCostCenters`, no `costCenterUrl`, no `buildCostCenterIndex` here

- `src/hooks/use-credentials.tsx`
  - `orgBudget` slot (here) vs. `enterpriseBudget`, `costCenters`,
    `costCenterBudgetsByName`, `loginToCostCenter` (upstream)

- `src/lib/budgetConstraints.ts`
  - Single golden rule (here) vs. layered envelope + per-CC checks (upstream)
  - `mainCheck: BudgetCheck | null` + `maxSafeUniversalUlb` (here)
  - No `checks.perCc` or `checks.unassignedLeftover` here

- `src/lib/poolSplit.ts`
  - 4-field result `{orgBudget, individualUlbTotal, universalUlbDraw, headroom, overAllocated}`
    (here) vs. the upstream's CC-aware shape

- `src/components/ConstraintsBanner.tsx`
  - Single-failure layout with raise/lower/review actions (here) vs.
    multi-failure list (upstream)

- `src/App.tsx`
  - Tabs: `dashboard | org-budget | universal | individual | budget-model`
    (here) vs. the upstream's full enterprise set
  - No `activeTask` / `PlannerHighlight` / `pendingFilter` plumbing here

When cherry-picking changes that touch these files, expect to do a manual
adapt rather than a clean apply.
