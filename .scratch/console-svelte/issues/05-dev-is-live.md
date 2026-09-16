# 05 — `/dev` is Live

Status: done

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 3

## What to build

The payoff slice. You edit `actor.py`, save, and the open form grows a field — no refresh, no
reopen.

The machinery already exists on the server and has never been used. `kontra serve --actor … --watch`
re-registers the contract on every save, and `/api/sources/actor/{id}/schema/stream` publishes it.
That endpoint is in the console's generated route table today and **nothing subscribes to it**. This
slice is the first consumer.

**One subscription, everything derived.** No `setInterval` for data, here or after — see
`CONTEXT.md`, *Live*. A polled surface is stale for the length of its interval and then jumps, and
the jump is what the whole migration is trying to remove.

A dropped stream must DEGRADE, not freeze: `EventSource` gives reconnect and `Last-Event-ID` for
free, and the surface should say it is reconnecting rather than silently showing stale values. The
dataset row tail already does this and is the reference.

## Acceptance criteria

- [ ] Adding a field to a served Method's input makes it appear in the open form with no refresh
- [ ] Removing a field removes its control, and a value typed into it does not survive into the call
- [ ] No `setInterval` is used for data on this route — asserted, so it cannot creep back
- [ ] A killed stream shows a reconnecting state and recovers; it does not freeze on stale values
      and does not silently keep showing them as current
- [ ] The form's in-progress values survive a contract update that did not touch those fields —
      re-deriving the schema must not wipe what somebody is halfway through typing
- [ ] An e2e spec drives the edit → save → form-changes path

## Blocked by

- `04-dev-derives-its-form-from-the-contract.md`

## Comments

**Done.** `/api/sources/actor/:id/schema/stream` has its first consumer, after shipping unused. Edit
a served Method, save, and the open form changes without a refresh.

**The stream says WHEN; the API says WHAT.** The server sends a bare `data: changed`, so this
refetches rather than parsing a payload — which keeps one representation of a contract instead of
two that can disagree.

**It subscribes to the SOURCE id, not the actor name.** The pane is opened from an editor that knows
a filename, not an opaque registration id, so the name is resolved through `/api/sources/actor`
first. Asserted, because the two are easy to confuse and the failure is a silent non-subscription.

**A dropped stream degrades and keeps the form.** `EventSource` fires `onerror` on every reconnect
attempt including the ones that succeed, so that is rendered as `reconnecting…` rather than as a
failure — and the last good contract stays on screen. Asserted: after an error the contract is
unchanged. Losing a half-filled form because the network blinked is not an improvement.

**A failed re-read does not blank the pane either.** A save that briefly leaves a file unparseable
is normal; the previous contract survives it.

**No timers, and now that is a guard.** `no-polling.mjs` fails the build on a `setInterval` CALL —
comments are exempt, so the rule can be explained where it is enforced — and a test separately spies
on `setInterval` and asserts zero calls. A poll would have passed every other test in this slice.

Bundle: 51.95 KB, 19.95 gzipped. 20 tests in the Svelte package, `svelte-check` clean, overflow clean
at 320/390/1280.

One cast became a narrow: `contract as {schema: …}` would have kept compiling if `ready` ever
stopped carrying a schema.
