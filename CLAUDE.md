# kontra-console

## Branches

**Work on `dev`. Never commit to `main`.**

`dev` is the default branch and the base for every pull request. `main` is what has been released —
it moves only by merging `dev`, and only deliberately.

**This repository is PUBLIC**, as is `kontra`; the other four are private. Verified 2026-10-07 by an
unauthenticated `git ls-remote`. So branch protection IS available — rulesets are free on a public
repo, and the sentence that used to stand here (that protection needs GitHub Pro for a private repo)
was wrong about this one. Until a ruleset is configured, this paragraph is still the only enforcement.
If you find yourself on `main`, switch before you commit:

```sh
git switch dev        # or: git switch -c <topic> dev
```

Same two branches, same rule, in all five repositories: `kontra`, `kontra-actors`,
`kontra-workflows`, `kontra-console`, `kontra-cloud`.

## What lives here

The browser console. It depends on `@kontra/core` as `link:../kontra/shared/core` — a **symlink**, so
a sibling checkout named exactly `kontra` must exist beside this one. (`file:` was tried and pnpm
*copies*, which silently serves a stale build.) Build core before trusting a run here.

## Verification

A UI claim needs a browser. `pnpm typecheck` and the vitest suites all pass on a view that throws on
mount, a socket that never connects, and a terminal mounted at 0×0 — and **jsdom has no layout
engine**, so every `clientHeight` is `0` and no layout bug is visible to it. Playwright is the bar
for anything geometric or interactive.
