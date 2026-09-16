# 10 — The Datasets checkpoint

Status: done

Type: **HITL** — this is the decision the whole plan is gated on. An agent gathers the numbers; a
person makes the call.

## Parent

`kontra/docs/adr/0048-...` · decision 7

## What to build

Not code. A decision, made with evidence, at the last moment where the evidence exists and the money
has not been spent.

ADR 0048 chose `/dev` first over Datasets first, deliberately — and named the cost of that choice:
the expensive Surface stays uncosted for longer. This is where that debt is paid.

**What makes Datasets expensive**, measured 2026-09-16: `DatasetPage.tsx` holds **11 React cell
renderers** (`DatasetNameCell`, `DatasetStateCell`, `DatasetTagsCell`, `DatasetExpiryCell`,
`DatasetActionsCell` and six more), it is the 1.2 MB chunk, and it uses CodeMirror as well as
ag-grid. `lib/agGrid.ts` already isolates the module registration and theming and is framework-free,
so the setup ports as-is; the 11 renderers are the work.

## What to gather first

- What slices 04–08 actually took, in whatever unit the team measures
- Slice 09's answer on Svelte Flow
- A costed estimate for the 11 cell renderers on ag-grid's vanilla core, and for CodeMirror

## The decision

One of:

- **Continue** — port Datasets, then Workflows and Monitor, then delete React
- **Stop here** — Svelte keeps the embed and the light Surfaces, React keeps the dense ones
  permanently, and `@kontra/console-core` stays framework-free forever as a supported arrangement
  rather than a transitional one
- **Continue with a changed plan** — e.g. replace the grid rather than port it

Whichever it is, record it. A gate that is passed silently is a gate that was not there.

## Acceptance criteria

- [ ] Actuals for 04–08 written down
- [ ] Slice 09's recommendation recorded
- [ ] A costed estimate for the Datasets port
- [ ] A decision, with its reasoning, appended here — and if it is anything other than "continue",
      ADR 0048 gets a superseding note rather than being quietly left wrong

## Blocked by

- `05-dev-is-live.md`
- `06-catalog-and-navigation-between-bundles.md`
- `07-actors.md`
- `08-secrets-and-settings.md`
- `09-svelte-flow-spike.md`

## The numbers, gathered

Slices 01–09 are done. This is what they cost and what is left, measured rather than estimated.
**The decision below is not made.**

### What the five migrated surfaces took

| | |
|---|---|
| Surfaces migrated | `/dev`, Catalog, Actors, Secrets, Settings — **5 of 7** |
| Svelte source | 19 files, ~1,029 lines of component |
| Svelte bundle, all five | **69.2 KB** (26.4 gzipped) |
| React entry, still | **426 KB** |
| Core extracted | 77 modules, 60 tests, framework-free and guarded |
| Guards added | no-framework, type-scale, no-polling, overflow — each proven by breaking it |

### What is left

Three surfaces, and they are the three with a library problem.

**Datasets** — `DatasetPage.tsx` is **1,978 lines** with **11 React cell renderers**, and its chunk
is **1,156 KB**, the largest in the console. ag-grid's setup already lives in a framework-free
`lib/agGrid.ts`, and **10 dataset logic modules are already in `@kontra/console-core`**, so the port
is the renderers plus CodeMirror — not the grid's behaviour.

**Workflows** — slice 09 answered this: Svelte Flow is a real replacement, ~181 KB, every needed API
present, and `scratchFlow.ts` (508 lines) ports into core unchanged first. The canvas is not the
risk; the surface is large for other reasons.

**Monitor** — terminals and markdown, not spiked.

### The thing the migration already bought, independent of finishing

`@xyflow/react` is in the React console's **entry chunk** — everybody downloads the workflow canvas
to open Secrets. Five surfaces now bypass that entirely. Whatever is decided below, that is banked.

### Three options, unchanged

- **Continue** — Datasets, then Workflows and Monitor, then delete React.
- **Stop here** — Svelte keeps five surfaces, React keeps three, `@kontra/console-core` stays
  framework-free permanently as a supported arrangement rather than a transitional one. Note this is
  now a *stable* split: the three React surfaces are exactly the three with heavy libraries.
- **Continue with a changed plan** — e.g. replace the grid rather than port it.

### What to record

Whichever is chosen, write it here with its reasoning, and if it is not "continue", ADR 0048 gets a
superseding note rather than being quietly left wrong.

## The decision

**CONTINUE.** Port Datasets, then Workflows and Monitor, then delete React. Recorded 2026-09-16.

The gate did its job: it was passed with numbers rather than momentum. What the numbers said —

- **The remainder is smaller than it looked.** Ten dataset logic modules are already in
  `@kontra/console-core` and ag-grid's setup is already framework-free, so Datasets is 11 cell
  renderers and CodeMirror, not a grid rewrite.
- **Svelte Flow is a real replacement** (slice 09), with every needed API and ~181 KB.
- **Five surfaces cost 69.2 KB against a 426 KB entry**, which is the ratio the remaining three
  would also get.

ADR 0048 stands unamended: decision 7 said the goal is React deleted with a costed checkpoint, and
this is that checkpoint answering yes.

Issues `11`–`14` carry the rest.
