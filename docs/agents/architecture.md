# Architecture

10-minute map of how this app is wired. Read this before making any
non-trivial change.

## Stack

- **React 19** + **TypeScript** + **Vite** (build & dev server)
- **Tailwind v4** for styling, with a small set of palette tokens (sepia
  theme). See `tone-and-voice.md` for the allowed colors.
- **Recharts** for visualizations.
- **Vitest** for tests. **ESLint** for linting. **tsc** for typecheck.
- **No backend.** No router. No state-management library. No data layer
  beyond `fetch` and a couple of hooks.

## Entry points

```
index.html
  └── src/main.tsx
        └── src/App.tsx          ← top-level tab switcher (useState<Tab>)
              ├── OverviewPage
              ├── DashboardPage       ← the headline view
              ├── IndividualUlbPage
              ├── UniversalUlbPage
              ├── BudgetPlanner
              └── BudgetConstraintsHelpPage
```

`App.tsx` is the navigation. It is *not* hash-routed and there is no
`react-router`. Tab selection is local component state. Deep-linking
(e.g. `?demo=150`) is handled by reading `window.location` directly,
not by a router.

## State & data

There is exactly one source of credential / API state:

- **`src/hooks/use-credentials.tsx`** — owns the `Credentials` value
  (base URL, enterprise slug, token), the connection lifecycle
  (connect / disconnect / refresh / auto-connect from `.env.local`),
  and the demo-mode bootstrap. Most pages consume this hook.

Other hooks and helpers are stateless and pure where possible.

## Layers, top to bottom

```
UI (src/components/*.tsx)
       │ render tiles, tables, dialogs, charts
       ▼
Math helpers (src/lib/*.ts, not api.ts)
       │ projection, poolSplit, pricing, budgetConstraints,
       │ consumptionAnalysis, status, batch, snapshot, …
       ▼
API client (src/lib/api.ts)
       │ apiFetch + typed wrappers, pagination, retries, error mapping
       ▼
GitHub Enterprise Billing API  (see external-systems.md)
```

Keep this separation. UI components should not call `fetch` directly,
and `api.ts` should not do any computation beyond shaping the response.
Math helpers should be pure (deterministic, side-effect-free) so they
can be tested and reused by the audit/probe tooling.

## Notable modules

| Module | Role |
|---|---|
| `src/lib/api.ts` | All GitHub calls. `apiFetch`, pagination loop, allowlist on `base`, version pin, retry-on-429, demo-mode null short-circuit. |
| `src/lib/pricing.ts` | Per-seat AIC allowances (CB / CE, standard / promo) and the promo window. The constants here are the *only* source of truth. |
| `src/lib/poolSplit.ts` | Splits MTD spend between pool (gross AIC) and metered overage. |
| `src/lib/projection.ts` | Linear EoM forecast: `(MTD / days_elapsed) × days_in_month`. |
| `src/lib/budgetConstraints.ts` | "Does this budget shape make sense" rules — e.g. CC sum vs enterprise cap. |
| `src/lib/consumptionAnalysis.ts` | Per-user rate, projected month-end, blocked / near-cap detection. |
| `src/lib/status.ts` | Categorizes users / CCs into status buckets (low / nearing / at / over). |
| `src/lib/batch.ts` | The bulk-unblock primitive: chunk N users, run with concurrency, surface partial failures. |
| `src/lib/demo.ts` | All synthetic data generators (`generateDemo*`) + the `scaleDemoConsumptionTo` knob. Single file for everything demo. |
| `src/lib/utils.ts` | Shared utilities — most importantly the adaptive `formatCurrency` (3-sig-fig). All three currency exports (`formatCurrency`, `formatCurrencyWhole`, `formatCurrencyShort`) delegate to the same logic. |
| `src/lib/snapshot.ts` / `reportCache.ts` / `usageReport.ts` | Local snapshot / cache plumbing for the import + audit tools. |

## Persistence

The app persists *nothing* to a server. It uses, in order of preference:

1. **Tab memory** (React state). PAT and connection live here.
2. **`localStorage`** for user prefs that should survive a reload:
   connection metadata (not the token), promo override, demo
   preferences, last-used tab. Keys are namespaced `dashboard.*`.
3. **`.env.local`** (developer-only) for auto-connecting during local
   dev. Never read in production builds, never bundled, never committed.

## Demo mode

Triggered by any of the demo URL knobs (`?demo=`, `?pool=`, `?exclude=`,
`?entcap=`, `?asof=`). When in demo mode:

- `apiFetch` short-circuits to `null` — no network calls happen.
- `use-credentials` boots a synthetic `Credentials`-shaped value and
  populates the page from `demo.ts` generators.
- The default scenario is "5 days to month end with a realistic mix of
  little-usage / nearing-cap / blocked / capped users."

Demo mode is the **default** for new visitors who haven't connected an
enterprise. Treat it as a first-class code path, not a debug feature.

## Build & deploy

- `npm run dev` — Vite dev server on `127.0.0.1:5005`.
- `npm run build` — emits `dist/` for GitHub Pages.
- `npm run preview` — serves the built `dist/` locally.
- `npm test` — Vitest.
- `npm run lint` / `npx tsc -b --noEmit` — lint / typecheck.

Pages publishes from `main`. The site URL is in the top-level README.
