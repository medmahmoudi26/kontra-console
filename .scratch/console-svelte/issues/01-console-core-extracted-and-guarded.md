# 01 — `@kontra/console-core`, extracted and guarded

Status: done

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

## Comments

**Done.** 77 modules and 60 tests in `@kontra/console-core`; app 71 files / 1239 tests green, core
59 / 1079, and the entry bundle is **byte-identical** at 472,705 bytes across 85 chunks — a move,
not a duplication.

**Two modules were reaching a framework-free value THROUGH a component.** `runState.ts` imported
`StreakBar` from `components/Spark` when it is defined in `components/spark`, and `scratchInspect.ts`
imported `schemaFields` from `MethodContract` when it comes from `schemaTree`. The first is also one
of this repo's ten case-collision pairs, so on a case-insensitive filesystem that import was
genuinely ambiguous. Both now point at the real source, which is what made the cut clean: 2
crossings out of 79, not a tangle.

**Seven files came back.** Five tests that inspect `.tsx` sources, `workflowSketch.ts` (transitively
React Flow), and its test. The loop that returns them iterates, because sending one file back can
strand another.

**The guard is proven, not asserted.** All five banned patterns — static `react`, `svelte`, dynamic
`import('react')`, `require('react-dom')`, and a `.tsx` specifier — each exit 1 when introduced;
clean exits 0. **An empty walk exits 1**, so a renamed directory cannot turn this into a green tick
over nothing. My first attempt at proving that reported exit 0 for the `.tsx` case and the guard was
fine — I had piped through `head`, so `$?` was head's.

**`environment: 'node'` was the wrong assertion** and the first version of `vitest.config.ts` made
it. Core is FRAMEWORK-free, not DOM-free: `session.ts` reads browser storage and `hostBridge.ts`
talks to the embedding host through the document. Both belong here, neither imports a framework.

**The failure mode worth remembering for the next slice:** `vi.mock('../run/api')` does not error
when the path no longer resolves — it silently does not mock. 44 tests failed with "expected spy to
be called 1 times, got 0" and none of them said why.

`src/testing/consoleSource.ts` is new: it resolves a source file across both roots and THROWS on a
miss, because a reader that answered `''` would turn every `toContain` into a silent pass. Fourteen
suites broke on hardcoded paths during this move; the next move will not break them.
