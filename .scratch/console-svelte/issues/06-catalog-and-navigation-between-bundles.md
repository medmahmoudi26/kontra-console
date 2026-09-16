# 06 — Catalog, and navigation between bundles

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decisions 1 and 6

## What to build

The first full Surface in Svelte, which means the first one with navigation — and navigation is
where the route split has its sharp edge.

Catalog is the whole registry: every workflow you can run and every actor you can call a Method on,
in one searchable list. No React-only dependency.

**Navigating OUT is the risk, not navigating in.** A link from Svelte Catalog to React Datasets is a
full page load, and it must not look like a failure: no flash of an empty shell, no lost session, no
scroll position surprise. The nav renders the same seven Surfaces whichever bundle drew it, so a
person cannot tell which one they are on except by its speed.

Both bundles now declare surfaces, and both must stay in step with the orchestrator's split
`SPA_SURFACES` — the drift failure from 02, now with two ways to happen.

## Acceptance criteria

- [ ] Catalog lists every registered workflow and actor, searchable, and opens each one
- [ ] The nav shows all seven Surfaces from the Svelte bundle and navigates to React ones correctly
- [ ] A cold load of a Svelte Surface and of a React Surface both work; neither 404s
- [ ] The session survives navigation in both directions with no re-authentication
- [ ] A Surface added to one bundle and not the orchestrator's allowlist FAILS a test rather than
      404ing at runtime
- [ ] Usable at 390px with no horizontal overflow, per 03
- [ ] An e2e spec covers Catalog and a cross-bundle navigation, passing against React first

## Blocked by

- `03-type-scale-and-panel-first-shell.md`
