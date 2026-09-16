# 09 — Svelte Flow spike: is it a replacement?

Status: done

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

**Recommendation: PORT.** Svelte Flow is a real replacement for this canvas, from the same team, and
the port is a rewrite of components rather than a search for equivalents.

### Does it do what the canvas needs

Every API `WorkflowSketch.tsx` and `ScratchNodes.tsx` actually use has an equivalent. Measured by
inventorying the React imports and checking each against `@xyflow/svelte@1.6.6`:

| used by kontra | in Svelte Flow |
|---|---|
| `ReactFlow` | `SvelteFlow` |
| `ReactFlowProvider` (×4) | `SvelteFlowProvider` |
| `Handle` (×5), `Position` (×5) | same names |
| `NodeProps` (×8) | same name |
| `useUpdateNodeInternals` | same name |
| `nodeTypes` registry | same prop, `NodeTypes` type |

Nothing is missing. The canvas uses a narrow slice — no minimap, no controls, no custom edges, no
resizer — which is why this is a port and not a redesign.

### What it costs

Built a representative node (titled box, typed handles both sides, the shape `ScratchNodes` draws
four variants of) inside a real `SvelteFlow` with two nodes and an edge. It compiles and builds.

| | JS | gzipped |
|---|---|---|
| spike with Svelte Flow | 203.49 KB | 67.80 KB |
| same app without it | 22.70 KB | 9.22 KB |
| **Svelte Flow itself** | **~181 KB** | **~58.6 KB** |

**And a finding that is worth more than the comparison: `@xyflow/react` is in the React console's
ENTRY chunk.** Confirmed by grepping the file `index.html` loads. Everyone downloads the canvas
library to open Secrets. In the Svelte console it would be in the Workflows chunk, which is a
~180 KB improvement to first paint that has nothing to do with which framework is faster.

### What would have to be hand-built

Nothing for parity. Two things to know:

- **Svelte Flow needs `svelte@^5.25.0`**; `@kontra/console-svelte` currently pins `^5.19.0`. A minor
  bump, but it is a prerequisite rather than a detail.
- **Node components become Svelte components**, so the four in `ScratchNodes.tsx` are rewritten —
  about 400 lines. `scratchFlow.ts` (508 lines) is layout and graph logic with no React in it and
  should move to `@kontra/console-core` first, which shrinks the port to the components alone.

### Estimate

**Comparable to slice 06 (Catalog), plus the node rewrites.** The canvas is 2,006 lines across four
files, of which 508 (`scratchFlow.ts`) port unchanged into core and 334 (`workflowSketch.ts`) are
close to it. The genuinely new work is `ScratchNodes.tsx` (404 lines, four components) and the
container in `WorkflowSketch.tsx` (760 lines, most of it not canvas).

The library is not the risk. Workflows is a big surface for reasons unrelated to React Flow.
