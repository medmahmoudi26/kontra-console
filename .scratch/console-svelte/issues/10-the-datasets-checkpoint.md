# 10 — The Datasets checkpoint

Status: needs-triage

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
