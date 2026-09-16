# 04 — `/dev` derives its form from the contract

Status: done

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 6

## What to build

The IDE embed, in Svelte. `/dev?actor=&method=&theme=&token=` is what the VS Code extension opens in
a webview iframe; it is the console's own `MethodCall` with the chrome removed.

Every control is DERIVED from the Method's published contract and none is authored — see
`CONTEXT.md`, *Contract*. The five the schema earns:

    str                      a box
    Literal["a","b"]         a dropdown — the wrong value is not on screen
    bool                     a THREE-state toggle
    kontra.File / Folder     a drop zone carrying {name, sha256, size}

**`not set` is a real state and it is why the toggle is not a checkbox.** Leaving an optional
boolean alone omits the key, so the AUTHOR's default applies — a different outcome from sending
`false`. The cycle, written as a cycle because nested ternaries here once skipped `false` entirely:

    on    -> false
    false -> required ? true : unset
    unset -> true

Uploads go to `/api/uploads` before the run starts. What rides in the argument is the ref, never the
bytes: a Method's input is a workflow argument, and a workflow argument is replayed on every worker
that picks the run up.

## Acceptance criteria

- [ ] The extension's webview renders the Svelte `/dev` and a Method call completes end to end
- [ ] All five controls derive from a real served Actor's contract, asserted against a schema
      captured from the SDK rather than hand-written — a reader that agreed only with a schema we
      wrote proves nothing about pydantic
- [ ] The toggle expresses three states and its cycle reaches `false`
- [ ] An optional `File` and an optional `Folder` are still drop zones: the marker is two
      indirections down, through `anyOf` and then `$ref`
- [ ] A dropped file uploads and the field carries the ref, not the bytes
- [ ] Usable at 390px with no horizontal overflow, per 03
- [ ] An e2e spec covers the flow — passing against React `/dev` first, then against this one

## Blocked by

- `03-type-scale-and-panel-first-shell.md`

## Comments

**Done.** `/dev` now serves from the Svelte bundle — verified against the real build:
`/dev?actor=firstactor&method=expand` → `svelte.html`, `/catalog` → `index.html`. Bundle is 50.32 KB
(19.38 gzipped). Overflow clean on both routes at 320/390/1280.

**The controls are asserted against real SDK output.** The fixture is
`TypeAdapter(Target).json_schema()` from the template actor, captured from pydantic and previously
verified byte-identical to what a live control plane serves. Five distinct controls asserted as a
SET, because five separate assertions would still let a reader that answered `text` for everything
look nearly right in a diff.

**The form has no list of fields in it.** `schemaFields` from `@kontra/console-core` — the same
derivation the React console uses, not a second copy — produces nodes with a `control` each and
`Field.svelte` draws what that says.

**The toggle cycle is a function, not nested ternaries**, and the test asserts it reaches `false` —
which the React console's could not: a `unset = !on && !off` guard swallowed the arm, so `True`
rendered as `not set`. Also asserted: a required field never lands on unset, and the optional cycle
returns to unset after exactly three clicks.

**A contract change does not wipe what somebody is typing.** Only keys the new schema no longer
declares are dropped. Without that, slice 05 would clear the form on every save — which is the
feature actively working against the user.

**Errors are states, not throws.** A pane that renders nothing because a fetch rejected is
indistinguishable from one still loading, and both read as a broken extension. `no actor named X is
serving` names the command that fixes it, because registered-but-not-served is the likeliest reason
to be here and confused.

**The overflow check's route parse was broken and the output showed it.** An apostrophe in a comment
(`the fallback's clause`) paired with the next quote and produced a third "route" made of prose,
which the check then loaded and passed. Comments are stripped before parsing now. The exit code was
0 throughout — this was found by reading the output.
