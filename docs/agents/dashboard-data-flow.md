# Dashboard data flow + audit tooling

End-to-end map of how a number gets to a tile, and how to verify it.

## Pipeline

```
GitHub REST API                src/lib/api.ts                src/lib/{pricing,projection,poolSplit}.ts
─────────────────              ──────────────                ─────────────────────────────────────────
/copilot/billing/seats   ───→  fetchAllCopilotSeats   ───→   seatCostBreakdown
                                                              includedAiCredits
/billing/usage/summary   ───→  fetchCopilotUsageSummary ─→   (consumed by projection / poolSplit)
  ?cost_center_id=…      ───→  fetchCostCenterUsageSummariesByName
/billing/budgets         ───→  fetchAllAiCreditsBudgets ─→   pickEnterpriseBudget
                                                              forecastSummary
                                                              splitPool
/cost-centers            ───→  fetchAllCostCentersDetailed
                                       │
                                       ▼
                              src/hooks/use-credentials.tsx
                              (orchestrates all fetches; gates on PAT scopes)
                                       │
                                       ▼
                              src/components/DashboardPage.tsx
                              (trackedForecast computed at L95-138; tiles render)
```

## Audit tooling (added 2026-05)

### `scripts/probe-dashboard.ts`

Re-uses every `src/lib` fetcher and math helper to recompute the
Dashboard's tiles from a fresh API call. If the probe and UI ever
diverge, the bug is in `DashboardPage.tsx` — not in `src/lib`.

```bash
./node_modules/.bin/tsx scripts/probe-dashboard.ts \
  [--env <path-to-.env>] \
  [--json <out-path>]
```

Outputs a markdown table grouped by dashboard section (`§1 pool`,
`§2 forecast`, `§3 allocation`, `§4 cost centers`) plus a JSON dump.
Read-only — safe to leave in repo and re-run anytime.

### `?debug=1` URL flag

Adds a small `i` badge next to every spend-forecast KPI and
forecast-breakdown stat. Hover to see:

- the API field(s) the value comes from
- the formula applied
- every raw input that fed into the rendered number

Component: `src/components/DebugBadge.tsx`. To extend it to a new tile,
import `DebugBadge` + `DebugInfo` and pass a `debug` prop.

## How to verify a change

1. Run the probe against a representative enterprise (the team's
   `tbb-staffship` and `octodemo` test envs cover sparse + dense data).
2. Open the dashboard with `?debug=1` against the same env.
3. Tile-by-tile, confirm probe output matches the UI.
4. If a divergence appears, the formula in `DashboardPage.tsx` is out
   of sync with `src/lib`.

## Reference docs

- [ai-credit-pool.md](./ai-credit-pool.md) — included pool sizing.
- [metered-ai-credits.md](./metered-ai-credits.md) — budgets, ULBs,
  cost-center routing.
