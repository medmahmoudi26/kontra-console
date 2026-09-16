# 06 — Catalog, and navigation between bundles

Status: done

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

## Comments

**Done.** `catalog` serves from the Svelte bundle, `workflows` and the rest from React — verified
against the real build. Bundle 61.66 KB (23.46 gzipped). Overflow clean on three routes at
320/390/1280.

**The nav is pinned to the orchestrator.** `surfaces.test.ts` reads `SPA_SURFACES` and
`SVELTE_SURFACES` out of `server.ts` and fails if the nav claims a surface the server serves from the
other bundle. That failure has no error and no 404: it is a link that navigates to itself and renders
the other console. The test failed correctly the first time — I declared `catalog` as Svelte before
moving it server-side.

**Moving a surface is moving a string, and TWO tests had hardcoded which set.** Both went red on a
successful migration step: one asserted `SPA_SURFACES.has('catalog')` and one asserted
`SPA_SURFACES.size === 9`. They now assert what should actually hold across the whole migration —
every surface is owned by exactly one bundle, and the TOTAL is nine. A surface may move; it may not
vanish from both.

**The filter is built from `NO_FILTER`, not a literal.** `CatalogFilter` carries four fields and the
three this surface does not offer yet have meaning — empty `states` means EVERY state, not none — so
`{ q }` alone would have compiled into a search that silently excluded things.

**`name` and `target` stay separate.** A workflow's surface selects by folder name while its
registered type is `DnsSweep` where the directory is `dns_sweep`; opening the display name navigates
to a workflow that does not exist.

**A failed part is empty, not fatal.** The Catalog is a join across seven endpoints and no single one
answers it. A control plane missing `/api/pollers` still gets a catalog that cannot say what is
serving, and the page says how many endpoints it could not read rather than presenting a partial
list as complete.
