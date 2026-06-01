# Contributing

Thanks for considering a contribution!

## Quick start

```bash
git clone https://github.com/xrvk/ubb-dashboard.git
cd ubb-dashboard
npm install
npm run dev   # localhost:5003
```

## What we welcome

- Bug fixes
- UX polish, accessibility improvements
- Tests for edge cases (projection math, batch runner, status classifier)
- Documentation tweaks

## Local checks

Before opening a PR, please make sure these pass:

```bash
npm run lint
npm test
npm run build
```

CI runs the same three on every push.

## Style notes

- No new dependencies without a strong reason (the app is intentionally lean).
- shadcn-style components live in `src/components/ui/`. Don't modify them in feature components — wrap them.
- All numeric inputs go through the shared `<Input>` (which strips native spinner arrows and the scroll-wheel value change).
- Pure logic belongs in `src/lib/` with unit tests in `src/__tests__/`. Components stay thin.
- Tailwind utility classes only. Semantic color tokens (`text-emerald-700`, `text-amber-600`, etc.) come from a small palette: emerald (success/selected), amber (warning), red (over/destructive), neutral (everything else).

## Things to avoid

- Persisting credentials anywhere (localStorage, sessionStorage, cookies).
- Adding analytics, telemetry, or third-party scripts.
- Adding blue, purple, pink, or any color not already in the palette above.
- Bypassing the rate-limit-aware batch runner for bulk mutations.
