# 12 — Workflows

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 7

## What to build

Workflows, its runs, and the canvas. Slice 09 costed the canvas and the answer was port: every
React Flow API in use has a Svelte Flow equivalent.

**Do `scratchFlow.ts` first.** 508 lines of layout and graph logic with no React in it; move it to
`@kontra/console-core` before touching components and the port shrinks to the four node components
in `ScratchNodes.tsx`.

**This is where the run stream finally gets consumed.** `/api/runs/:runId/stream` is the second of
the two SSE endpoints that shipped without a consumer; the run view polls today. Wiring it is what
takes the PRD's "SSE endpoints consumed" from 1 of 2 to 2 of 2.

Svelte Flow needs `svelte@^5.25.0`; the package pins `^5.19.0`.

## Acceptance criteria

- [ ] `scratchFlow.ts` is in `@kontra/console-core` and the framework guard still passes
- [ ] The canvas renders, with the four node types and their handles
- [ ] A run opens from its workflow and shows its history
- [ ] The run view derives from `/api/runs/:runId/stream`, not a timer
- [ ] Svelte Flow lands in the Workflows chunk, NOT the entry — the React console has
      `@xyflow/react` in its entry and that is ~180 KB everyone pays to open Secrets
- [ ] Usable at 390px with no horizontal overflow; a canvas gets its own bounded box
- [ ] An e2e spec covers workflow → run → history, passing against React first

## Blocked by

- `11-datasets.md` — not technically, but one heavy surface at a time
