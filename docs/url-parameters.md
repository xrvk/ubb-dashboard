# URL parameters

The app accepts a handful of query parameters on its URL
(`/ubb-dashboard/?param=value&...`). They split cleanly into two
groups:

- **Connect helpers** are for real users and SEs prefilling the
  connect form when sharing links.
- **Demo / dev knobs** are for local development, screenshots, and
  exploring the UI without an enterprise. They're not meant for
  real-world usage.

| Param | Audience | Purpose |
|---|---|---|
| `?ent=...` | Users / SEs | Prefill the **Enterprise URL** field on the connect form. Accepts a bare slug (`?ent=octodemo`) or a full URL (`?ent=https://github.com/enterprises/octodemo`). Invalid values silently fall back to the `VITE_DEV_ENTERPRISE_URL` default. |
| `?host=...` | Users / SEs | Companion to `?ent=` for GHE.com tenants. Only used when `?ent=` is a bare slug. Must be `github.com` or `<tenant>.ghe.com`; anything else is ignored. Example: `?ent=octodemo&host=customer.ghe.com` → `https://customer.ghe.com/enterprises/octodemo`. |
| `?demo=N` | Dev / testing | Force demo mode with `N` synthetic users. Without this, the app starts in connect-an-enterprise mode. |
| `?cc=N` | Dev / testing | Override the demo cost-center count (1–5000). |
| `?pool=N` | Dev / testing | Override pool fill % (0–200). Scales `consumedAmount` on every budget so the pool tile shows roughly `N%` drawn. |
| `?exclude=0` / `?exclude=1` | Dev / testing | Include / exclude CC-bucketed usage from the individual list. Default is `1` (excluded). |
| `?asof=YYYY-MM-DD` | Dev / testing | Pin the synthetic "today" so screenshots and time-elapsed math stay stable. Default is "5 days before month end" of the current real month. |
| `?debug=1` | Dev / testing | Show the dashboard data overlay (origins + raw values for each tile). |

## Security note on the PAT

The personal access token is **never** read from a URL parameter, and
there is no `?pat=` or equivalent. Tokens in URLs leak through browser
history, the `Referer` header, server access logs, and screen-share.
The connect form always requires the PAT to be entered by hand and
does not auto-submit.

## Stacking

Params stack. For example:

- `?ent=octodemo&host=customer.ghe.com` — prefill GHE.com connect form.
- `?demo=150&pool=75` — demo mode, 150 users, pool 75% full.
- `?demo=150&debug=1` — demo mode with the data overlay on.

Demo mode bypasses the connect form, so `?ent=…&demo=N` is valid but
the `?ent` value is unused.
