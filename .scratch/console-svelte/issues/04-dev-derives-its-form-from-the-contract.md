# 04 — `/dev` derives its form from the contract

Status: ready-for-agent

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
