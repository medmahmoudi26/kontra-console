import { describe, expect, it } from 'vitest';

import {
  changeWords,
  CONVERGE_TONES,
  convergeDuration,
  MAX_TICKS,
  MIN_HEIGHT,
  narrowConverge,
  strip,
  toMs,
  toneOf,
  toneWord,
  type ConvergeWire,
} from './history';

/**
 * The converge strip, against records copied off the live volume.
 *
 * THE FIXTURES BELOW ARE NOT INVENTED. They are `*.history.json` files read verbatim from
 * `/var/lib/docker/volumes/kontra_pulumi-state/_data/pulumi-state/.pulumi/history/` on 2026-09-26,
 * with `environment` dropped (this module does not declare it and no drawing can print it). That
 * matters more here than in most suites: the single most expensive mistake this file can let through
 * is a unit confusion, and a hand-written `startTime: 1700000000000` would have agreed with a parser
 * that was wrong about every record on disk.
 */

/** `kontra-docker-fleet/c-1790186346`, the create. `{create: 2}`, three seconds. */
const CREATE: ConvergeWire = {
  kind: 'update',
  result: 'succeeded',
  startTime: 1790186351,
  endTime: 1790186354,
  resourceChanges: { create: 2 },
};

/** The place that follows it — the most common shape on the volume, 33 of 112 records. */
const PLACE: ConvergeWire = {
  kind: 'update',
  result: 'succeeded',
  startTime: 1790186360,
  endTime: 1790186376,
  resourceChanges: { replace: 1, same: 1 },
};

/** `kontra-fleet/c-1790194348`'s failed update: `{same: 2}` and one second. */
const FAILED: ConvergeWire = {
  kind: 'update',
  result: 'failed',
  startTime: 1790194391,
  endTime: 1790194392,
  resourceChanges: { same: 2 },
};

/**
 * `kontra-fleet/c-1790194348`'s teardown: NO `resourceChanges` AT ALL, and `endTime === startTime`.
 * Two of the 112 records lack the field and three have a zero duration; this one is both.
 */
const BARE_DESTROY: ConvergeWire = {
  kind: 'destroy',
  result: 'succeeded',
  startTime: 1790194430,
  endTime: 1790194430,
};

describe('the epoch unit, which is the one bug this module exists to not have', () => {
  it('reads a Pulumi record as SECONDS, because that is what is on disk', () => {
    // 1790186351 s is 2026-09-23T17:59:11Z and agrees with the checkpoint's own manifest.time.
    expect(toMs(1790186351)).toBe(1790186351000);
    expect(new Date(toMs(1790186351)).toISOString()).toBe('2026-09-23T17:59:11.000Z');
  });

  it('reads the same instant in milliseconds unchanged, so a normalising server draws the same strip', () => {
    // The route these arrive over does not exist yet (issue 13), and a server that answers epoch ms is
    // the more correct server. Both spellings must land on the same day.
    expect(toMs(1790186351000)).toBe(1790186351000);
    expect(toMs(1790186351)).toBe(toMs(1790186351000));
  });

  it('0, absent and non-finite are 0 rather than 1970', () => {
    expect(toMs(undefined)).toBe(0);
    expect(toMs(0)).toBe(0);
    expect(toMs(Number.NaN)).toBe(0);
    expect(toMs(-5)).toBe(0);
  });
});

describe('the tone, and the precedence that decides it', () => {
  it('names five and gives each a word', () => {
    expect(CONVERGE_TONES).toEqual(['ok', 'failed', 'preview', 'destroy', 'running']);
    expect(CONVERGE_TONES.map(toneWord)).toEqual([
      'succeeded',
      'failed',
      'preview',
      'destroyed',
      'still running',
    ]);
  });

  it('a FAILED DESTROY is failed, not destroyed', () => {
    // The reading that matters: a teardown that failed left Machines running and money being spent.
    // Folding it into the destroy tone hides the one record on the strip worth acting on.
    expect(toneOf('destroy', 'failed')).toBe('failed');
    expect(toneOf('destroy', 'succeeded')).toBe('destroy');
  });

  it('a failed preview is failed, and a successful one is a preview', () => {
    expect(toneOf('preview', 'failed')).toBe('failed');
    expect(toneOf('preview', 'succeeded')).toBe('preview');
  });

  it('in-progress outranks the kind, because an unfinished converge has no outcome', () => {
    expect(toneOf('destroy', 'in-progress')).toBe('running');
    expect(toneOf('update', 'in-progress')).toBe('running');
  });

  it('a kind this console was never taught is drawn as ok rather than dropped', () => {
    // `refresh`, `import` and `rename` are Pulumi's other UpdateKinds. A tick missing from the strip
    // is the one thing the strip cannot say.
    expect(toneOf('refresh', 'succeeded')).toBe('ok');
    expect(toneOf('import', 'succeeded')).toBe('ok');
  });
});

describe('one record, narrowed', () => {
  it('carries the duration in ms, the counts, and a title with all four facts', () => {
    const c = narrowConverge(PLACE, 0);
    expect(c.durationMs).toBe(16_000);
    expect(c.changes).toEqual({ create: 0, update: 0, delete: 0, replace: 1, same: 1 });
    // `same` is NOT part of touched: this converge rebuilt one resource and left one alone.
    expect(c.touched).toBe(1);
    expect(c.counted).toBe(true);
    expect(c.title).toBe(
      'update · succeeded · 16s · 1 replaced, 1 unchanged · 2026-09-23T17:59:20.000Z'
    );
  });

  it('a record with no resourceChanges is NOT a record that changed nothing', () => {
    const c = narrowConverge(BARE_DESTROY, 0);
    expect(c.counted).toBe(false);
    expect(c.touched).toBe(0);
    // `0 resources` would be this console asserting something Pulumi did not record.
    expect(c.title).toContain('changes not recorded');
    expect(c.title).not.toContain('no resources');
  });

  it('a zero-duration converge reads as under a second, never as an unrecorded one', () => {
    // Three of the 112 records have endTime === startTime. `run/api.ts:fmtDuration` answers `—` for
    // that, which on this strip is indistinguishable from "we do not know".
    expect(narrowConverge(BARE_DESTROY, 0).durationMs).toBe(0);
    expect(narrowConverge(BARE_DESTROY, 0).title).toContain('under 1s');
  });

  it('an end before its start is clamped rather than drawn as a negative width', () => {
    const c = narrowConverge({ ...CREATE, endTime: CREATE.startTime! - 30 }, 0);
    expect(c.durationMs).toBe(0);
    expect(c.endedAt).toBe(c.startedAt);
  });

  it('defaults a missing kind and result rather than rendering "undefined"', () => {
    const c = narrowConverge({ startTime: 1790186351, endTime: 1790186354 }, 0);
    expect(c.kind).toBe('update');
    expect(c.result).toBe('succeeded');
    expect(c.tone).toBe('ok');
  });

  it('ignores a negative or fractional count instead of printing it', () => {
    const c = narrowConverge({ ...CREATE, resourceChanges: { create: -2, same: 1.7 } }, 0);
    expect(c.changes.create).toBe(0);
    expect(c.changes.same).toBe(1);
  });
});

describe('the words', () => {
  it('orders the counts by what the converge did, with unchanged last', () => {
    expect(changeWords({ create: 1, update: 2, replace: 3, delete: 4, same: 5 }, true)).toBe(
      '1 created, 2 updated, 3 replaced, 4 deleted, 5 unchanged'
    );
  });

  it('separates "changed nothing" from "did not record what it changed"', () => {
    expect(changeWords({ create: 0, update: 0, replace: 0, delete: 0, same: 0 }, true)).toBe('no resources');
    expect(changeWords({ create: 0, update: 0, replace: 0, delete: 0, same: 0 }, false)).toBe(
      'changes not recorded'
    );
  });

  it('a duration over a minute keeps its seconds padded', () => {
    expect(convergeDuration(0)).toBe('under 1s');
    expect(convergeDuration(400)).toBe('under 1s');
    expect(convergeDuration(16_000)).toBe('16s');
    expect(convergeDuration(64_000)).toBe('1m 04s');
    expect(convergeDuration(3_600_000)).toBe('60m 00s');
  });
});

describe('the strip', () => {
  it('a stack that has never converged is a strip with no ticks, not a throw', () => {
    const s = strip([]);
    expect(s.ticks).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.elided).toBe(0);
    expect(s.latest).toBeUndefined();
  });

  it('normalises to OLDEST FIRST, whatever order the route used', () => {
    // Issue 13 says newest-last, the route does not exist yet, and the files it will read are named by
    // a nanosecond suffix that sorts lexically. A strip must not depend on the server getting it right.
    const newestFirst = [BARE_DESTROY, FAILED, PLACE, CREATE];
    const s = strip(newestFirst);
    expect(s.ticks.map((c) => c.startedAt)).toEqual([
      1790186351000, 1790186360000, 1790194391000, 1790194430000,
    ]);
    expect(s.latest?.kind).toBe('destroy');
  });

  it('keeps the order the server used for two converges inside one second', () => {
    const a: ConvergeWire = { ...CREATE, resourceChanges: { create: 2 } };
    const b: ConvergeWire = { ...CREATE, resourceChanges: { create: 9 } };
    expect(strip([a, b]).ticks.map((c) => c.changes.create)).toEqual([2, 9]);
    expect(strip([b, a]).ticks.map((c) => c.changes.create)).toEqual([9, 2]);
  });

  it('scales height linearly against the longest tick SHOWN, and floors a zero', () => {
    const s = strip([CREATE, PLACE, BARE_DESTROY]);
    expect(s.longestMs).toBe(16_000);
    const [create, place, bare] = s.ticks;
    // 3s of 16s, plus the floor.
    expect(place!.height).toBe(1);
    expect(create!.height).toBeCloseTo(MIN_HEIGHT + (1 - MIN_HEIGHT) * (3 / 16), 6);
    // A ZERO-DURATION CONVERGE IS STILL A TICK. Zero pixels reads as a gap in the strip, which is an
    // absence where there is a fact.
    expect(bare!.height).toBe(MIN_HEIGHT);
    expect(bare!.height).toBeGreaterThan(0);
  });

  it('draws a uniform strip at full height rather than at the floor', () => {
    // Every shown converge finished inside one second: they are all equal, so they are all equal.
    // Flooring them would draw agreement as a uniformly suspicious strip.
    const s = strip([BARE_DESTROY, { ...BARE_DESTROY, startTime: 1790194431, endTime: 1790194431 }]);
    expect(s.longestMs).toBe(0);
    expect(s.ticks.map((c) => c.height)).toEqual([1, 1]);
  });

  it('caps at the MOST RECENT MAX_TICKS and counts the rest rather than dropping them', () => {
    // The busiest stack on the live volume holds 51 records, so nothing is elided there — but a strip
    // that clipped silently would lose ticks with no number to say so.
    const many = Array.from({ length: MAX_TICKS + 12 }, (_, i) => ({
      ...CREATE,
      startTime: 1790000000 + i,
      resourceChanges: { create: i },
    }));
    const s = strip(many);
    expect(s.total).toBe(MAX_TICKS + 12);
    expect(s.ticks).toHaveLength(MAX_TICKS);
    expect(s.elided).toBe(12);
    // The ones kept are the newest: the oldest shown is index 12, the newest is the last record.
    expect(s.ticks[0]!.changes.create).toBe(12);
    expect(s.ticks[MAX_TICKS - 1]!.changes.create).toBe(MAX_TICKS + 11);
  });

  it('scales against the visible window, not against an elided outlier', () => {
    // A 600s converge off the left edge would otherwise flatten every tick the reader can see against
    // a number they cannot.
    const old: ConvergeWire = { ...CREATE, startTime: 1789000000, endTime: 1789000600 };
    const recent = Array.from({ length: MAX_TICKS }, (_, i) => ({
      ...CREATE,
      startTime: 1790000000 + i,
      endTime: 1790000000 + i + 10,
    }));
    const s = strip([old, ...recent]);
    expect(s.elided).toBe(1);
    expect(s.longestMs).toBe(10_000);
    expect(s.ticks.every((c) => c.height === 1)).toBe(true);
  });

  it('counts the failures among the ticks shown', () => {
    expect(strip([CREATE, FAILED, PLACE]).failed).toBe(1);
    expect(strip([CREATE, PLACE]).failed).toBe(0);
  });

  it('keys every tick uniquely even when startTime repeats', () => {
    const s = strip([CREATE, { ...CREATE }, { ...CREATE }]);
    expect(new Set(s.ticks.map((c) => c.key)).size).toBe(3);
  });
});
