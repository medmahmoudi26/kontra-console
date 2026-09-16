# 12 — Workflows

Status: in-progress

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

## Comments

**The timeline is in, and it is derived from real history rather than simulated.**
`@kontra/console-core/run/timeline` turns `RunEvent[]` into lanes and bars; 11 tests.

**A bar is an event that CLOSES something.** `RunEvent.dur` is already "seconds this event closes",
so a bar is `[t - dur, t]` and nothing here re-pairs a `Scheduled` with its `Completed` — the server
did that, and a second reconstruction is a second set of edge cases.

**`dur === 0` is a MOMENT, not a one-pixel bar.** A timer fired at t=3 drawn as a bar looks like
three seconds of work. They get a tick row under the lanes.

**Lanes group by what an event is ABOUT, not by `cat`.** Grouping by category gives four lanes for
any run, which says nothing about one with forty dispatches. The linked workflow id where there is
one — that is exactly the set of rows that are navigable — and the detail's subject otherwise.

**Open work is derived by subtraction.** A `Scheduled` with no closing event IS still running, so it
draws open-ended to now. That is the row somebody opening this page is looking for, and the
screenshot shows it: `redditapi/n4` running off the right edge while everything else has closed.

**A retry reads correctly**: `webcrawl/n3` shows a red failed bar and its green retry side by side
in one lane, which is the thing a percentage cannot say.

Also fixed: the last gridline was drawn at 97% and its label clipped to `15` where the axis meant
`15s` — a truncated number is worse than none, so a tick that crowds the edge is dropped.

**Still to do for this slice:** the run list is not yet subscribed to `/api/runs/:runId/stream` — the
second unconsumed SSE endpoint — and the canvas (Svelte Flow) is not ported.
