# 14 — Delete the React console

Status: done — 2026-09-16

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

- [x] Every surface serves from one bundle. The split is removed: `SPA_SURFACES` is the single list
      again, `SVELTE_SURFACES` and `assertBundlesAreDisjoint` are gone, and the fallback is one `if`
- [x] The React app (160 files), its 13 dependencies and its render tests are gone; the logic tests
      stay in `@kontra/console-core` — 1,117 of them, passing
- [x] `spaFallback.test.ts` pins the console's declarations against the server's, for one bundle
- [~] The e2e suite passes — 19 of 19, with ONE assertion scoped. `dashboard.spec.ts` searched the
      whole page for the word `snapshots`; the React console pinned one Terminal and the Monitor is
      a wall of four, so the search is scoped to the tile under test. The same file's spec at 230
      anticipated exactly this ("the day the wall arrives, this starts proving itself") and now
      passes on its own terms. Recorded rather than quietly edited
- [x] The eager bundle is **60.9 KB** against the 472 KB this started at; all chunks 1.8 MB from
      6.2 MB
- [x] `/_svelte` is gone; the overflow check covers 10 routes × 3 widths — and it had SHRUNK TO ONE
      ROUTE silently, because it read the now-deleted `SVELTE_SURFACES` and `grab()` answers `[]`
      for a name it cannot find. Its "empty list is a failure" guard did not fire, since one is not
      zero. It now reads the live list and refuses fewer than eight

## What the deletion found

Three capabilities had shipped as surfaces without being replacements, and only removing React
surfaced them. Each is now built:

- **the Monitor had no terminals** — a list of names, no xterm, no socket, no converge, behind a
  comment claiming the opposite. `/monitor` already served Svelte, so the wall was dark in the
  product from the day slice 13 shipped
- **Workflows could not start a run** — the console's primary act was unreachable
- **nothing signed in** — `session.install()` was never called and there was no gate, so every API
  call went unauthenticated (ADR 0045)

Plus one live regression fixed on the way: `/runs/<id>` and `/scratch` had no redirect in the Svelte
shell, so every link anybody had pasted would have landed on an empty page.

## What is still NOT ported

49 of 80 framework-free modules in `@kontra/console-core` are unreachable from the console — the
dataset SQL workbench, calling a Method from Actors, the workflow thread and turn drill, per-run
machine and dataset views, the draggable tile wall and its menus, the folder workbench, widgets,
HITL asks. They are kept because each is the derivation a port needs. See ADR 0048's Outcome.

## Blocked by

- `13-monitor.md`
