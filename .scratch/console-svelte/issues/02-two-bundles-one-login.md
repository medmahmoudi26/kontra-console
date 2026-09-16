# 02 — Two bundles, one login

Status: done

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

## Comments

**Done.** `@kontra/console-svelte` builds to `dist/svelte.html` + `dist/assets/svelte-*.js`
(**30.87 KB**, 11.99 KB gzipped, against React's 472 KB entry). Verified against the REAL build, not
a fixture: `/_svelte` → `svelte.html`, `/catalog/an.id.with.dots` → `index.html`, a deleted chunk
still 404s, an unknown API route still 404s as JSON.

**Two documents, one directory, two rules.** Both bundles share `dist/`, so the Svelte one is
`svelte.html` — `index.html` has an owner — and it builds with `emptyOutDir: false` AFTER the React
build, or it deletes the console. The order lives in the root `build` script because a build tool
cannot enforce the order of two builds it does not run. A `base: '/s/'` was the first attempt and it
only moved the URLs, not the files; vite's hashes already keep the two asset sets apart.

**`SVELTE_SURFACES` and `SVELTE_ROUTES`, plus a boot guard.** The new failure the split creates is a
segment in BOTH sets — which serves whichever `if` runs first, a coin flip decided by source order.
`assertBundlesAreDisjoint` throws at boot, and the test proves it by passing overlapping sets, not
by observing that today's are fine.

**`/_svelte` is a real route on purpose.** With both sets empty, every Svelte assertion in
`spaFallback.test.ts` iterated nothing and passed — a suite proving the split works without ever
having served the second document. The skeleton route makes them real and goes when `/dev` moves in
slice 04.

**The fixture needed the second document too.** It wrote only `index.html`, so the first honest run
404'd and read as a routing bug rather than a missing file. Both documents now carry a
`data-bundle` marker, because asserting on the substring `svelte` also matches a filename.

**One login is not yet proven end to end.** `/api/health` is open, so a 200 shows reachability and
not identity; `session.ts` says so rather than claiming more. Slice 06 is the first surface that
needs a real session and is where that gets asserted.

Unrelated: 14 orchestrator tests fail on this box with `EMFILE: too many open files`, and none of
the four files imports from `server.ts`.
