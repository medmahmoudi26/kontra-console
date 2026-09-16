# 03 — The type scale and the panel-first shell

Status: done

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

## Comments

**Done.** `src/lib/tokens.css` is the scale — 11 / 12 / 14 / 16 / 20 / 24 — and two checks enforce
it. `pnpm test` at the root now runs all three guards plus 1239 tests in one command.

**`type-scale.mjs` reads the scale FROM the stylesheet** rather than restating it, because two lists
drift and one cannot. It separates two different mistakes: off-scale (13px) and below-floor (9px),
because they need different answers. Proven: 9px exits 1, 13px exits 1, raw 11px exits 1, 14px exits
0, `var(--t-micro)` exits 0, and an empty walk exits 1.

**Raw 11px is rejected while `var(--t-micro)` passes, and that is the design.** The only way to get
11px is to NAME it, which is how the "uppercase labels only" rule gets stated at the call site
instead of living in a comment nobody reads.

**`overflow.mjs` reads its routes from the orchestrator's allowlist**, so a new surface is covered
the moment it is declared — a list in the check itself would silently stop covering the newest page,
which is the one most likely to be broken. Proven by adding `min-width: 620px` to a panel: 312px of
overflow at 320px, 242px at 390px, caught.

**It also asserts the page RENDERED.** A blank document never overflows, so `0px` on an app that
failed to mount is the most confident wrong answer this check could give.

**The empty-route guard caught its own parse bug.** The first version used one regex over
TypeScript, matched nothing, and reported "no Svelte routes" — which the guard correctly called a
broken check rather than a clean result. It was right.

**Panel-first is in the CSS, not in a media query.** The ~390px layout is what `.app` and `nav` say
with no query at all; `@media (min-width: 720px)` only ADDS. The tenant chip is hidden by default and
appears when there is room — it was one of the four things pushing the prototype sideways, and it is
context rather than navigation.

Playwright is pinned to 1.61.0 to match the version this repo already uses for e2e, and the script
honours `CHROMIUM_PATH` so a machine with a browser does not download a second one.
