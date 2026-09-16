# 03 — The type scale and the panel-first shell

Status: ready-for-agent

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decisions 4 and 5

## What to build

The plain route from 02 becomes the console's design language, and the language is enforced rather
than documented.

**14px base, 12px hard floor, one scale** — roughly 12 / 14 / 16 / 20 / 24. Nothing a person reads
goes below 12px; 11px is allowed only for uppercase micro-labels. Sizes come from tokens. Arbitrary
per-site values are how the React console reached 336 of them against 48 scale tokens, so the check
is a build failure, not a convention.

**Panel-first.** ~390px is the width the layout is designed at; wider viewports EARN columns. A
layout that only works when there is room is a bug in this codebase, not an unfinished state — see
`CONTEXT.md`, *Panel*.

This slice is where density is deliberately traded away. Expect tables to lose a column or gain a
second line at 390px; that is the decision, not a regression.

## Acceptance criteria

- [ ] Type sizes come from tokens; a check fails the build on an arbitrary size at a call site, and
      a test proves the check fires by introducing one
- [ ] No token renders below 12px except the uppercase micro-label role
- [ ] A headless-browser check asserts **zero horizontal overflow** at 320px, 390px and 1280px on
      every route the Svelte bundle serves, and runs in CI
- [ ] That check FAILS if a route is added without being covered — a walk that finds nothing must
      not pass
- [ ] Visible keyboard focus on every control; `prefers-reduced-motion` respected
- [ ] The shell paints its own background from a token and does not inherit the host's

## Notes

The prototype's phone bugs are the cheapest available list of what this check catches: an event log
whose rows overlapped their own text, a card table that widened the page because grid items default
to `min-width: auto`, a nav whose brand and tenant chip pushed the document sideways, and 132px of a
390px screen spent on labels. All four passed a desktop review.

## Blocked by

- `02-two-bundles-one-login.md`
