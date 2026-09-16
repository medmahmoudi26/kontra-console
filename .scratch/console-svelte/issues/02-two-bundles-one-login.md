# 02 — Two bundles, one login

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 1

## What to build

The walking skeleton. The orchestrator serves a SECOND SPA bundle, and one deliberately plain Svelte
route renders from it while every existing surface keeps coming from React.

The page should be ugly on purpose. This slice proves the plumbing — build, serve, route, session —
and a designed page here would make a failure ambiguous between the two.

**The seam is `SPA_SURFACES` in the orchestrator's `server.ts`.** It is a first-segment allowlist
that already carries a comment about being a hand-copy of the console's own list, pinned by
`spaFallback.test.ts` because the drift failure is a cold load 404 on a surface that exists. It
becomes two sets, and the pinning has to cover both — the same failure, now available twice.

**One login, not two.** ADR 0045 has the console signing in for a session token. A second bundle
that authenticated separately would put the split exactly where a user would feel it.

## Acceptance criteria

- [ ] A Svelte bundle is built, served by the orchestrator, and reachable at its own first-segment route
- [ ] A cold load of that route (F5, not a client-side navigation) returns the Svelte `index.html`
- [ ] A missing asset under either bundle still 404s — it must NOT fall through to an `index.html`,
      which is the failure the existing handler's comment describes
- [ ] `spaFallback.test.ts` pins BOTH sets against the console's declarations, and fails if either drifts
- [ ] A session established on a React surface is already valid on the Svelte route — no second sign-in
- [ ] The appliance's release bundles both SPAs, and `kontra up` serves both from the hydrated artifact

## Blocked by

- `01-console-core-extracted-and-guarded.md`
