# Console: React → Svelte

The decision, its evidence and every rejected alternative live in **ADR 0048** (`kontra`,
`docs/adr/0048-the-console-migrates-to-svelte-one-surface-at-a-time.md`). The vocabulary is
`CONTEXT.md` at this repo's root. This file is the index; the issues are the work.

## Why

Measured 2026-09-16: 453 KB of JavaScript on first paint; twelve files using `setInterval` with the
live surfaces polling at 10–15s; two SSE endpoints in the generated route table that nothing
subscribes to; 273 of 378 type declarations at 10–11px, 336 of them arbitrary values against 48
scale tokens.

## The seven decisions

1. Svelte 5, split at the **route** — two bundles, no interop layer.
2. The 77 framework-free modules become `@kontra/console-core`, extracted **first**.
3. Nothing polls. Every Surface derives from a subscription.
4. **Panel-first**: ~390px is the primary width; wider viewports earn columns.
5. 14px base, 12px hard floor, one scale, tokens only.
6. `/dev` — the IDE embed — is the first Surface.
7. The goal is React deleted, with a **costed checkpoint** at Datasets.

## The slices

| # | Title | Type | Blocked by |
|---|---|---|---|
| 01 | `@kontra/console-core`, extracted and guarded | AFK | — |
| 02 | Two bundles, one login | AFK | 01 |
| 03 | The type scale and the panel-first shell | AFK | 02 |
| 04 | `/dev` derives its form from the contract | AFK | 03 |
| 05 | `/dev` is Live | AFK | 04 |
| 06 | Catalog, and navigation between bundles | AFK | 03 |
| 07 | Actors | AFK | 06 |
| 08 | Secrets and Settings | AFK | 06 |
| 09 | Svelte Flow spike | AFK | 03 |
| 10 | The Datasets checkpoint | HITL | 05, 06, 07, 08, 09 |

Every implementation slice carries its own e2e spec, written against the React surface first so it
passes, then re-run against the Svelte one. ADR 0048 makes the Playwright suite the migration's
contract; folding it into each slice is what stops it being a separate task nobody does.

Workflows, Datasets and Monitor have no issues yet. They are behind the checkpoint, and writing
tickets for work that may not happen is how a backlog stops meaning anything.

## Tooling

Svelte work on these issues should use the official plugin:

    /plugin marketplace add sveltejs/ai-tools
    /plugin install svelte

It provides an MCP server, Svelte 5 skills and a dedicated agent for `.svelte` and `.svelte.ts`
files. Use the agent for those files rather than editing them directly — it is what keeps runes
idiomatic, and Svelte 5's reactivity is the one thing in this migration where the old-framework
habit (stores everywhere, `$:` labels, `onMount` for data) silently produces working code that
throws away the reason for migrating.

The prototype at `prototype/svelte/` predates the plugin and is a sketch, not a reference. Where it
disagrees with the plugin's skills, the plugin wins.
