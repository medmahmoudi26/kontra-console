# 13 — Monitor

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 7

## What to build

The last surface: read-only Terminals over a Fleet's tmux, plus the health signals.

Not spiked, and the two unknowns are named rather than assumed away:

- **xterm** is framework-agnostic — it attaches to a DOM element — so this should be a mount rather
  than a port. `terminalOptions.ts` already holds the read-only options as shared logic.
- **`react-markdown`** needs replacing. The widget path is already guarded against raw HTML by
  `untrusted.test.ts`, and **that guard must be carried over**: whatever renders markdown here must
  not enable `dangerouslySetInnerHTML`, `rehype-raw` or `innerHTML`, and the check should be
  extended to the Svelte widgets rather than left behind with the React ones.

## Acceptance criteria

- [ ] Terminals render and stay read-only; the panel token path is unchanged
- [ ] Markdown renders without any raw-HTML escape hatch, asserted by extending `untrusted.test.ts`
      to cover the Svelte widget path — an empty listing must fail, as it already does
- [ ] Health signals come from a subscription, not a timer
- [ ] Usable at 390px with no horizontal overflow
- [ ] An e2e spec covers it, passing against React first

## Blocked by

- `12-workflows.md`
