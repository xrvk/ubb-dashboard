# UBB Dashboard for Organizations

**Monitor and manage GitHub Copilot AI-credit budgets for a single GitHub organization — from the org cap down to a single user.**

_A single browser tab to see your org budget, size a universal ULB from real usage, and manage individual ULBs at scale. No backend, no enterprise account, no cost centers — just **org → universal → individual**._

[![License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)
[![React](https://img.shields.io/badge/react-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind](https://img.shields.io/badge/tailwind-v4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

### 🌐 [**Open the app → xrvk.github.io/ubb-dashboard-org**](https://xrvk.github.io/ubb-dashboard-org/)

_Runs entirely in your browser. Your org slug and PAT stay in tab memory — never sent anywhere except `api.github.com`. See [Security](#-security--token-handling)._

---

> [!IMPORTANT]
> **Disclaimer:** This tool is an independent, personal project built by a GitHub Solutions Engineer to help customers and the broader community manage GitHub Copilot user-level budgets (ULBs). It is **not** an official GitHub product, does not represent GitHub's views, and is not endorsed or supported by GitHub.
>
> Spend forecasts are best-effort recommendations based on the daily spend rate observed so far this billing cycle. **Past usage patterns may not predict future usage.** GitHub may change pricing, credit allocations, or billing mechanics at any time. Always verify recommendations against [GitHub's official documentation](https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-the-spending-policy-for-github-copilot-in-your-organization) and your own billing data before applying changes.

> [!NOTE]
> **Looking for the enterprise version?** This is the **org-only** sibling of [xrvk/ind-ulb-dashboard](https://github.com/xrvk/ind-ulb-dashboard), which targets GHEC enterprise admins with cost centers and an enterprise envelope above the org budget. See [Upstream sync](#-upstream-sync) for the relationship.

---

## 🎯 Who this is for

This app is for **GitHub Copilot Business** customers on a **single GitHub organization** — typically:

- **No enterprise account.** You administer one organization at `github.com/your-org`, not an enterprise.
- **No cost-center routing.** Your billing is one bucket, not split across cost centers.
- **You're an org owner or a billing manager** who manages Copilot for everyone in the org.

If you have an enterprise account (`github.com/enterprises/...`), use the [enterprise variant](https://github.com/xrvk/ind-ulb-dashboard) instead — it has all the extra plumbing for the enterprise envelope and cost centers, which this variant deliberately strips out.

---

## 💡 Why this exists

GitHub Copilot's usage-based billing gives org admins **three layered controls**: the prepaid AI-credit pool that comes with seats, an organization-level spending cap, and per-user budgets (a single **universal ULB** plus optional **individual ULBs** for outliers). Each layer is configurable in the native UI, but operating them together is hard:

- The native UI shows one budget at a time. There is no single view of the pool, the org cap, and every per-user ULB.
- There is no built-in spend forecast — you can see consumed-to-date but not projected end-of-month.
- There is no recommended size for the universal ULB. You guess, or you write a script to pull billing CSVs and compute the distribution yourself.
- There is no "who's over?" view for individual ULBs, and no bulk way to raise caps when a sprint pushes dozens of users over.
- The API works, but you have to write the script, handle pagination, handle 429s, snapshot before/after for rollback, and survive a single failure.

This app puts the whole org-level budget hierarchy on one screen, **forecasts** spend, **sizes** the universal cap from your real usage, and **bulk-edits** individual ULBs with rate-limit-aware batching so you can safely apply hundreds of updates from your browser.

---

## ✨ Features

| 📊 See | 🧮 Plan | 🚀 Apply at scale |
|:--|:--|:--|
| Pool drawdown vs. license contribution | Universal-ULB sizing from CSV usage | Multi-select with cross-page "select all matching" |
| End-of-month spend forecast | Top 5 / 10 / 15 / Custom cutoff presets | "Unblock N users for the month" bulk dialog |
| 3-layer constraint validation | Org-cap headroom check on every edit | Live progress bar, ETA, and cancel |
| Utilization histogram with 5 buckets | One-click auto-fix proposals | Rate-limit-aware: bounded concurrency + 429 retry |
| Click-to-filter cards, chart bars, and table | Hard-cap toggle + alert recipients | Snapshot + revert + JSON export/import |

The app is organized into **four tabs**, each focused on one piece of the budget hierarchy:

### Dashboard
Top-of-funnel view: AI-credit pool & seat licenses, pool drawdown, spend forecast (4 cards: org budget cap, spent MTD, projected EoM, pool remaining), and ULB coverage (universal vs. individual vs. uncovered seats). The constraint banner across the top warns when committed ULBs exceed the org cap and offers raise/lower one-click fixes.

### Org Budget
A single editor for the org-scope `ai_credits` budget: cap amount, hard-cap toggle (`prevent_further_usage`), and alert recipients. Deep-links to the native admin pages for budgets and AI usage. The constraint banner appears here too, so you can fix overcommitment from either end.

### Universal ULB
Pick the right universal ULB without guessing. Upload one or more months of detailed billing usage CSVs and the app:
1. Sizes each user off their biggest single month.
2. Plots the consumption curve (sorted users on X, AI-credit spend on Y).
3. Recommends a split between regular users (covered by the universal ULB) and outliers (who need an individual ULB) using Top 5 %, 10 %, 15 %, or custom cutoffs.
4. Lets you drag the cutoff and ULB lines directly on the chart.

An org-budget headroom card on the same page shows the max universal ULB that keeps `Σ effective ULBs ≤ org cap`, with a one-click "Snap to max safe" button.

### Individual ULBs
Per-user ULB management. Spend cards, utilization histogram (5 buckets), searchable/sortable/paginated table, single-row edit/delete, **bulk "Unblock for the month"** dialog, snapshot+revert, and JSON export/import. The bulk runner caps concurrency at 5, retries 429s with `Retry-After`, and surfaces live progress + ETA — you can confidently run a few hundred updates from a classic PAT without hitting abuse-detection limits.

---

## 🚀 Quick start

The fastest way to try the app is the **hosted version** — no install required:

> 🌐 **[xrvk.github.io/ubb-dashboard-org](https://xrvk.github.io/ubb-dashboard-org/)**

To run it locally instead:

```bash
git clone https://github.com/xrvk/ubb-dashboard-org.git
cd ubb-dashboard-org
npm install
npm run dev   # http://localhost:5003
```

### Optional: auto-connect for dev

Create `.env.local` to pre-fill the import form and skip the connect screen:

```bash
VITE_DEV_ORG_URL=https://github.com/your-org
VITE_DEV_PAT=ghp_xxxxxxxxxxxxxxxxx
```

This file is gitignored and never persisted anywhere else.

### Try without a real org

The app ships with a synthetic-data mode for trying the UI at scale:

| URL | What it does |
|---|---|
| `http://localhost:5003/?demo=50` | Small org, realistic distribution |
| `http://localhost:5003/?demo=300` | Mid-size: paginated table, full histogram |
| `http://localhost:5003/?demo=900` | Larger: bulk-apply progress UI, rate-limit pre-flight |

Demo mode generates believable user distributions (~70 % low / 15 % moderate / 7 % getting close / 5 % about to block / 3 % over) and stubs all writes with toast notifications so you can click around without consequence.

---

## 🔌 Connect your organization

The Import panel needs two things:

1. **Organization URL or slug** — e.g. `https://github.com/logans-lounge` or just `logans-lounge`.
2. **Classic personal access token** with the **`admin:org`** scope (the full one, not just the `write:org` sub-scope). Confirmed empirically via the `x-accepted-oauth-scopes` header on `GET /orgs/{org}/settings/billing/budgets`: the endpoint accepts `admin:org` or `repo` and silently 404s on anything else (including `write:org`+`manage_billing:copilot` together — despite what the public docs imply).

> Fine-grained tokens are **not** supported on the org billing API. This is a platform limitation, not an app limitation.

> **github.com only.** This variant does not support GitHub Enterprise Server. If you're on GHES, the parent [enterprise variant](https://github.com/xrvk/ind-ulb-dashboard) supports both hosts.

On connect, the app fetches every budget and every Copilot seat in the org (both paginated). It does this once on connect and again per Refresh.

### Endpoints used

All requests go to `https://api.github.com/orgs/{org}/...` or the equivalent settings paths:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/orgs/{org}/settings/billing/budgets?per_page=10&page=N` | List every budget (org, universal, individual) |
| `GET` | `/orgs/{org}/copilot/billing/seats?per_page=100&page=N` | Power the Add ULB autocomplete |
| `POST` | `/orgs/{org}/settings/billing/budgets` | Create the org budget, universal ULB, or an individual ULB |
| `PATCH` | `/orgs/{org}/settings/billing/budgets/{id}` | Update any budget (always with `prevent_further_usage: true` on user-scope ULBs) |
| `DELETE` | `/orgs/{org}/settings/billing/budgets/{id}` | Remove a budget |

Header `X-GitHub-Api-Version: 2026-03-10` is set automatically.

> **Pagination note:** the org billing budgets endpoint caps `per_page` at **10** (vs. 100 for the enterprise variant). Large orgs may need many pages — the bundled parallel fetcher still handles this in seconds, but progress UI estimates account for it.

> **Filter quirk:** the `scope=organization` query filter on `/budgets` returns 0 results even when an organization-scope budget exists. The app fetches unfiltered and filters client-side; do the same if you're writing your own integration.

See the [GitHub docs on org budgets](https://docs.github.com/en/rest/billing/budgets) for the underlying REST API.

### Admin pages

The app deep-links to the native admin UI for actions it doesn't expose directly:

- **Budgets:** `https://github.com/organizations/{org}/settings/billing/budgets`
- **AI usage:** `https://github.com/organizations/{org}/settings/billing/ai_usage`
- **Copilot seats:** `https://github.com/organizations/{org}/settings/copilot`

---

## 🧠 The 3-layer budget model

The app enforces a single golden rule:

```text
Σ effective ULB(seat) ≤ org budget cap
```

where `effective ULB` for a seat is:

- the user's **individual ULB** if one is set, otherwise
- the **universal ULB** amount, otherwise
- `0` (the user is unbounded until the org cap, then blocked).

When the rule fails, the constraints banner appears on every tab with two one-click fixes:

- **Raise org budget to $X** — bumps the org cap to exactly cover current commitments.
- **Lower universal ULB to $Y** — drops the universal cap to the max value that satisfies the rule (or hides the option when individual ULBs alone already exceed the cap).

Soft warnings (not failures) include:
- The org budget is configured as a soft cap (`prevent_further_usage: false`).
- Some Copilot seats have neither an individual nor a universal ULB and are effectively unbounded.

See `src/lib/budgetConstraints.ts` and the `orgVariantCore` test suite for the full spec.

---

## 🛠 How it works

- **No backend.** The whole app is static JS/CSS. Fetches go directly from your browser to `api.github.com`.
- **Credentials live in React state only.** Disconnecting or closing the tab forgets them. CSV usage data and bulk-apply snapshots are persisted in `localStorage` per-org, but never the token.
- **Pure helpers** in `src/lib/` for projection math, status classification, pool/spend math, budget-constraint validation, and the batch runner — all covered by Vitest unit tests.

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server on port 5003 |
| `npm run build` | Type-check + production build |
| `npm run typecheck` | `tsc -b` only (fast TS feedback without bundling) |
| `npm run lint` | ESLint (strict, must pass with 0 errors) |
| `npm test` | Vitest, one shot |
| `npm run verify` | typecheck + lint + test in parallel — local pre-PR check |

---

## 🔄 Upstream sync

This repo is a sibling of [`xrvk/ind-ulb-dashboard`](https://github.com/xrvk/ind-ulb-dashboard) (the GHEC enterprise variant). Shared bug fixes flow in both directions by cherry-pick — see [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for the running log of applied SHAs and the rules of engagement.

Add the parent as a remote in a local clone:

```bash
git remote add upstream https://github.com/xrvk/ind-ulb-dashboard.git
git fetch upstream
```

---

## 🔒 Security & token handling

- **Credentials never leave the browser** except as the `Authorization` header on requests to `api.github.com`.
- **The token is not persisted.** Not localStorage, not sessionStorage, not cookies. Reload = re-enter. (CSV usage data and bulk-apply snapshots _are_ persisted in `localStorage` per-org, but never the token.)
- **No analytics, no telemetry, no third-party scripts.** Open Network → DevTools to verify.
- **No remote logging.** Errors stay in your console.

The token needs the **`admin:org`** scope on a classic PAT (the org billing endpoint declares `x-accepted-oauth-scopes: admin:org, repo`; `write:org` alone or `manage_billing:copilot` alone returns 404).

For vulnerability reports, see [SECURITY.md](SECURITY.md).

---

## 📜 License

MIT — see [LICENSE](LICENSE).

## 🙋 Support

This project is maintained by a sole GitHub Solutions Engineer on a best-effort basis. See [SUPPORT.md](SUPPORT.md). It is **not** an officially supported GitHub product.

---

Developed by [@xrvk](https://github.com/xrvk).
