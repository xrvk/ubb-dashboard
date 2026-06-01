# Workflow

How to make changes here without breaking things.

## Commands you'll actually run

```bash
npm run dev                  # Vite dev server on 127.0.0.1:5005
npm run build                # production build → dist/
npm run preview              # serve the built dist/

npx vitest run               # full test suite (one-shot, CI-style)
npx vitest                   # watch mode
npx tsc -b --noEmit          # typecheck
npm run lint                 # ESLint
```

Before opening a PR, the minimum bar is: `npx vitest run` green +
`npx tsc -b --noEmit` clean. `npm run lint` may have 1 pre-existing
warning — don't introduce new ones.

## Demo mode knobs

## URL parameters

The full reference lives in [`docs/url-parameters.md`](../url-parameters.md).
The agent-relevant subset is below — demo / dev knobs that you'll
actually toggle while working on the app.

Demo mode is URL-driven and stacks. Append any combination to
`http://127.0.0.1:5005/ind-ubb-dashboard/`:

| Param | Effect |
|---|---|
| `?demo=N` | Force demo mode with `N` synthetic users. Without this, the app starts in connect-an-enterprise mode. |
| `?cc=N` | Override the demo cost-center count (1–5000). |
| `?pool=N` | Override pool fill % (0–200). Scales `consumedAmount` on every budget so the pool tile shows roughly `N%` drawn. |
| `?exclude=0` / `?exclude=1` | Include / exclude CC-bucketed usage from the individual list. Default is `1` (excluded) since CC users aren't individually-budgeted. |
| `?asof=YYYY-MM-DD` | Pin the synthetic "today" so screenshots and time-elapsed math stay stable. Default is "5 days before month end" of the current real month. |
| `?debug=1` | Show the dashboard data overlay (origins + raw values for each tile). See `dashboard-data-flow.md`. |
| `?ent=...` | Prefill the Enterprise URL field on the connect form (bare slug or full URL). Ignored in demo mode. |
| `?host=...` | Companion to `?ent=` for GHE.com tenants. See `docs/url-parameters.md`. |

The default demo (`?demo=150`) is the canonical scenario for
screenshots: 5 days to month end, ~8/10/14/22/46 distribution across
status buckets, realistic CC bullet shapes.

## Branch & PR conventions

- Branch names are `xrvk/<kebab-description>`.
- One PR per coherent unit of work, even if it's a big rollup. The
  repo has both small focused PRs and large polish PRs — both are fine.
- Squash-merge is the repo norm. Don't pass `--delete-branch` (the
  repo's auto-delete setting handles it).
- See `tone-and-voice.md` for commit message + PR body conventions.

## Don't do this

The hard rules. Breaking any of these will get the change reverted.

1. **Don't commit secrets.** No PATs, no tokens, no real enterprise
   slugs, no customer names. The repo is public.
2. **Don't loosen `assertTrustedApiBase`.** It's a security control
   *and* a CodeQL sanitizer.
3. **Don't add a backend.** No serverless function, no proxy, no
   "small helper API." The app is browser-only and that's load-bearing.
4. **Don't add a router.** `App.tsx`'s `useState<Tab>` is the
   navigation. URL parameters are for demo mode and `?debug=1`, not
   for deep links.
5. **Don't add a state-management library.** `useState` + the one
   credentials hook is enough.
6. **Don't bypass `formatCurrency`.** All currency rendering goes
   through it (or its delegating aliases). Inline `toLocaleString` /
   `toFixed` for money is wrong.
7. **Don't introduce off-palette colors.** See `tone-and-voice.md`.
8. **Don't replace the forecast with a fancier model** without a
   discussion. Linear is intentional — see the disclaimer in
   `README.md`.
9. **Don't add npm telemetry / analytics SDKs.** The privacy story
   ("nothing leaves your browser except calls to the GitHub host you
   chose") is load-bearing.
10. **Don't disable tests / lint rules / CI to make red turn green.**
    Fix the root cause or escalate. The agent-merge skill has more.

## Touch this, run this

| If you change… | At minimum, also run / verify |
|---|---|
| `src/lib/pricing.ts` | All tests; manually toggle the promo pill; check the pool tile. |
| `src/lib/api.ts` | `npx vitest run src/__tests__/api.test.ts`; run `scripts/probe-dashboard.ts` against a test enterprise. |
| `src/lib/utils.ts` (formatters) | `npx vitest run src/__tests__/formatCurrency.test.ts`; reload the dev server and spot-check all dollar displays. |
| `src/lib/demo.ts` | Load `?demo=150`, then `?demo=50`, then `?demo=150&pool=75`. |
| Any color in `src/components` | Compare side-by-side against the Enterprise Budgets tab — it's the palette reference. |
| `src/hooks/use-credentials.tsx` | Demo + real connection + disconnect + reload. The two demo bootstrap call sites in particular tend to drift apart. |

## Asking for help

When you genuinely need human judgment (ambiguous review feedback,
unfamiliar customer scenario, scope question), use `ask_user`. Don't
guess at product decisions — the maintainer is one prompt away. The
agent-merge skill has more on when to escalate vs keep going.
