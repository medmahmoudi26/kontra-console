# PRD — the kontra console, rebuilt in Svelte

Status: **all 14 slices done, 2026-09-16.** One bundle; React deleted. What is not ported is in §9.
· ADR: `kontra/docs/adr/0048-the-console-migrates-to-svelte-one-surface-at-a-time.md`
· Glossary: `CONTEXT.md` at this repo's root

---

## 1. The problem, measured

The console is the only surface most people ever see of kontra, and it is slower and coarser than
the tools it is compared to. Four numbers, taken from the built output and the source on 2026-09-16:

| | measured | what it means |
|---|---|---|
| First paint | **453 KB** of JS (6.2 MB across 60+ chunks) | code splitting works; the entry does not |
| Freshness | **12 files** use `setInterval`; live surfaces poll at **10–15s** | the UI is stale, then jumps |
| Streams | **2 SSE endpoints** exist, **0** are consumed | the server already pushes; nothing listens |
| Type | **273 of 378** declarations at 10–11px, **27** at 9px; **336** arbitrary vs **48** scale tokens | no scale, and unreadable in a panel |

The third is the sharpest. `kontra serve --watch` re-registers an Actor's contract on every save and
`/api/sources/actor/{id}/schema/stream` publishes it — the machinery for "the form tracks your
editor" is built, shipped, and has never had a consumer.

**The polling is what people feel.** A surface that is stale for fifteen seconds and then jumps
reads as slow regardless of how fast it renders.

## 2. Who this is for

- **The operator at a desk.** Runs workflows, reads runs, queries datasets. Has a 27-inch screen and
  wants density. Today's primary user, and the only one the current console was designed for.
- **The author in an editor.** Writing an Actor in VS Code with the runner pane open beside it. The
  pane is ~400px wide and full of 10px type. **Today they are the worst-served user of the console,
  and they are the one writing the code kontra exists to run.**
- **The operator on a phone.** Checking whether a run finished, from somewhere else. Cannot use the
  console today in any meaningful way.

The second and third want the same thing: a console that works at ~390px. That is one requirement,
not two.

## 3. Goals

1. **A console that is legible in a 400px panel and on a phone** without giving up the desk.
2. **Live, not polled.** Every surface derives from a subscription; `setInterval` is not used for
   data.
3. **Reactive to the operator's code at runtime.** Edit an Actor, save, and an open form changes.
4. **A smaller entry bundle**, as a consequence of the framework rather than as a project.
5. **One brain.** Both consoles derive run state, schemas and addresses from the same code, so they
   cannot disagree about what a Run is.

### Non-goals

- Redesigning what the surfaces *do*. This is the same console, rebuilt.
- The run-as-timeline view. Prototyped alongside, decided separately.
- Replacing ag-grid or CodeMirror. Port or keep; not this project's question.
- Supporting both frameworks forever. That is an outcome the checkpoint may choose, not a goal.

## 4. Requirements

### R1 — Route-level split, no interop
Two SPA bundles served by the orchestrator; a migrated Surface's first path segment resolves to the
Svelte bundle. No Svelte component is mounted inside React and no React component inside Svelte.
Navigation between bundles is a full page load and must not look like a failure.

### R2 — `@kontra/console-core`, framework-free, enforced
The shared half is a package with a build-failing guard. **Done** — 77 modules, 60 tests, guard
proven against five patterns including an empty walk.

### R3 — Panel-first
~390px is the primary width. Wider viewports earn columns. Zero horizontal overflow at 320, 390 and
1280px on every route, asserted by a headless browser in CI, and the assertion fails if a route is
added without coverage.

### R4 — One scale, 14px base, 12px floor
Sizes come from tokens; an arbitrary size at a call site fails the build. Nothing a person reads
below 12px. 11px permitted only for uppercase micro-labels.

### R5 — Live by subscription
No `setInterval` for data. A dropped stream degrades visibly and reconnects; it does not freeze on
stale values while presenting them as current.

### R6 — One login
A session established on either bundle is valid on the other. ADR 0045 is what makes this possible;
a bundle that authenticated separately would put the split where a user feels it.

### R7 — The e2e suite is the contract
Each surface slice carries a Playwright spec written against the React surface **first** — so it
passes before the port — then re-run against the Svelte one. A spec that cannot tell which framework
is underneath is the only evidence that behaviour survived.

## 5. Success criteria

| | at the start | target | now |
|---|---|---|---|
| Entry JS | 472 KB | < 150 KB | **60.9 KB** (23.6 gzipped) |
| Built output, all chunks | 6.2 MB | — | **1.8 MB** |
| `setInterval` calls for data | 12 files | 0 | **0**, guarded |
| SSE endpoints consumed | 0 of 2 | 2 of 2 | **2 of 2** |
| Horizontal overflow at 390px | untested | 0px, asserted in CI | **0px**, 10 routes × 3 widths |
| Smallest type a person reads | 9px | 12px | **12px**, guarded |
| Time from `actor.py` save to form update | ∞ (refresh) | < 2s, no refresh | **no refresh** |
| Playwright specs | 19 passing | 19 passing | **19 passing**, one assertion scoped |

## 6. Plan — all of it done

`01` core extraction → `02` two bundles → `03` scale and shell → `04` `/dev` form → `05` `/dev` live
→ `06` Catalog → `07` Actors → `08` Secrets and Settings → `09` Svelte Flow spike → `10` the
checkpoint (CONTINUE) → `11` Datasets → `12` Workflows → `13` Monitor → `14` delete React.

## 7. Risks

**The grid is uncosted and it is the biggest number in the estimate.** `DatasetPage.tsx` holds 11
React cell renderers, the 1.2 MB chunk, ag-grid and CodeMirror. Choosing `/dev` first means that
stays unknown longer — deliberately, and slice 10 is where the debt is paid. *Mitigation: slice 09
runs in parallel so the checkpoint has at least one of the two unknowns costed.*

**Two shells drift.** For the length of the migration the nav, the theme and the session exist
twice. *Mitigation: anything with logic in it belongs in core, where there is one copy.*

**Density loss is real and is the trade.** R4 costs rows per screen. Anyone expecting today's counts
will find fewer. *Mitigation: say so before it ships, not after.*

**The migration stalls half-done.** The most likely bad outcome is not failure but abandonment with
four surfaces in each framework. *Mitigation: slice 10 makes "stop" an explicit, recordable choice
with a cost attached — an arrangement rather than an accident.*

## 8. Tooling

    /plugin marketplace add sveltejs/ai-tools
    /plugin install svelte

MCP server, Svelte 5 skills, and an agent for `.svelte` / `.svelte.ts` files. Use the agent for those
files. Svelte 5's reactivity is the one place where old-framework habits — stores everywhere, `$:`
labels, `onMount` for data — produce working code that throws away the reason for migrating.

The prototype at `prototype/svelte/` predates the plugin and is a sketch, not a reference. Where it
disagrees with the plugin's skills, the plugin wins.

## 9. What is not ported, and what that means

The seven surfaces exist and the console is usable end to end: sign in, find an Actor, call a Method
from a form derived from its contract (with real file and folder uploads), start a workflow, watch
its run as a timeline, read a dataset, watch a fleet's terminals.

**It is not yet everything the React console did.** 49 of 80 framework-free modules in
`@kontra/console-core` are unreachable from the app. Kept, not deleted: each is the derivation a port
needs, already tested, framework-free. The largest missing pieces, in the order they will be missed:

1. **The dataset SQL workbench** (`run/query`, `datasets/cells`) — query a Dataset from the console.
2. **Calling a Method from Actors** (`panels/methodCall`) — `/dev` can do it; the Actors surface
   cannot.
3. **The workflow thread and turn drill** (`panels/workflowThread`, `panels/transcriptDrill`,
   `panels/ask`) — including HITL asks, which have no other surface.
4. **Per-run machines and datasets** (`panels/runMachines`, `panels/runDatasets`, `panels/runStats`).
5. **The draggable tile wall and its chrome** (`panels/grid/wall`, `panels/chrome/*`) — the Monitor
   is a responsive grid today, not a wall an operator arranges.
6. **The folder workbench** (`panels/folderWorkbench`) — editing an actor's files in the console.

The lesson worth keeping from slice 14: each of those surfaces passed review, passed its unit tests
and passed a browser suite while missing capabilities the surface it replaced had — because the
browser suite was driving the OLD app. A port is finished when the test that proves it is pointed at
the new thing.
