# External systems

Everything this app talks to outside the user's browser. Read before
touching `src/lib/api.ts` or anything that fetches.

## GitHub Enterprise Billing API

The only external system in production. The app is a thin client.

- **Base URL**: user-supplied. Must point at GitHub.com or a `*.ghe.com`
  host. `assertTrustedApiBase` in `api.ts` enforces an allowlist —
  *do not* loosen this. It is both a real safeguard (typo'd base must
  not leak a PAT to a random host) and a CodeQL sanitizer that breaks
  the `js/file-access-to-http` taint flow from env-loaded creds.
- **Path shape**: `{base}/enterprises/{ent}/settings/billing/...`
- **API version pin**: `X-GitHub-Api-Version` is set from the
  `API_VERSION` constant at the top of `api.ts`. Bump it deliberately
  and only when needed.
- **Auth**: `Authorization: Bearer <PAT>`. The PAT is supplied by the
  user via the connection menu (or read from `.env.local` in dev).

### Endpoints we touch

| Endpoint | Purpose |
|---|---|
| `GET /enterprises/{ent}/copilot/billing/seats` | Seat list + plan types. Paginated. Source for CB / CE counts that size the pool. |
| `GET /enterprises/{ent}/settings/billing/usage/summary?product=Copilot` | MTD gross AIC consumption by SKU. Source for pool drawdown. |
| `GET /enterprises/{ent}/settings/billing/cost-centers` | Cost center list. Paginated. |
| `GET /enterprises/{ent}/settings/billing/cost-centers/{id}/...` | Per-CC budget and usage. |
| `GET /enterprises/{ent}/settings/billing/budgets/...` | Enterprise + universal + individual ULB budgets. |
| `PATCH /...budgets/{id}` | Mutations from edit-budget and bulk-unblock flows. |

The canonical, up-to-date list is whatever lives in `api.ts`. If you're
adding a new endpoint, document it there with a comment explaining
*which dashboard tile / action uses it*.

### Known quirks

These are real bugs / sharp edges in the upstream API that we work
around. Don't "fix" them without checking the upstream behavior first.

- **Pagination is mandatory** for `seats` and `cost-centers`. Single
  page is not a full result on large enterprises.
- **Some `?cost_center_id=` filters time out** on certain enterprises
  (observed >75s). The workaround in `api.ts` is to fetch unfiltered
  and bucket client-side. Comment in code explains the trigger.
- **Plan-type matching is permissive.** Match `"enterprise"` ⊂
  `plan_type` for CE, `"business"` ⊂ `plan_type` for CB. Don't do
  exact-equals — upstream has introduced suffixed variants before.
- **Gross vs net** — `usage/summary` returns both `grossAmount` and
  `netAmount`. The pool drains on gross; billing is on net. Mixing
  these is the single most common source of wrong-looking tiles.
- **429 handling is asymmetric.** The read path (`createApiFetch`) does
  **not** retry — a 429 throws and surfaces to the user. Only mutations
  routed through `src/lib/batch.ts` (edit budget, bulk unblock) retry
  on 429 with `Retry-After` honored. See
  [api-reference.md](./api-reference.md#rate-limits) for the call
  budget and rationale. Tests for the batch retry / give-up paths live
  in `src/lib/__tests__/batch.test.ts` — don't remove them.

## GitHub Pages (hosting)

- Static-only. `vite build` → `dist/` → published from `main`.
- No edge functions, no rewrites beyond the default.
- The site is **public**. Do not assume any data, header, or query
  parameter is private.

## The user's browser (the "runtime")

Treat this as an external system too. Constraints worth remembering:

- **Tab memory only** for the PAT. Refreshing the tab loses it (by
  design). `localStorage` holds non-sensitive prefs.
- **CORS**: requests go cross-origin to the user's GHEC / `*.ghe.com`
  host. The browser enforces CORS; the GitHub billing API responds
  with appropriate headers. If a customer's allowlist blocks
  `xrvk.github.io`, the app can't help.
- **No service worker.** No offline mode. Closing the tab loses tab
  memory; that's intentional.

## What this app does *not* talk to

Easy to assume otherwise — call out explicitly:

- **No GitHub.com REST outside billing.** No issues, no repos, no
  actions, no org membership lookups.
- **No third-party analytics / telemetry.** No Google Analytics, no
  Sentry, no Datadog. Don't add any without a discussion.
- **No GitHub Copilot product API.** The app reads *about* Copilot
  consumption from billing; it never calls the Copilot completion or
  chat endpoints.
- **No npm-registry runtime calls.** Build-time only.

## Dev-only "systems"

- **`.env.local`** for auto-connect during local dev. Symlinked across
  worktrees in this developer's setup. Never committed; never bundled.
- **`scripts/probe-dashboard.ts`** — Node script that re-runs the
  dashboard math against a real enterprise and dumps a JSON report.
  Useful for verifying the UI's numbers match raw API data. See
  `dashboard-data-flow.md`.
