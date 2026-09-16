# 07 — Actors

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 6

## What to build

The Actors Surface in Svelte. What is deployed, what is polling it, and what each Method takes.

**Pollers are the column that matters.** An Actor with no poller is not broken and not missing — it
is registered and nothing is serving it, so a dispatch waits rather than failing. That is a state to
render as a state, not a health dot, because it is the thing that explains a run which looks hung.

`isServing` is the authority and it is not "are there identities": a queue whose poller last polled
outside the freshness window is NOT being served, and a queue the cluster could not be asked about
is UNKNOWN rather than dead. Unknown must render as unknown.

The Method contract table reuses the derivation from 04. If it is written twice, the two will
disagree.

## Acceptance criteria

- [ ] Actors lists deployed actors with their versions and poller state
- [ ] `no poller`, `serving` and `unknown` are three distinct visible states — a cluster that could
      not be reached does not render as "nothing is serving"
- [ ] Each Method's contract renders through the same derivation as `/dev`, not a second copy
- [ ] The Surface is Live — poller state comes from a subscription, not a timer
- [ ] Usable at 390px with no horizontal overflow, per 03
- [ ] An e2e spec covers it, passing against React first

## Blocked by

- `06-catalog-and-navigation-between-bundles.md`
