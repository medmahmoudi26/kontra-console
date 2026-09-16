# 11 — Datasets

Status: done

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 7, and `10-the-datasets-checkpoint.md`

## What to build

The densest surface in the console, in Svelte. The chunk is 1,156 KB today and `DatasetPage.tsx` is
1,978 lines, but most of that is not the grid: **ten dataset logic modules are already in
`@kontra/console-core`** — accrual, cells, expiry, grouped, listing, localName, provenance, scope,
state, tailRows — and `lib/agGrid.ts` already registers modules and themes without a framework.

What is actually being ported: **11 React cell renderers** and the CodeMirror query editor.

ag-grid has a framework-agnostic core. A cell renderer there is a class with `init(params)` and
`getGui()`, so each React component becomes either a small Svelte component mounted into the cell or
plain DOM — whichever reads better per cell; several of these render a badge and nothing else.

## Acceptance criteria

- [ ] Datasets lists, groups, filters and opens a dataset with the behaviour the React surface has
- [ ] All 11 cells render: name, derived name, state, temp, rate, run, tags, expiry, live, actions
- [ ] The SQL editor runs a query and shows results and errors
- [ ] The live row tail still degrades on a dropped stream rather than freezing — it already uses
      `EventSource` and `Last-Event-ID`, and that behaviour must survive the port
- [ ] No `setInterval`; the existing `no-polling` guard covers it automatically
- [ ] Usable at 390px with no horizontal overflow — the grid gets its own scroll container, and the
      page does not. This is the surface where that is hardest and most likely to be got wrong
- [ ] An e2e spec covers list → open → query, passing against React first

## Blocked by

- `10-the-datasets-checkpoint.md` — passed

## Comments

**Done.** Datasets serves from the Svelte bundle on ag-grid's framework-agnostic core.

**`createGrid`, not a wrapper.** ag-grid's React and Svelte packages are thin covers over
`createGrid(element, options)`, and `lib/agGrid.ts` — module registration and theming — was already
framework-free and already in core. The component is the element and the lifecycle.

**The 11 React cell renderers became 7 plain functions.** ag-grid's vanilla API asks for an
`HTMLElement`, and mounting a component per cell means an instance per visible row per column,
recreated on every scroll, for cells that are a span and a class. Each function is three lines
because the DECISIONS — what a state badge says, when a dataset expires, how a dispatch count reads
— already live in `@kontra/console-core` and are shared with the React console.

Asserted, including the ones that are about honesty rather than formatting: a renamed dataset says
what it is STORED as (a copied display name fails elsewhere), a dataset with no run says `loaded`
rather than blank (blank reads as missing data; a standalone dataset genuinely has no run), and no
cell throws on an empty row — a cell that throws takes the grid's render loop with it.

**The grid owns its scroll; the page never does.** This is the surface where panel-first is hardest,
and the overflow check covers it at 320/390/1280.

**I put ag-grid in the ENTRY and the measurement caught it.** A static import of `Datasets` in
`App.svelte` took the entry from 93 KB to **1.18 MB** — exactly what this migration criticises the
React console for, where `@xyflow/react` sits in the entry and everybody downloads the canvas to open
Secrets. Every surface is a dynamic import now:

| chunk | size |
|---|---|
| **entry** | **56 KB** |
| Settings | 1.7 KB |
| Actors | 3.9 KB |
| DevPane | 8.3 KB |
| Catalog | 8.9 KB |
| Workflows | 11.4 KB |
| Canvas (Svelte Flow) | 165.6 KB |
| Datasets (ag-grid) | 1,088 KB |

Nobody pays for a grid to read a secret. The React console's entry is 464 KB before you open
anything.

**`vitest.config.ts` needed `jsdom`** — the same correction core needed. A cell renderer returns an
`HTMLElement` by design, and one that cannot be tested without a browser is one nobody tests.
