# The included AI credit pool

> **TL;DR** Every assigned Copilot Business / Enterprise seat contributes
> a fixed monthly bundle of AI credits (AICs) into a single pool at the
> billing-entity level. The pool is what users draw against *before* any
> metered / overage spend begins. The dashboard sizes this pool from
> seat counts × per-seat allowance × $0.01, never from a billing API
> field.

## The shape of the data

| Quantity | Source | Notes |
|---|---|---|
| CB / CE seat counts | `GET /enterprises/{ent}/copilot/billing/seats` (paginated) + `GET /orgs/{org}/copilot/billing` per unique org → `seatCostBreakdown(seats, orgPlans)` | Each seat's billed tier is the plan of the org that granted it. A user appearing in both a CB and a CE org bills as CE. Enterprise-team-only seats (no org) default to CB. The per-seat `plan_type` field is **not** used for billing tier — it reflects the granting org's plan as reported on the seat and disagrees with the contract in mixed enterprises. If the per-org rollup fails, `seatCostBreakdown` falls back to the legacy per-seat `plan_type` matcher. |
| Per-seat AICs/mo | `pricing.ts` constants | **Not** returned by any API. Hard-coded from the public docs. |
| Pool size (credits) | `business × perBusiness + enterprise × perEnterprise` | `includedAiCredits()` in `src/lib/pricing.ts`. |
| Pool size ($) | `totalCredits × 0.01` | 1 AIC = $0.01 USD. |
| Pool MTD drawdown ($) | `Σ usageItems[sku ∈ {copilot_ai_unit, coding_agent_ai_unit}].grossAmount` from `GET /enterprises/{ent}/settings/billing/usage/summary?product=Copilot` | Gross, **not** net. The pool depletes on gross AIC consumption. |

## Per-seat AIC allowances

Source of truth: [`src/lib/pricing.ts`](../../src/lib/pricing.ts).

| Plan | Standard AICs/seat/mo | Promo AICs/seat/mo |
|---|---:|---:|
| Copilot Business (CB) | **1,900** ($19) | 3,000 ($30) |
| Copilot Enterprise (CE) | **3,900** ($39) | 7,000 ($70) |

The promo window is **2026-06-01 → 2026-09-01** for existing CB/CE
customers transitioning to usage-based billing. `isCreditPromoActive()`
gates this purely by date — there is no per-enterprise opt-in field.

> **If GitHub changes pricing or the promo window**, update the four
> `COPILOT_*_CREDITS_*` constants and the two `PROMO_*` dates in
> `pricing.ts`. The dashboard re-derives everything from those.

## How the pool drains

```
┌────────────────────────────────────────────────────────────────────┐
│                    Included AI credit pool                         │
│                                                                    │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  └── gross AIC MTD ──┘                                             │
│                                                                    │
│  drained first by *any* Copilot user, regardless of which CC or    │
│  ULB scope they belong to                                          │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ (pool exhausted)
                       see metered-ai-credits.md
```

Key properties:

1. **Pool is enterprise-wide and fungible.** A CC's users still drain
   the shared pool. Cost center budgets don't reserve pool credits.
2. **No per-user pool slice.** A user with no ULB and a heavy day can
   consume credits that "belonged" (conceptually) to other seats.
3. **Drainage is gross, not net.** A $100 raw event followed by a $20
   credit/refund still drains the pool by $100 in the gross MTD column
   the dashboard uses; the $80 net only matters for billing.
4. **The pool resets monthly** on the billing cycle. Forecast extrapolates
   linearly: `mtd + (mtd / daysElapsed) × daysRemaining`
   (`projectMonthlyBudget` in `src/lib/projection.ts`).

## Where this shows up on the dashboard

- **Pool and licenses card** (`PoolAndLicensesCard`): pool size,
  per-seat AICs, license MTD ($) per plan, and the **pool drawdown bar**
  (`min(grossMtd, pool) / pool`).
- **Pool remaining tile** in the Spend forecast strip:
  `max(0, poolSize − grossMtd)`.

## Gotchas for agents

- **Don't confuse `aiCreditsGross` and `aiCreditsNet`.** The pool
  drainage uses **gross**. Customer invoiced overage is net (after
  cost-center policy / credits).
- **Don't read `totalDollars` as a budget.** It's the pool size, not a
  cap. The enterprise budget cap is a separate construct (see
  `metered-ai-credits.md`).
- **`isCreditPromoActive(now)` is date-only.** Don't add a per-tenant
  override unless GitHub gives us one.
- **`other` seats contribute zero.** If `seatCostBreakdown` returns a
  non-zero `other`, those users still consume credits but won't show up
  in pool sizing. Worth surfacing if you ever extend the dashboard.
- **SKU strings are case-sensitive** and have changed historically
  (`'business'` vs `'copilot_business'` etc.). The probe in
  `scripts/probe-dashboard.ts` lists the SKUs the API actually returns —
  always check fresh before adding a new SKU filter.

## Verifying

```bash
# Recompute pool sizing for any enterprise and compare to the UI tile:
./node_modules/.bin/tsx scripts/probe-dashboard.ts --env <path-to-.env>

# Inspect a tile in the running app:
# add ?debug=1 to the URL, hover the (i) badge on the "Pool remaining" KPI
http://localhost:5005/ubb-dashboard/?debug=1
```
