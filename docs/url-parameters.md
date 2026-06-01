# URL parameters

The app reads a handful of query parameters off its URL
(`/ubb-dashboard/?param=value&...`). There are two end-user params
worth knowing about; everything else is for local development,
screenshots, and deterministic test scenarios.

The personal access token is **never** read from a URL parameter, and
there is no `?pat=` or equivalent. Tokens in URLs leak through browser
history, the `Referer` header, server access logs, and screen-share.
The connect form always requires the PAT to be entered by hand and
does not auto-submit.

## For end users

### `?ent=...` — Prefill enterprise URL

Prefills the **Enterprise URL** field on the connect form. Useful when
sharing onboarding links or pointing a colleague at the right
enterprise. The user still has to paste their PAT and click Connect.

The easiest way to generate one of these links is to connect to your
enterprise, open the connection menu in the top-right, and choose
**Copy shareable link** — it builds the right form for your host
automatically.

Manual construction supports two shapes:

- **Bare slug** (github.com only): `?ent=octodemo` →
  `https://github.com/enterprises/octodemo`
- **Full URL** (any trusted host, including GHE.com):
  - `?ent=https://github.com/enterprises/octodemo`
  - `?ent=https://customer.ghe.com/enterprises/octodemo`

GHE.com tenants always use the full-URL form so the link routes to
the correct host. Invalid values (random garbage, non-GitHub hosts,
slugs with disallowed characters) are silently ignored — the form
stays usable and falls back to the `VITE_DEV_ENTERPRISE_URL` default
if one is set, or empty otherwise.

## For developers and testing

> These parameters are intended for local development, screenshots, and
> deterministic test scenarios. They are not stable end-user features
> and may change without notice.

### `?demo=N`

Boots the app with `N` synthetic users instead of asking you to
connect. Everything in the UI is fake but realistic; all writes are
stubbed with toast notifications.

Common values:

| URL | What it does |
|---|---|
| `?demo=50` | Small, realistic enterprise |
| `?demo=900` | Mid-size: paginated table, full histogram |
| `?demo=9800` | Stress test: rate-limit pre-flight, progress UI |

The remaining params in this section only take effect when `?demo=N`
is also set.

### `?cc=N`

Override the demo cost-center count (1–5000). The first 4 stay the
"story" CCs (`platform-eng`, `data-platform`, `devx`, `security`) so
constraint scenarios remain consistent.

### `?pool=N`

Override pool fill % (0–200). Scales `consumedAmount` on every budget
so the pool tile shows roughly `N%` drawn.

### `?exclude=0` / `?exclude=1`

Include (`0`) or exclude (`1`) CC-bucketed usage from the individual
list. Default is `1` since CC users aren't individually-budgeted.

### `?asof=YYYY-MM-DD`

Pin the synthetic "today" so screenshots and time-elapsed math stay
stable across runs. Default is "5 days before month end" of the
current real month.

### `?debug=1`

Show the dashboard data overlay — origins and raw values for each
tile. See `agents/dashboard-data-flow.md` for what the overlay
exposes.

## Stacking

Params stack. Examples:

- `?demo=150&pool=75` — demo mode, 150 users, pool 75% full.
- `?demo=150&debug=1` — demo mode with the data overlay on.

Demo mode bypasses the connect form, so `?ent=…&demo=N` is valid but
the `?ent` value is unused.
