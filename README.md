# Individual ULB Dashboard

**Monitor and manage per-user GitHub Copilot AI Credit budgets across your enterprise.**

_A focused, single-purpose dashboard for individual ULBs — see who's near their cap, who's already blocked, and unblock dozens or thousands of users for the month in one click._

[![License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)
[![React](https://img.shields.io/badge/react-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind](https://img.shields.io/badge/tailwind-v4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

### 🌐 [**Open the app → xrvk.github.io/ind-ulb-dashboard**](https://xrvk.github.io/ind-ulb-dashboard/)

_Runs entirely in your browser. Your enterprise URL and PAT stay in tab memory — never sent anywhere except the GitHub API host you connect to. See [Security](#-security--token-handling)._

[Open the app](https://xrvk.github.io/ind-ulb-dashboard/) · [Features](#-features) · [Quick start](#-quick-start) · [Connect your enterprise](#-connect-your-enterprise) · [How it works](#-how-it-works) · [Security](#-security--token-handling)

---

## 📸 Screenshots

![Dashboard overview — summary cards, utilization histogram, and the individual ULB table with status badges](docs/dashboard-overview.png)

_Summary cards, utilization histogram, and the searchable / filterable table of individual ULBs. Demo mode is shown here; with a real enterprise connection the data comes from the GitHub billing API._

---

> [!IMPORTANT]
> **Disclaimer:** This tool is an independent, personal project built by a GitHub Solutions Engineer to help customers and the broader community manage GitHub Copilot individual user-level budgets (ULBs). It is **not** an official GitHub product, does not represent GitHub's views, and is not endorsed or supported by GitHub.
>
> The "Unblock for the month" projection is a best-effort recommendation based on the daily spend rate observed so far this month. **Past usage patterns may not predict future usage.** GitHub may change pricing, credit allocations, or billing mechanics at any time. Always verify recommendations against [GitHub's official documentation](https://docs.github.com/en/copilot/managing-copilot/managing-github-copilot-in-your-organization/managing-the-spending-policy-for-github-copilot-in-your-organization) and your own billing data before applying changes.

---

## 🎯 Why this exists

GitHub Copilot's usage-based billing gives enterprise admins layered controls: enterprise spending limits, cost-center budgets, a universal ULB, and per-user (individual) ULBs. Today, the individual ULB layer is the hardest to operate at scale:

- The native UI lists budgets one at a time. There's no "who's over?" view.
- There's no built-in way to bulk-raise caps when a sprint pushes hundreds of users over their per-user limit.
- The API works but you have to write the script, handle pagination, handle 429s, and not block on a single failure.

This app is a single page that surfaces every individual ULB, classifies them by utilization, and lets you bulk-unblock at scale — with rate-limit-aware batching so you can safely apply 5,000+ updates from your browser.

It is intentionally focused on **one job** and is meant to be a companion to the broader [Copilot Budget Command Center](https://github.com/xrvk/copilot-budget-command-calculator) (CCC) when you need to plan tiers, sizes, and budget hierarchies.

---

## ✨ Features

| 📊 See | ✏️ Edit | 🚀 Apply at scale |
|:--|:--|:--|
| Utilization histogram with 5 buckets | Single-row edit & delete dialogs | Multi-select with cross-page "select all matching" |
| Interactive cards that filter the table | Searchable Copilot-seat autocomplete on Add ULB | "Unblock N users for the month" bulk dialog |
| Click-to-filter histogram bars | Hard-stop (`prevent_further_usage`) always enforced | Projection math with per-row override |
| Custom budget min/max range filter | Existing-ULB users disabled in the picker | Live progress bar, ETA, and cancel |
| Sortable table, paginated 50/page | Optimistic refetch after every write | Rate-limit-aware: bounded concurrency + 429 retry |

### Cost center attribution

Each user row shows the cost center their Copilot usage is charged to, with a dropdown filter for any active CC or **Unassigned** (enterprise default). Resolution follows the [cost-center allocation rules](https://docs.github.com/en/billing/reference/cost-center-allocation):

1. The CC that lists the **user** as a direct resource wins.
2. Otherwise, the CC that lists the **org that granted the user's Copilot license** wins (shown with a "via org" badge).
3. Otherwise, the user is shown as **Unassigned**.

If the connected PAT lacks `manage_billing:enterprise` read scope, the cost-center column and filter are hidden gracefully — the rest of the dashboard keeps working.

### Status & utilization

Each user is classified by `consumed_amount ÷ budget_amount`:

| Bucket | Meaning | Color |
|:-:|---|:-:|
| 0–50% | Low utilization | 🟢 emerald |
| 50–80% | Moderate | 🟢 green |
| 80–90% | Getting close | 🟡 amber |
| 90–100% | About to block | 🟠 orange |
| 100%+ | Blocked / over | 🔴 red |

The summary cards and histogram are wired to the table — clicking either applies a filter and scrolls to the rows you care about.

### Unblock for the month

![Unblock for the month dialog — per-user recommended caps with editable growth buffer and late-cycle warning](docs/unblock-for-the-month.png)

Select any number of users (within a filter or across all matching pages) and run a guided bulk-update:

- Recommended new cap = `consumed_so_far + (consumed_so_far / days_elapsed) × days_remaining` × `(1 + growth_buffer)`, rounded up to whole dollars.
- Default 5% growth buffer, fully editable.
- Per-row override input if you want to deviate from the recommendation.
- "Low confidence" tag on users where fewer than 5 days have elapsed (early-month projections are noisy).
- An expandable **How is the recommendation calculated?** explainer in the dialog footer.
- Clear disclaimer that this only raises individual ULBs — cost-center and enterprise budgets can still cause a block.
- Late-cycle warning when the billing cycle is 7 days or fewer from resetting.

### Snapshot, revert, JSON export/import

Every successful bulk apply records a snapshot of the previous caps, persisted in `localStorage` per enterprise.

- **Auto-downloaded JSON** of the snapshot at apply time, so you have an off-browser copy.
- **"Revert (N)"** button in the header opens a row-by-row preview and restores the previous values via batch `PATCH`.
- **"Import snapshot"** button accepts a JSON file (validated against the connected enterprise) so you can revert from a different machine or after `localStorage` was cleared.
- **"Download JSON"** in the Revert dialog lets you re-export the current snapshot at any time.

This solves the [mid-cycle persistence footgun](https://github.com/xrvk/copilot-budget-command-calculator/blob/main/docs/internal/space/billing-cycle-management.md): `budget_amount` survives cycle resets even though `consumed_amount` zeroes out, so a late-cycle bump silently becomes next month's baseline. With the snapshot, rolling back is a one-click action instead of a script-writing exercise.

### Scale & rate limits

GitHub classic PATs are capped at 5,000 requests/hour (primary) with a stricter secondary "abuse detection" limit on rapid bursts. The bulk-apply runner:

- Caps concurrency at 5 in-flight requests.
- Adds a small inter-task delay to stay below abuse detection.
- Parses `Retry-After` on 429s, falls back to 60 seconds, retries up to 2 times per task.
- Supports cancellation mid-batch via `AbortSignal`.
- Surfaces live progress (completed / succeeded / failed / waiting), elapsed time, and ETA.
- Pre-flight warning when the batch exceeds 5,000 (will hit the primary cap).

This means you can confidently run a 9,800-user unblock without thinking about it.

---

## 🚀 Quick start

The fastest way to try the app is the **hosted version** — no install required:

> 🌐 **[xrvk.github.io/ind-ulb-dashboard](https://xrvk.github.io/ind-ulb-dashboard/)**

To run it locally instead:

```bash
git clone https://github.com/xrvk/ind-ulb-dashboard.git
cd ind-ulb-dashboard
npm install
npm run dev   # http://localhost:5003
```

### Optional: auto-connect for dev

Create `.env.local` to pre-fill the import form and skip the connect screen:

```bash
VITE_DEV_ENTERPRISE_URL=https://your-host/enterprises/your-slug
VITE_DEV_PAT=ghp_xxxxxxxxxxxxxxxxx
```

This file is gitignored and never persisted anywhere else.

### Run with Docker

A multi-stage `Dockerfile` builds the static bundle and serves it with nginx. A dev variant runs the Vite dev server with HMR.

**Pull the published image** (built on every push to `main` by [`.github/workflows/docker.yml`](.github/workflows/docker.yml)):

```bash
docker run --rm -p 5003:80 ghcr.io/xrvk/ind-ulb-dashboard:latest
# → http://localhost:5003
```

Tags published to GHCR:

| Tag | Meaning |
|---|---|
| `latest` | Tip of `main` |
| `sha-<short>` | A specific commit |
| `vX.Y.Z` | Released git tag |
| `main` | Same as `latest` |

**Build locally with compose:**

```bash
docker compose up --build              # → http://localhost:5003
```

**Dev (Vite + HMR, source mounted):**

```bash
docker compose --profile dev up --build dev
```

`.env.local` is picked up automatically by the dev profile if present.

#### Am I running the latest image?

Each image bakes its git SHA into `/version.json` and into the OCI `org.opencontainers.image.revision` label, so you can verify either from inside the container or from the registry.

```bash
# What your running container is serving:
curl -s http://localhost:5003/version.json
# → {"sha":"8ff1a47...","ref":"main","builtAt":"2026-05-29T05:00:00Z"}

# What's currently on `:latest` in GHCR:
docker pull ghcr.io/xrvk/ind-ulb-dashboard:latest
docker inspect ghcr.io/xrvk/ind-ulb-dashboard:latest \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

If the two SHAs match, you're on the latest image. Otherwise:

```bash
docker compose pull && docker compose up -d
```

### Try without an enterprise

The app ships with a synthetic-data mode for trying the UI at scale:

| URL | What it does |
|---|---|
| http://localhost:5003/?demo=50 | Small, realistic enterprise |
| http://localhost:5003/?demo=900 | Mid-size: paginated table, full histogram |
| http://localhost:5003/?demo=9800 | Stress test: rate-limit pre-flight, progress UI |

Demo mode generates believable user distributions (~70% low / 15% moderate / 7% getting close / 5% about to block / 3% over) and stubs all writes with toast notifications so you can click around without consequence.

---

## 🔌 Connect your enterprise

The Import panel needs two things:

1. **Enterprise URL** — e.g. `https://github.com/enterprises/your-slug` or `https://your-host.ghe.com/enterprises/your-slug`.
2. **Classic personal access token** with the `manage_billing:enterprise` scope.

> Fine-grained tokens are **not** supported on the enterprise billing API. This is a platform limitation, not an app limitation. See [api-limitations.md in CCC](https://github.com/xrvk/copilot-budget-command-calculator/blob/main/docs/internal/api-limitations.md) for the full background.

On connect, the app fetches every budget and every Copilot seat in your enterprise (both are paginated up to the platform's ~10,000 budget cap and seat count). It does this twice: once on connect, once per Refresh.

### Endpoints used

All requests go to `{api-base}/enterprises/{ent}/...`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/settings/billing/budgets?per_page=100&page=N` | List every budget, filter client-side to `budget_scope = user` |
| `GET` | `/copilot/billing/seats?per_page=100&page=N` | Power the Add ULB autocomplete |
| `PATCH` | `/settings/billing/budgets/{id}` | Update a user's cap (always with `prevent_further_usage: true`) |
| `POST` | `/settings/billing/budgets` | Create a new user-scope budget |
| `DELETE` | `/settings/billing/budgets/{id}` | Remove a user-scope budget |

Header `X-GitHub-Api-Version: 2026-03-10` is set automatically.

---

## 🛠 How it works

- **No backend.** The whole app is static JS/CSS. Fetches go directly from your browser to your enterprise's API host.
- **Credentials live in React state only.** Disconnecting or closing the tab forgets them.
- **State-during-render** for prop→state syncs (no `useEffect` for derived state); state lifted to `App` for shared filters between the cards, chart, and table.
- **Pure helpers** in `src/lib/` for projection math, status classification, and the batch runner — all covered by Vitest unit tests.

### Project layout

```
src/
├── App.tsx                   # Layout, state, dialog orchestration
├── main.tsx                  # Bootstrap (CredentialsProvider, ThemeProvider)
├── components/
│   ├── BudgetsTable.tsx      # Sortable, filterable, paginated, multi-select
│   ├── BulkUnblockDialog.tsx # Projection, progress UI, cancel, explainer
│   ├── CreateBudgetDialog.tsx
│   ├── DeleteConfirmDialog.tsx
│   ├── EditBudgetDialog.tsx
│   ├── ImportPanel.tsx
│   ├── SummaryCards.tsx
│   ├── UtilizationHistogram.tsx
│   └── ui/                   # Button, Card, Dialog, Input, StatusBadge, UserCombobox
├── hooks/
│   └── use-credentials.tsx   # Connect / disconnect / refresh, demo-mode plumbing
└── lib/
    ├── api.ts                # Typed wrappers + paginated fetchers
    ├── batch.ts              # Rate-limit-aware bulk runner
    ├── demo.ts               # Synthetic enterprise generator
    ├── projection.ts         # Unblock-for-month math
    ├── status.ts             # over/near/ok classification
    └── utils.ts              # cn(), formatCurrency, formatPercent
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server on port 5003 |
| `npm run build` | Type-check + production build |
| `npm run lint` | ESLint (strict, must pass with 0 errors) |
| `npm test` | Vitest, one shot |
| `npm run test:watch` | Vitest watch mode |

---

## 🔒 Security & token handling

- **Credentials never leave the browser** except as the `Authorization` header on requests to your enterprise's API host.
- **Nothing is persisted.** Not localStorage, not sessionStorage, not cookies. Reload = re-enter.
- **No analytics, no telemetry, no third-party scripts.** Open Network → DevTools to verify.
- **No remote logging.** Errors stay in your console.

The token only needs `manage_billing:enterprise` on a classic PAT.

For vulnerability reports, see [SECURITY.md](SECURITY.md).

---

## 🤝 Companion: Copilot Budget Command Center

This app is intentionally focused on **individual ULBs only**. If you also need to plan tiers, model the entitlement pool, manage cost-center budgets, generate billing reports, or write team→cost-center sync workflows, use the broader companion app:

🔗 **[github.com/xrvk/copilot-budget-command-calculator](https://github.com/xrvk/copilot-budget-command-calculator)** — the full Copilot Budget Command Center.

---

## 📜 License

MIT — see [LICENSE](LICENSE).

## 🙋 Support

This project is maintained by a sole GitHub Solutions Engineer on a best-effort basis. See [SUPPORT.md](SUPPORT.md). It is **not** an officially supported GitHub product.

---

Developed by [@xrvk](https://github.com/xrvk).
