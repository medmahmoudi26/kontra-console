/**
 * The surface list itself — the one thing three separate places read.
 *
 * These are cheap assertions about a constant, and they are here because the constant has already
 * drifted from its copies twice. The first cost a live 404 on every dataset name with a dot in it.
 * The second was quieter and worse: `secrets` was added to the `View` union and to the detail table
 * — both of which the compiler DID enforce — and left out of the plain array that ordered them, so
 * a whole finished surface shipped with no rail item, no path and no address that parsed. This
 * suite passed throughout, because it pinned the five surfaces that existed when it was written.
 *
 * THE STRUCTURE IS WHAT FIXED IT, NOT THIS FILE. `View` is derived from the declaration now, so
 * there is no half-added state left to test for. What is still pinned here is the part a type
 * cannot hold: the ORDER, which is an operator's muscle memory, and the SEGMENT LIST the server
 * copies, which no compiler can reach across a package boundary.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW, PATHS, RETIRED, SPA_SEGMENTS, SURFACES } from './surfaces';

/** The rail, in order. Restated rather than derived — deriving it from the same module would make
 *  every assertion below true of whatever that module happens to say. */
const EXPECTED: readonly string[] = [
  'catalog',
  'workflows',
  'runs',
  'actors',
  'datasets',
  'logs',
  'secrets',
  'settings',
];

describe('the surfaces', () => {
  it('are these, in this order', () => {
    // The order is the order the work happens, and it is asserted rather than implied because the
    // rail draws it verbatim: reordering this list moves an operator's muscle memory.
    expect(SURFACES.map((s) => s.id)).toEqual(EXPECTED);
  });

  it('each carry a path, a label and a hint — a half-declared surface draws with a hole in it', () => {
    expect(SURFACES.length).toBeGreaterThan(0);
    for (const surface of SURFACES) {
      expect(surface.path, surface.id).toBe(`/${surface.id}`);
      expect(surface.label.length, surface.id).toBeGreaterThan(0);
      expect(surface.hint.length, surface.id).toBeGreaterThan(0);
    }
  });

  it('appear in the nav order AND in the path record, with no path left undefined', () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE SECRETS ESCAPE. `PATHS` is a `Record<View, string>`,
    // so a MISSING key fails to compile — but it was built from a separate array and cast, so a key
    // the array omitted was `undefined` at runtime while the type insisted it was a string. Both
    // now come off one declaration; this pins that they still do.
    expect(Object.keys(PATHS).sort()).toEqual([...EXPECTED].sort());
    for (const id of EXPECTED) {
      expect(PATHS[id as keyof typeof PATHS], id).toBe(`/${id}`);
    }
  });

  it('are all reachable from the rail — nothing is addressable and undrawn, or drawn and unaddressable', () => {
    const drawn = SURFACES.map((s) => s.id).sort();
    expect(drawn).toEqual(Object.keys(PATHS).sort());
  });

  it('start on Workflows, which is the centre', () => {
    // NOT Catalog, though Catalog is first in the rail. An operator opens this console to see what
    // their system is doing; landing on a browse page puts a search box in front of that answer.
    expect(DEFAULT_VIEW).toBe('workflows');
    expect(SURFACES.some((s) => s.id === DEFAULT_VIEW)).toBe(true);
  });
});

describe('the retired surfaces', () => {
  it('are Scratch and Monitor, and they land on different surfaces', () => {
    // Runs used to be here too; it is a live surface again. Scratch is a drawing surface with no
    // subject, folded into a workflow's own design tab. Monitor is the wall of read-only Terminals,
    // deleted outright — so it lands on Logs, which answers what the wall was opened to ask and
    // keeps answering it after the machine is gone.
    expect(Object.keys(RETIRED).sort()).toEqual(['monitor', 'scratch']);
    expect(RETIRED.scratch?.to).toBe('workflows');
    expect(RETIRED.monitor?.to).toBe('logs');
  });

  it('carry nothing, because neither old address named anything that still exists', () => {
    // `/scratch` was a drawing about nothing. `/monitor/<id>` named a Terminal, and a Terminal is
    // not a thing any more — handing that id on would be inventing a selection nothing can honour.
    expect(RETIRED.scratch?.carries).toBe('nothing');
    expect(RETIRED.monitor?.carries).toBe('nothing');
  });

  it('are not surfaces any more, so nothing can navigate to them', () => {
    for (const segment of Object.keys(RETIRED)) {
      expect(SURFACES.some((s) => s.id === segment), segment).toBe(false);
    }
  });
});

describe('what the server has to serve', () => {
  it('is every live surface plus every retired one', () => {
    // A LIVE segment missing there 404s a cold load of any id containing a dot. A RETIRED segment
    // missing there is worse in a quieter way: the redirect is frontend code, so the shell that
    // would forward `/runs/sweep-v1.2` never loads to forward it.
    expect([...SPA_SEGMENTS].sort()).toEqual([...EXPECTED, 'scratch', 'monitor'].sort());
  });

  it('names the copy the server keeps, so the pair can only be wrong together', () => {
    // `control/orchestrator/src/server.ts`'s `SPA_SURFACES` restates this list — it is a separate
    // package and cannot import it — and that repo's `spaFallback.test.ts` asserts the other half.
    // The number is here so adding a surface fails on BOTH sides of the boundary rather than
    // silently on neither.
    expect(SPA_SEGMENTS).toHaveLength(EXPECTED.length + 2);
    expect(SPA_SEGMENTS).toHaveLength(10);
  });
});
