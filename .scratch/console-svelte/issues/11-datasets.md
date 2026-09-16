# 11 — Datasets

Status: ready-for-agent

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
