# 09 — Svelte Flow spike: is it a replacement?

Status: ready-for-agent

Type: AFK — a spike. The deliverable is an answer with a number, not a merged feature.

## Parent

`kontra/docs/adr/0048-...` · "what this does not decide"

## What to build

Workflows depends on `@xyflow/react` in three files — the workflow canvas. xyflow publishes Svelte
Flow from the same team, which makes it *look* like a port rather than a rewrite. ADR 0048 says that
needs a spike rather than an argument, and this is it.

Rebuild ONE representative piece of the canvas in Svelte Flow — enough to exercise custom nodes,
edges, and whatever the current sketch does that is not stock. Throw it away afterwards. The output
is a written answer in this file's `## Findings`, not a branch to merge.

**Run it in parallel.** Workflows is behind the checkpoint, but whether React Flow has a real
replacement is one of the two biggest unknowns in the estimate, and slice 10 should decide with a
number instead of a guess.

## Acceptance criteria

- [ ] A representative node and edge from the current canvas rebuilt in Svelte Flow
- [ ] A written answer to: does it do what the canvas needs, what is missing, and what would have to
      be hand-built
- [ ] An estimate for porting the canvas, in the same units the completed slices are measured in,
      so slice 10 can compare like with like
- [ ] Bundle cost of Svelte Flow measured against `@xyflow/react`'s current contribution
- [ ] A recommendation: port, replace with something else, or keep Workflows on React

## Blocked by

- `03-type-scale-and-panel-first-shell.md` — the spike should be judged in the real design language,
  not in isolation

## Findings

_(fill in)_
