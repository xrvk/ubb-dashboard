# Tone and voice

This repo has a consistent voice. Match it. The shorter the surface
(toast, badge, button), the more these rules matter.

## UI copy

**Plainspoken, specific, no jargon.** Customers reading this are
enterprise admins who already know "Copilot," "seats," and "budgets."
They don't need product marketing copy.

- ✅ `Unblock 47 users for the month`
- ❌ `Unleash your team's productivity`
- ✅ `$22.5k / $30k MTD`
- ❌ `You're tracking favorably toward your enterprise allocation`
- ✅ `Cost center is over budget`
- ❌ `Action required: spending threshold exceeded`

**Numbers are honest.** Use the adaptive `formatCurrency` everywhere
(`$550`, `$5.53k`, `$225k`, `$1.30M`). Don't show fake precision
(`$22,500.00`); don't drop important precision (`$22k` when `$22.5k`
fits in the same width).

**No em-dashes in UI prose.** They look fine in long-form docs (and
this file uses them freely) but they're noisy in dense dashboard copy.
Use a period or a colon instead. Commit `3503184` enforced this across
the dashboard.

**No cents in MTD / forecast / budget displays.** Drop to whole
dollars unless sub-$1 is meaningful (the formatter handles this
automatically).

**Section headers are nouns, not numbered steps.** `AI Credit Pool &
Licenses`, not `01 — Pool and licenses`. Commit `9ca2fac` dropped the
numbering.

## Status language

We have four buckets: **low / nearing / at / over**. Stick to those.
Don't invent new ones (no "approaching," no "exceeded," no "warning").

- **low** — well under budget
- **nearing** — close to cap, not over
- **at** — at or just over (≥100%)
- **over** — meaningfully past cap

## Palette (sepia)

The light-mode theme is warm sepia. Allowed colors:

- **Amber** 50/100/200/500/700/900/950 — secondary accents, promo,
  bronze (`amber-700` = `#b45309`).
- **Emerald** 300/500/600/700/800/900 — primary brand, healthy state,
  "good" signals.
- **Red** 300/500/700 — error / over-budget only. Sparingly.
- **Neutral / stone** — text, borders, surfaces.

**Not allowed:** sky, blue, green-500, orange-500, yellow-500, sky-500.
If a chart needs more colors, pick another shade of amber or emerald.
The histogram bucket scale uses `#059669` → `#b45309` for the
emerald → bronze ramp — match that pattern.

## Dialogs & destructive actions

- Confirm before mutating. `BulkUnblockDialog`, `RevertBulkDialog`,
  `DeleteConfirmDialog`, `EditBudgetDialog` are the pattern.
- Show the exact count and the exact new cap. Never say "several users."
- Bulk operations show partial-failure results when they happen. Don't
  silently swallow per-user errors.

## Commit messages

- **Imperative mood, sentence case.** `Fix CC bullet alignment`, not
  `Fixed CC bullet alignment` or `fixing CC bullet alignment`.
- **First line ≤ 72 chars.** Body wrapped at 72.
- **Body explains *why* + *what changes for the user*.** Not a diff
  summary.
- **Co-author trailer required** when an agent contributes:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- Browse `git log --oneline` for examples. The repo's style is short,
  specific, and often references the visible UI change ("CC bullet: …",
  "Pool tile: …").

## PR bodies

- Lead with the user-visible change, not the implementation.
- Group changes under H2 / H3 headers when the PR touches multiple
  surfaces (this repo does big polish PRs occasionally — see PR #23).
- Always include a **Test plan** section: what tests / typecheck /
  manual checks you ran.
- Don't ping reviewers or @-mention CODEOWNERS proactively.

## Toasts & inline feedback

- One sentence. No exclamation marks.
- ✅ `Universal UBB set to $7.00k`
- ✅ `Unblocked 47 users for the month`
- ❌ `🎉 Success! 47 users have been unblocked!`

## Docs

This folder (`docs/agents/`) is the exception that proves the rules.
Long-form, em-dashes welcome, tables encouraged, explicit examples for
every claim. The audience is another agent (or a developer) who needs
to ramp fast.

## Disclaimer language

This tool is **independent**, not a GitHub product. Any new doc or UI
surface that could be confused for official guidance must reinforce
that. The top-level `README.md` has the canonical wording — copy it,
don't paraphrase it.
