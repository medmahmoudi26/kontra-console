# 01 — `@kontra/console-core`, extracted and guarded

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-the-console-migrates-to-svelte-one-surface-at-a-time.md` · decision 2

## What to build

The console's framework-free half becomes a workspace package both apps import. Measured today: 77
of 88 non-test modules import no framework, and 100 of 130 test files test them — schema derivation,
run state, dataset accrual, addresses, the API client.

**The guard is the deliverable, not the move.** The whole migration rests on this package staying
framework-free; a React import in it silently ends the arrangement. So it needs a check that fails
the build, not a note in a README.

Nothing user-visible changes. The React console builds, runs and passes its suite, importing its
logic from somewhere else.

## Acceptance criteria

- [ ] The framework-free modules and their tests live in `@kontra/console-core`; the React app
      imports it and no longer holds copies
- [ ] A check fails the build if anything in the package imports a UI framework — asserted by a test
      that ADDS such an import and confirms the check fires, not merely that it passes today
- [ ] The guard reports a walk that found zero files as a FAILURE: a tree walk that matches nothing
      reports success, and that is how this check would quietly stop working
- [ ] `pnpm test` passes in both packages; the console's e2e suite passes unchanged
- [ ] The eager bundle is no larger than before — this is a move, and a regression here means
      something was duplicated rather than relocated

## Blocked by

None — can start immediately.
