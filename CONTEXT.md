# kontra console — context

The words this repository uses, and what each one means here. A glossary, not a spec: nothing below
says how anything is built.

See `CONTEXT-MAP.md` in `kontra` for the other seams, and `kontra/docs/adr/` for decisions.

## Surface

One of the seven things the console is. Catalog, Workflows, Actors, Datasets, Monitor, Secrets,
Settings.

A Surface is **addressable** — it has a URL whose first segment names it — and it is **declared
once**. A thing that is built, tested and not in that declaration is not a Surface; it is
unreachable code, which has happened and is why the declaration is the authority rather than one
list among several.

Not a page, not a tab, not a route. A Surface may contain several of each.

## Panel

The console at its **primary width**, around 390px: an IDE side panel, or a phone.

Panel is not a degraded desktop. It is the width the layout is designed at, and wider viewports
**earn** additional columns rather than the narrow one losing them. The distinction decides what a
bug is: a layout that only works when there is room is broken, not unfinished.

## Embed

The console running inside something else's chrome — today, a VS Code webview.

An Embed is the same console, not a second one. It has no navigation of its own and is addressed
straight to the thing it is showing.

## Live

Derived from a subscription, not from a poll.

A Live surface changes because the control plane said something changed. It does not ask on a timer.
The distinction is visible: a polled surface is stale for the length of its interval and then jumps,
and that jump is what makes an interface feel slow even when it is fast.

## Reactive to code

**The operator's** code, at runtime — not the console's, at build time.

When somebody edits an Actor or a workflow on disk and the control plane re-registers its contract,
every open Surface showing that contract re-derives. A form grows a field while you are looking at
it. Nothing is refreshed and nothing is re-opened.

## Contract

What a Method or a workflow declares it takes: the schema the control plane publishes for it.

The console **derives** every control from a Contract and authors none. A `Literal` becomes a
dropdown, a `bool` a toggle, a `File` a drop zone. There is no second place where a form is
described, which is what stops a form and its Method from disagreeing.

## Console core

The part of the console that has no framework in it: schema derivation, run state, dataset accrual,
addresses, the API client.

Console core is a boundary, not a folder. Anything that needs a framework to run is not in it. The
boundary exists so that what the console KNOWS is separable from what it DRAWS.
