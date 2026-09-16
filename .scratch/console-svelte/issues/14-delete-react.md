# 14 — Delete the React console

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 7

## What to build

The end state ADR 0048 set out: one console.

`SPA_SURFACES` empties, the second document goes, `svelte.html` becomes `index.html`, and the React
app, its 71 components and its seven React-coupled dependencies leave.

**`@kontra/console-core` stays.** It is not a migration artifact — it is the boundary between what
the console KNOWS and what it DRAWS, and the framework guard stays with it. Collapsing it back into
the app would undo the one structural improvement this migration made that has nothing to do with
Svelte.

**Delete `/_svelte`** — the walking skeleton from slice 02 — and check the overflow script still has
routes, since it reads them from the allowlist and an empty list is a failure by design.

## Acceptance criteria

- [ ] Every surface serves from one bundle; `SVELTE_SURFACES` is the only set, or the split is
      removed entirely and the fallback is simple again
- [ ] The React app, its dependencies and its 30 render tests are gone; the logic tests stay
- [ ] `spaFallback.test.ts` still pins the console's declarations against the server's, with
      whatever shape the single bundle takes
- [ ] The e2e suite passes unchanged — it is the only evidence behaviour survived, and it should not
      need editing to pass
- [ ] The eager bundle is measured and recorded against the 472 KB this started at
- [ ] `/_svelte` is gone and the overflow check still covers every route

## Blocked by

- `13-monitor.md`
