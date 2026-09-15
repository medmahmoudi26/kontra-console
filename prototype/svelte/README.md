# kontra console — Svelte prototype

Three surfaces and a live run timeline, in Svelte 5. A proposal, not a migration.

    pnpm install && pnpm dev

`pnpm build` emits `dist/`; the repo's build step also inlines it to a single
`dist/standalone.html` that opens from disk with no server.

## What it is for

Two questions, and it exists to answer them with something you can click rather than argue about.

**Does a Temporal-style timeline read well for a kontra Run?** One lane per stage
(`actor/node`), one bar per Unit, a playhead that sweeps. A progress bar sits above it for the
across-the-room glance, but the lanes answer what a percentage cannot: that a node started late,
that one Unit is running six times as long as its neighbours, that the failure happened early and
everything after it was wasted. One Unit fails on purpose — a timeline where everything is green
teaches nothing about whether a failure is legible.

**What does Svelte buy here?** 61 KB of JS, 23 KB gzipped, against the React console's 453 KB
eager. Not a fair comparison — this is three pages against thirty, without ag-grid, CodeMirror or
React Flow — but the runtime contribution is ~0, and that part does scale.

## The data is mocked, and shaped like the API

`src/lib/model.svelte.js` names every field for the endpoint that returns it — `/api/runs`,
`/api/runs/:id/history`, `/api/actors`. Swapping `seed()` for `fetch()` is the whole of the work.

It also runs a clock. A timeline of finished work answers nothing; the interesting part is a bar
still growing while you look at it, so `tick()` advances a run in real time and every view is
derived from it. One `requestAnimationFrame` for the whole app — a Unit finishing writes two fields
and re-renders one bar, which is the thing this prototype is arguing for.

## Verified rather than asserted

Overflow measured with a headless browser at 320px, 390px and 1280px across all three pages: zero
horizontal scroll. That check found four real bugs the desktop view hid — an event log whose rows
overlapped their own text, a table that widened the page instead of scrolling inside its card, a
nav that pushed the document sideways, and 132px of a 390px screen spent on lane labels.

## What it is not

No routing, no auth, no error states, no empty states, no accessibility audit beyond focus rings
and reduced-motion. The React console remains the product.
