# PRD — the kontra console, rebuilt in Svelte

Status: approved · ADR: `kontra/docs/adr/0048-the-console-migrates-to-svelte-one-surface-at-a-time.md`
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

| | today | target |
|---|---|---|
| Entry JS on a migrated surface | 472 KB | **< 150 KB** |
| `setInterval` calls for data | 12 files | **0** |
| SSE endpoints consumed | 0 of 2 | **2 of 2** |
| Horizontal overflow at 390px | untested | **0px, asserted in CI** |
| Smallest type a person reads | 9px | **12px** |
| Time from `actor.py` save to form update | ∞ (refresh) | **< 2s, no refresh** |

## 6. Plan

Ten slices, in `issues/`. Nine are agent-ready; one is a decision.

`01` core extraction → `02` two bundles → `03` scale and shell → `04` `/dev` form → `05` `/dev` live
→ `06` Catalog → `07` Actors → `08` Secrets and Settings, with `09` (Svelte Flow spike) in parallel
and `10` the checkpoint.

**Workflows, Datasets and Monitor have no issues.** They are behind the checkpoint, and writing
tickets for work that may not happen is how a backlog stops meaning anything.

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
