# API reference

Practical reference for every GitHub Enterprise Billing API call this
app makes. Read alongside [external-systems.md](./external-systems.md)
(which covers auth, allowlist, version pin, and high-level quirks).

The canonical source is always `src/lib/api.ts`. If this doc and the
code disagree, the code wins — file a docs fix.

## Endpoints in use

All paths are relative to
`{base}/enterprises/{ent}/settings/billing` unless noted. `{base}` is
`https://api.github.com` for GHEC and `https://api.{host}` for
`*.ghe.com` (see `assertTrustedApiBase`).

| Method | Path (post-base) | Used by | Pagination | Mutation |
|---|---|---|---|---|
| `GET` | `/budgets` (with `budget_type=` filter) | `paginateAllBudgets` → `fetchAllAiCreditsBudgets`, `fetchUserBudgets`, etc. | Yes (see below) | — |
| `GET` | `/cost-centers` | `fetchAllCostCenters` | Single page in practice | — |
| `GET` | `/cost-centers/{id}/...` | per-CC budget + usage lookups | Single page | — |
| `GET` | `enterprise:/copilot/billing/seats` | `fetchAllCopilotSeats` | Yes (see below) | — |
| `GET` | `enterprise:/settings/billing/usage/summary?product=Copilot` | `fetchUsageSummary` | Single page | — |
| `PATCH` | `/budgets/{id}` | edit-budget flow + bulk-unblock | — | ✅ |

The `enterprise:` prefix in `createApiFetch` switches off the implicit
`/settings/billing` suffix so we can hit `/copilot/billing/...` and
other enterprise-root paths under the same trusted base.

## Pagination behavior (per endpoint)

Empirical, measured against `api.github.com`. The server-side rules are
not identical across endpoints — don't assume `per_page=100` is honored
just because GitHub's docs say it should be.

| Endpoint | Honors `per_page=100`? | Page-1 total field | Typical page count |
|---|---|---|---|
| `/budgets` | ✅ (up to 100 / page) | `total_count` | `ceil(total_count / 100)` (e.g. 235 budgets → 3 pages) |
| `/copilot/billing/seats` | ✅ | `total_seats` | `ceil(total_seats / 100)` (e.g. 1,320 seats → 14 pages) |
| `/cost-centers` | n/a | n/a — returns all in one shot | 1 |
| `/usage/summary` | n/a | n/a — one document | 1 |

The paginators in `api.ts` (`paginateAllBudgets`,
`fetchAllCopilotSeats`) use page-1's length as the *effective* page
size, so they behave correctly even if a host returns a smaller
page size than requested. If a future endpoint changes its per-page
default, the paginator adapts without code changes.

### Parallelization strategy

Both real paginators (`paginateAllBudgets`, `fetchAllCopilotSeats`)
follow the same pattern:

1. Fetch page 1 sequentially. Read `total_count` / `total_seats`.
2. Compute `remaining = ceil((total - page1Len) / page1Len)` and
   enumerate page numbers `[2, 3, …, 1 + remaining]`.
3. Fetch those pages through `fetchPagesInParallel` — chunked
   `Promise.all` with `PARALLEL_PAGE_CONCURRENCY = 8`.
4. Append results in page order (not resolution order) so callers see
   the same shape as the old sequential loop.
5. **Fallback**: if page 1 omits the total field, fall back to a
   sequential `while (page <= PAGE_SAFETY_LIMIT)` loop that stops on
   an empty page. `PAGE_SAFETY_LIMIT = 1500`.

Don't raise the concurrency cap above 8 without a measured reason. It
was chosen to stay well under GitHub's secondary rate-limit thresholds
even when several paginators run in parallel during `connect()`.

## Connect-time call budget

`connect()` (in `src/hooks/use-credentials.tsx`) kicks off four
paginated fetchers in parallel via `Promise.all`:

```
connect()
├─ fetchAllAiCreditsBudgets     → paginateAllBudgets    (1 + (N₁-1)/8 chunks)
├─ fetchAllCopilotSeats         → seats pagination       (1 + (N₂-1)/8 chunks)
├─ fetchAllCostCenters          → 1 call
└─ fetchUsageSummary            → 1 call
```

Wall-clock = max of the four. On a 1,320-seat enterprise, the seats
paginator dominates at ~2s (1 sequential page-1 + 13 pages in 2 chunks
of 8 + 5 at concurrency 8 ≈ 2 round-trips).

If you add a fifth fetcher to `connect()`, think about whether it
*needs* to block initial render. Two budget-aware alternatives:

- Fire it after `setCredentials` so the dashboard paints first.
- Move it to a lazy `useEffect` on the tile that actually needs it.

## Rate limits

This is what the read path actually does, not the GitHub policy in the
abstract. For the upstream policy itself, see GitHub's docs:

- [Primary rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)

### What this app does on 429

- **Read path** (`createApiFetch` → `GET` calls from paginators and
  `connect()`): **no retry**. A 429 throws `ApiError` and surfaces to
  the user as a connection / fetch failure. The concurrency cap of 8
  on the read path makes hitting either rate limit unlikely in
  practice; if a customer hits one, the right fix is to investigate,
  not to add silent retries.
- **Write path** (`src/lib/batch.ts`, used by edit-budget and bulk
  unblock): retries up to 2 times on 429, honoring `Retry-After` (or
  60s fallback when absent). Tests in `src/lib/__tests__/batch.test.ts`
  cover both the retry path and the give-up path. Don't remove them.

### Headroom (rough back-of-envelope)

Per-PAT budgets on GHEC are 5,000 requests/hour for classic PATs and
15,000 requests/hour for fine-grained PATs. A typical `connect()` is
~20 calls. A power user who reconnects every few minutes for an hour
still sits under 1k. The concurrency cap of 8 keeps us well below
secondary-limit "burst" thresholds for the read endpoints we touch.

If you're about to add something that bursts more than a few dozen
requests per minute per user (e.g. polling tiles, fan-out probes,
per-user follow-ups), think hard. Cache, batch, or move it to a manual
"refresh" affordance.

## Adding a new endpoint

Checklist before merging:

1. Confirm the endpoint is under
   `enterprises/{ent}/settings/billing/...` or `.../copilot/billing/...`
   so the existing allowlist + base safety apply. Anything outside
   needs a discussion first.
2. Add the call in `api.ts` next to the existing fetchers, with a
   one-line comment naming which tile / action uses it.
3. If paginated, reuse `fetchPagesInParallel` rather than rolling a
   new loop. Match the page-1-then-fan-out pattern.
4. Add it to the table in this doc *and* in
   `external-systems.md`. The two are intentionally kept in sync —
   `external-systems.md` is the short index, this doc has the
   per-endpoint detail.
5. Cover the new fetcher with a vitest test in
   `src/__tests__/api.test.ts`. Pagination cases should at minimum
   assert (a) total call count and (b) in-order concatenation.
