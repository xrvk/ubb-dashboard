# Budget Constraints

This document defines the internal constraint model used by `ind-ulb-dashboard` to detect unsafe enterprise/cost-center budget configurations that can violate the user-facing ULB promise.

---

## The Golden Rule

**Golden rule:** the sum of effective per-user ULBs must remain the binding constraint.

Enterprise and cost-center budgets are outer envelopes. If either envelope is configured too tightly, users can be blocked before their ULB is exhausted. That silently breaks the product expectation:

> "Your ULB is your ULB."

This document defines the math and checks we run to detect that misconfiguration before admins rely on a bad setup.

---

## Key Concepts

### Effective ULB

For each user `u`:

`effectiveULB(u) = individualULB(u) ?? universalULB ?? 0`

Interpretation:

- Use individual ULB when present.
- Else inherit universal (`multi_user_customer`) ULB.
- Else fallback to `0` (no implicit cap).

### Budget scopes in the GitHub billing API

Observed and relevant scopes:

- `enterprise`
- `cost_center`
- `multi_user_customer`
- `user`

Documented but not currently used in constraint checks:

- `organization`
- `repository`

### `exclude_cost_center_usage`

`exclude_cost_center_usage` is a flag on the **enterprise-scope** budget entry.

- `false` (default umbrella mode):
  - CC usage rolls up under enterprise usage.
  - Enterprise budget is the true outer container.
- `true` (independent mode):
  - CC usage is tracked outside enterprise pool accounting.
  - Enterprise budget constrains only users not covered by budgeted CC pools.

### CC budget optionality

A cost center is attribution membership. Budgeting is separate.

- CC with ai-credits budget: creates its own constraint pool.
- CC without ai-credits budget: for feasibility math, its members fall through to enterprise/rest pool.

### Cost-center resource types

Current API resource types seen/accepted:

- `User`
- `Org`
- `Team` (accepted as string; linkage logic is roadmap)

Behavior assumptions:

- `User` membership uniqueness is API-enforced; collisions are effectively data anomalies.
- `Org` may appear in multiple CCs. We resolve deterministically by CC ID order (first-wins) and emit soft warnings.
- Org-collision handling is scoped to **ai-credits-budgeted CCs** because only those affect feasibility math.

### Notation used in checks

Let:

- `E` = enterprise ai-credits monthly budget amount.
- `CC_b` = set of CC IDs with ai-credits budgets.
- `B(cc)` = budget amount for CC `cc`.
- `Users(cc)` = users routed to CC `cc`.
- `U_rest` = users not routed to any budgeted CC.
- `ULB(u)` = `effectiveULB(u)`.

All sums use Σ over finite sets.

---

## The Constraint Checks

Any hard-check failure => misconfiguration banner.

### Check B — Per-CC fit (hard)

For every budgeted cost center `cc ∈ CC_b` with members:

`Σ ULB(u), u ∈ Users(cc) ≤ B(cc)`

Interpretation:

- The local user ULB commitments assigned to `cc` must fit inside that CC budget.
- Empty CCs trivially satisfy B (`0 ≤ B(cc)`).

### Check C — CCs fit inside enterprise (hard in umbrella mode only)

Umbrella mode (`exclude_cost_center_usage = false`):

`Σ B(cc), cc ∈ CC_b ≤ E`

Independent mode (`true`):

- Check C is vacuous / skipped, because CC pools do not consume enterprise headroom in this model.

### Check D — Leftover for everyone else (hard)

Define non-CC users for constraint math as users not in budgeted CCs.

Umbrella mode:

`Σ ULB(u), u ∈ U_rest ≤ E - Σ B(cc), cc ∈ CC_b`

Independent mode:

`Σ ULB(u), u ∈ U_rest ≤ E`

Interpretation:

- In umbrella mode, budgeted CCs reserve capacity first; the remainder must absorb all non-budgeted users.
- In independent mode, enterprise budget directly constrains only the non-budgeted segment.

### Why no fourth aggregate check is needed in umbrella mode

We intentionally do **not** add a separate hard check:

`Σ ULB(all users) ≤ E`

because B + C + D already imply aggregate feasibility.

Short proof (umbrella mode):

1. Partition users into budgeted-CC users and `U_rest`.
2. By B, for each budgeted `cc`: `Σ ULB(Users(cc)) ≤ B(cc)`.
3. Summing B over all budgeted CCs:
   `Σ_cc Σ_u∈Users(cc) ULB(u) ≤ Σ_cc B(cc)`.
4. By D:
   `Σ_u∈U_rest ULB(u) ≤ E - Σ_cc B(cc)`.
5. Add both inequalities:
   `Σ_u∈(all users) ULB(u) ≤ Σ_cc B(cc) + (E - Σ_cc B(cc)) = E`.

Hence aggregate check is algebraically redundant.

### Soft warnings (non-blocking)

#### Warning W1 — `prevent_further_usage = false`

If any applicable ULB source has `prevent_further_usage = false`, that limit is not a hard stop in practice.

Constraint math still computes capacity, but the golden-rule guarantee is informational for those identities.

#### Warning W2 — Coverage gap / unbounded path

Warn if a user has all of:

- no individual ULB,
- no universal ULB,
- no enclosing budgeted CC,
- no enterprise budget.

This implies no modeled hard cap path.

#### Warning W3 — Org in multiple budgeted CCs

If an org appears in multiple ai-credits-budgeted CCs, routing is ambiguous by source data.

Current rule:

- deterministic first-wins by lexical CC ID,
- raise soft warning with impacted org and chosen/ignored CC IDs.

---

## What we deliberately left out

Locked non-goals for this phase:

- No new tab/page; signal appears as banner on existing Universal and Individual views.
- No CC or enterprise budget write paths from this UI.
- No exclusion-rule simulator.
- No `maxSafeUniversalUlb` UI hint in Step 1 (value is computed/returned but not surfaced).
- No modeling of org multi-CC collisions for **non-budgeted** CCs (no effect on current hard math).
- No Enterprise Team → CC linkage (API roadmap dependency).

---

## Edge cases worth remembering

1. CC with no budget:
   - does not participate in per-CC hard check B,
   - its members are counted in `U_rest` for check D.

2. Universal ULB null/missing:
   - inherited effective ULB resolves to `0`, not implicit policy fallback.

3. Independent mode:
   - disables C only,
   - does **not** disable D.

4. Empty budgeted CC:
   - passes B trivially,
   - still contributes `B(cc)` into C (umbrella reservation behavior).

5. Negative umbrella leftover (`E - ΣB(cc) < 0`):
   - D fails immediately for any positive `U_rest` sum,
   - C will also typically fail.

6. Missing enterprise budget:
   - B can still be evaluated,
   - C/D are unknown or warning-grade depending on available data and mode metadata.

7. User assignment precedence:
   - user-level CC match first,
   - org-derived CC match second,
   - deterministic first-wins for collisions.

8. Team resource entries:
   - parser accepts `Team` type strings,
   - constraint engine currently ignores team-derived membership until API linkage lands.

---

## Implementation pointers

### Data layer (`src/lib/api.ts`)

Current baseline functions already present:

- `fetchUserBudgets`
- `fetchUniversalULB`
- `fetchCostCenters`
- `buildCostCenterIndex`
- `resolveCostCenter`

Additions/changes for this workstream:

- Add `fetchEnterpriseBudget(enterpriseSlug)`.
- Add `fetchCostCenterBudgets(enterpriseSlug)`.
- Add `fetchAllAiCreditsBudgets(enterpriseSlug)` as a unified ai-credits scan over paginated budgets.
- Extend `RawBudget` with optional `exclude_cost_center_usage?: boolean`.
- Clean up `buildCostCenterIndex`:
  - remove dead user-collision branch assumptions,
  - scope org-collision warnings to budgeted-CC relevance,
  - keep deterministic first-wins behavior.

### Pure calc module (`src/lib/budgetConstraints.ts`)

Create pure evaluator:

- `computeBudgetConstraints(input)`
- returns `{ checks, warnings, maxSafeUniversalUlb }`

Expected responsibilities:

- compute B/C/D status and overflow details,
- compute warning set (W1/W2/W3),
- derive optional advisory `maxSafeUniversalUlb`.

### UI integration

- Reuse a single `ConstraintsBanner` component.
- Render on Universal and Individual ULB pages.
- Hard-check fail => blocking/misconfig styling.
- Soft warnings only => non-blocking advisory styling.

### Tests

- Extend `src/__tests__/api.test.ts` for extraction/parsing and new helpers.
- Add `src/__tests__/budgetConstraints.test.ts` covering B/C/D matrix and warnings.

Minimum scenario matrix:

- B pass/fail.
- C pass/fail (umbrella).
- D pass/fail (umbrella + independent).
- missing enterprise budget behavior.
- non-budgeted CC membership routing to `U_rest`.
- `prevent_further_usage` warning.
- unbounded coverage warning.
- org-collision warning.

---

## Budget hierarchy model

ASCII model (umbrella mode):

```text
enterprise budget E
├── budgeted CC pool B(cc1)
│   └── users assigned to cc1
├── budgeted CC pool B(cc2)
│   └── users assigned to cc2
└── leftover pool L = E - ΣB(cc)
    └── users not in budgeted CCs (includes members of non-budgeted CCs)
```

Independent mode conceptual split:

```text
enterprise budget E (covers only non-budgeted-CC users)

cost center budgets B(cc*) are separate tracked pools
for users assigned to those budgeted CCs
```

Mermaid sketch:

```mermaid
flowchart TD
    E[Enterprise budget E]
    CC1[Budgeted CC #1 B1]
    CC2[Budgeted CC #2 B2]
    REST[Rest users pool]

    E -->|umbrella| CC1
    E -->|umbrella| CC2
    E -->|leftover E-(B1+B2)| REST

    I[Independent mode] --> ICC1[CC pools independent]
    I --> IREST[Enterprise covers rest users]
```

---

## Operational interpretation for maintainers

### What "pass" means

- The current budget graph is mathematically capable of preserving user-level ULB commitments under configured envelopes.
- It does **not** predict actual spend trajectories.

### What "fail" means

- There exists at least one deterministic violation where envelope constraints can preempt ULB promises.
- Admin action is required in GitHub billing config (not in this UI).

### What "warning" means

- Model is structurally valid but some assumptions reduce guarantee strength (soft caps, ambiguous routing, uncovered users).

---

## FAQ-level clarifications (internal)

### Why treat non-budgeted CC members as `U_rest`?

Because attribution grouping without an ai-credits budget creates no independent capacity pool. They consume enterprise-constrained headroom for feasibility purposes.

### Why include empty budgeted CCs in C?

Because configured CC budgets reserve envelope space in umbrella reasoning even if current membership is empty.

### Why first-wins on org collisions?

Input data can contain overlapping org memberships. Determinism is required for stable checks; first-by-CC-ID is transparent and testable. We expose a warning so admins can fix the source config.

### Why fallback `effectiveULB` to 0?

Absence of explicit ULB config should not be interpreted as implicit permission to consume bounded envelope capacity in this check. Zero fallback keeps math conservative and explicit.

### Why compute but not show `maxSafeUniversalUlb`?

It is useful for future planning UX, but exposing it now invites optimization behavior outside this phase scope. Keep as internal return field for future UI evolution.

---

## Reference: `octodemo/copilot-budget-command-calculator`

The CCC project is a broader budget planning calculator: interactive inputs, historical-usage assumptions, and recommendation-style outputs across multiple budget knobs.

What we borrowed conceptually:

- billing scope vocabulary and layering mindset,
- umbrella vs independent framing for outer vs split pools,
- decomposition into per-scope checks rather than only one aggregate number.

What we deliberately omitted:

- scenario planning / recommendation engine,
- editable modeling workflow,
- overage/forecast simulation,
- premium request SKU modeling,
- full planner semantics.

Our implementation is intentionally narrower: read-only ai-credits feasibility checks for preserving the ULB golden rule.

---

## Source alignment notes

- Constraint model and check definitions are locked by `plan-enterprise-budget-apis.md`.
- API-surface expectations align with current `src/lib/api.ts` naming and types.
- Cost-center routing assumptions must remain deterministic and warning-backed.

If future API behavior changes (especially Team linkage or budget scope semantics), update this document and the test matrix together.
