# Self-hosting

Run the UBB Dashboard yourself, on Docker or your own static host.

## Run with Docker

A multi-stage `Dockerfile` builds the static bundle and serves it with nginx. A dev variant runs the Vite dev server with HMR.

**Pull the published image** (built on every push to `main` by [`.github/workflows/docker.yml`](../.github/workflows/docker.yml)):

```bash
docker run --rm -p 5003:80 ghcr.io/xrvk/ubb-dashboard:latest
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

### Am I running the latest image?

Each image bakes its git SHA into `/version.json` and into the OCI `org.opencontainers.image.revision` label.

```bash
# What your running container is serving:
curl -s http://localhost:5003/version.json
# → {"sha":"8ff1a47...","ref":"main","builtAt":"2026-05-29T05:00:00Z"}

# What's currently on `:latest` in GHCR:
docker pull ghcr.io/xrvk/ubb-dashboard:latest
docker inspect ghcr.io/xrvk/ubb-dashboard:latest \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

If the two SHAs match, you're on the latest image. Otherwise:

```bash
docker compose pull && docker compose up -d
```

## Run from source

```bash
git clone https://github.com/xrvk/ubb-dashboard.git
cd ubb-dashboard
npm install
npm run dev   # http://localhost:5003
```

## Auto-connect via `.env.local`

Create `.env.local` to pre-fill the import form and skip the connect screen:

```bash
VITE_DEV_ENTERPRISE_URL=https://your-host/enterprises/your-slug
VITE_DEV_PAT=ghp_xxxxxxxxxxxxxxxxx
```

This file is gitignored and never persisted anywhere else.

## Multiple enterprise profiles

If you regularly bounce between enterprises (e.g. a staging GHE.com tenant + a production GHEC enterprise), drop one file per profile alongside `.env.local`:

```bash
# .env.acme-staging.local
VITE_DEV_ENTERPRISE_URL=https://your-host.example.com/enterprises/your-slug
VITE_DEV_PAT=ghp_xxxxxxxxxxxxxxxxx

# .env.acme.local
VITE_DEV_ENTERPRISE_URL=https://github.com/enterprises/acme
VITE_DEV_PAT=ghp_yyyyyyyyyyyyyyyyy
```

Any file matching `.env.<slug>.local` with both vars set will appear under **Switch profile** in the connection menu pill at the top of the app. The `<slug>` becomes the profile name. Selecting one disconnects the current session and reconnects against the new enterprise.

This is wired up by a small Vite dev-server middleware ([`vite.config.ts`](../vite.config.ts) exposes `/__dev_profiles`), so the mechanism **only exists in `npm run dev`**. Production builds never read these files and never expose this endpoint. All `.env*.local` files are gitignored.

The deployed dashboard deliberately doesn't ship an in-app "Add enterprise" UI. PATs live in memory only on the deployed app; persisting them to `localStorage` would expand the XSS blast radius without a strong product justification. If you self-host and want multiple enterprises, this `.env` pattern is the supported workflow.

## API endpoints

All requests go to `{api-base}/enterprises/{ent}/...`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/settings/billing/budgets?per_page=100&page=N` | List every budget (enterprise, cost-center, universal, individual) |
| `GET` | `/copilot/billing/seats?per_page=100&page=N` | Power the Add ULB autocomplete |
| `GET` | `/settings/billing/cost-centers` | Cost-center attribution + budgets tab |
| `PATCH` | `/settings/billing/budgets/{id}` | Update any budget (always with `prevent_further_usage: true` for user-scope) |
| `POST` | `/settings/billing/budgets` | Create a new user-scope budget |
| `DELETE` | `/settings/billing/budgets/{id}` | Remove a user-scope budget |

Header `X-GitHub-Api-Version: 2026-03-10` is set automatically.

## npm scripts

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server on port 5003 |
| `npm run build` | Type-check + production build |
| `npm run typecheck` | `tsc -b` only (fast TS feedback without bundling) |
| `npm run lint` | ESLint (strict, must pass with 0 errors) |
| `npm test` | Vitest, one shot (~1s for full suite) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:changed` | Only re-run tests for files changed since `main` |
| `npm run test:related <file>…` | Only run tests covering the given source files |
| `npm run verify` | typecheck + lint + test in parallel, local pre-PR check |
