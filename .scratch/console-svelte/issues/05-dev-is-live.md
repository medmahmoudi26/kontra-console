# 05 — `/dev` is Live

Status: ready-for-agent

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
