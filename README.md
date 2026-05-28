# Individual ULB Dashboard

A standalone, single-purpose dashboard to monitor and manage **per-user Copilot AI Credits budgets** (individual ULBs) across a GitHub Enterprise.

> Sibling tool to the Copilot Budget Command Center. This app focuses on one thing: surfacing every individual ULB, who's over, who's near, and letting admins fix it in one click.

## What it shows

- **Summary cards**: users with an ULB, # over budget, # near limit (>=80%), total consumed, total budgeted.
- **Top consumers chart**: top 10 users by `consumed_amount`, colored by status.
- **Budgets table**: sortable on every column, search by username, filter chips (All / Over / Near / OK), per-row edit and delete.
- **Add ULB**: create a new per-user budget. Hard stop (`prevent_further_usage: true`) is always on.

## Stack

- React 19 + Vite + TypeScript
- Tailwind v4 + minimal shadcn-style components
- Recharts, Phosphor Icons, next-themes, sonner
- Vitest

## Setup

```bash
npm install
npm run dev    # http://localhost:5003
```

Optional: create `.env.local` to pre-fill the Import panel and auto-connect:

```
VITE_DEV_ENTERPRISE_URL=https://your-host/enterprises/your-slug
VITE_DEV_PAT=ghp_xxxxxxxxxxxxxxxxx
```

The PAT needs the **manage_billing:enterprise** scope.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server on port 5003 |
| `npm run build` | Type-check + production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest (one shot) |
| `npm run test:watch` | Vitest watch |

## API endpoints used

All against `{api-base}/enterprises/{ent}/settings/billing/budgets`:

| Method | Purpose |
|---|---|
| GET | List all budgets, filtered client-side to `budget_scope === 'user'` + `ai_credits` |
| PATCH `/budgets/{id}` | Update `budget_amount` (hard stop forced on) |
| POST `/budgets` | Create user-scope budget |
| DELETE `/budgets/{id}` | Delete |

Sends header `X-GitHub-Api-Version: 2026-03-10`.

## Privacy

Credentials live in React state only. They are never persisted to localStorage or sent anywhere except your enterprise's API host.
