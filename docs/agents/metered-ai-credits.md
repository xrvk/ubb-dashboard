# Metered AI credits — budgets, UBBs, and cost centers

> **TL;DR** After the [included AI credit pool](./ai-credit-pool.md) is
> drained, every additional credit is "metered" and chargeable. GitHub
> exposes four budget scopes (`enterprise`, `multi_user_customer`,
> `cost_center`, `user`) to cap and attribute that overage, but only
> two of them report `consumed_amount`. That asymmetry drives most
> dashboard quirks — read this whole doc before changing any forecast,
> attribution, or breakdown logic.

## The four budget scopes

All come from a single endpoint:
`GET /enterprises/{ent}/settings/billing/budgets` with `budget_type ==
'BundlePricing'` and `budget_product_sku == 'ai_credits'`. Fetched by
`fetchAllAiCreditsBudgets` in `src/lib/api.ts`.

| `budget_scope` | What it represents | `budget_amount`? | `consumed_amount`? |
|---|---|:---:|:---:|
| `enterprise` | Hard cap on enterprise-wide metered spend (the "enterprise budget" tile). | ✅ | ❌ |
| `multi_user_customer` | **Universal UBB.** Per-user metered ceiling that applies to every user with no other UBB. | ✅ | ✅ |
| `cost_center` | Per-CC cap on metered spend for users routed through that cost center. | ✅ | ❌ |
| `user` | **Individual UBB.** Per-user metered ceiling that overrides universal UBB for that user. | ✅ | ✅ |

> **The critical gotcha**: `enterprise` and `cost_center` budgets are
> caps only — they do **not** report how much has been spent. To know
> what a CC actually used you must call
> `/usage/summary?cost_center_id=…` per CC. To know enterprise-wide
> spend you must call `/usage/summary` with no CC filter (and ideally
> filter to `copilot_ai_unit` + `coding_agent_ai_unit` SKUs).

## Routing precedence

For any given user, when metered spend happens:

```
1. Is the user a member of a cost center?
     yes → spend draws against that CC's budget (if capped)
            and is attributed to the CC in usage/summary
     no  → spend draws against either:
            • their individual UBB (user-scope budget), OR
            • the universal UBB (multi_user_customer), OR
            • neither — uncapped enterprise overage
```

The enterprise budget is **above** all of these: it's a global ceiling,
not a per-user one. Exceeding it gates further usage at the enterprise
level (depending on enterprise policy on overage).

## What the dashboard actually shows

Two views, both in `DashboardPage.tsx`:

### 1. Spend forecast (4 KPI tiles + 4-stat breakdown)

```
totalMtd       = usage.aiCreditsGross           if PAT has enhanced-billing
               = univMtd + indMtd               otherwise (UBB-proxy fallback)
totalProjected = projectMonthlyBudget(totalMtd, 0).projectedMonthTotal
universal.*    = from multi_user_customer budget's consumed_amount
individual.*   = Σ over user-scope budgets' consumed_amount
ccRouted (a.k.a. "Other / unattributed")
               = max(0, totalProjected − universal.projected − individual.projected)
                 only computed when hasActual (i.e. we have enterprise gross)
```

The **"Other / unattributed"** bucket exists *because* CC budgets don't
report `consumed_amount`. We back it out by subtracting the two scopes
we *can* attribute from the enterprise total. If you see this number
dominate a tenant (>50%), it almost always means heavy CC usage with
sparse individual / universal UBB adoption — not a bug.

### 2. Budget allocation card

Compares `Σ cc.budgetAmount` against the enterprise cap. Has its own
"over-allocated" definition (raw budget sum > cap), distinct from
`poolSplit.overAllocated` in `src/lib/poolSplit.ts` (which uses
*effective* drawable amount, capped by UBB ceilings × seat counts).
Both are intentional — they answer different questions.

## The MTD vs net distinction

| Term | Definition | Where it appears |
|---|---|---|
| **Pool drawdown** | Gross AIC consumption against the included pool. | `Pool remaining` tile, `Pool drawdown` bar. |
| **MTD (gross)** | All AIC consumption in the month, gross of credits/refunds. | `Spent MTD` tile (when `hasActual`), per-CC rows. |
| **MTD (net)** | After credits, refunds, and CC policy adjustments. | License cost rows. **Never** the forecast denominator. |
| **`consumed_amount`** | Per-scope (`user` / `multi_user_customer` only). Reflects the budget's view of net spend it has counted. | Individual / Universal UBB breakdown stats. |

> Forecast and pool tiles use **gross**. Don't switch them to net
> without thinking — the pool drains on gross, not net.

## Code map

| Concern | File |
|---|---|
| API fetchers (budgets, seats, usage, CCs) | `src/lib/api.ts` |
| Per-seat / pool math | `src/lib/pricing.ts` |
| Per-user / per-month projection | `src/lib/projection.ts` |
| Forecast aggregation (the `forecast` and `trackedForecast` objects) | `src/lib/projection.ts` + `DashboardPage.tsx:95-138` |
| CC vs enterprise drawdown split | `src/lib/poolSplit.ts` |
| `pickEnterpriseBudget`, UBB selection | `src/lib/api.ts` |
| Enhanced-billing gating | `src/hooks/use-credentials.tsx` (`usage.aiCreditsGross` is `null` when scope is missing) |

## Things you will *want* to do that you should not

- **"Just sum the CC budgets' consumed_amount."** It doesn't exist. The
  API does not return that field for `cost_center`-scope budgets. The
  only signal of CC actual spend is per-CC `usage/summary`.
- **"Use net AIC for the forecast."** Net is post-policy and will
  under-state the pool drain. Forecast and pool stay on gross.
- **"Treat the enterprise budget as the cap on the pool."** The pool
  size is determined by seat allowances; the enterprise budget is the
  cap on *metered* (post-pool) spend.
- **"Show universal UBB as a per-user value."** Universal UBB is a
  per-user *ceiling* that applies to every user without a CC or
  individual UBB. The `consumed_amount` on the universal budget is the
  Σ across all those users (not per-user).
- **"Fall back to UBB-proxy silently."** If `hasActual` is false, the
  totals exclude CC-routed seats without UBBs entirely. The dashboard
  surfaces this with an amber warning + hint copy — don't suppress it.

## Verifying

Same tools as the pool doc:

```bash
./node_modules/.bin/tsx scripts/probe-dashboard.ts --env <path-to-.env>
# → writes a reconciliation table and JSON; diff against the UI

# In-app data-lineage inspector (source / formula / inputs per tile):
http://localhost:5005/ubb-dashboard/?debug=1
```

The audit findings from 2026-05 (`session-state/.../audit-findings.md`)
confirm the formulas above match the rendered UI exactly across two
test enterprises. If you change any formula here, re-run the probe and
update both docs.
