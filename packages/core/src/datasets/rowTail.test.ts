/**
 * The live row tail's client-side reducer and readouts.
 *
 * FRAMEWORK-FREE ON PURPOSE — this is the half that survived the React page being deleted, and it
 * is why the reducer lives in core rather than inside a component.
 */
import { describe, expect, it } from 'vitest';

import {
  ROW_TAIL_START,
  formatChunkAge,
  rowTailLabel,
  rowTailReduce,
  rowTailWindow,
  type LiveRows,
  type RowTailState,
} from './rowTail';

/**
 * THE REDUCER'S TWO LOAD-BEARING RULES.
 */
describe('rowTailReduce', () => {
  const snapshot: LiveRows = { rows: 1203, lastChunkAt: 1_000, at: 1_100 };

  it('replaces on a snapshot, because the server sends full state and not a delta', () => {
    const next = rowTailReduce(ROW_TAIL_START, { type: 'snapshot', snapshot });
    expect(next).toEqual({ snapshot, phase: 'live' });
  });

  /** A degraded readout that lost its number is no better than a frozen one. */
  it('keeps the last count when the stream dies, and says the stream died', () => {
    const live = rowTailReduce(ROW_TAIL_START, { type: 'snapshot', snapshot });
    const dead = rowTailReduce(live, { type: 'error' });
    expect(dead.phase).toBe('degraded');
    expect(dead.snapshot).toEqual(snapshot);
    expect(rowTailLabel(dead, 2_000)).toContain('stream lost');
  });

  it('a reopen goes back to connecting until a snapshot confirms it', () => {
    const dead = rowTailReduce({ snapshot, phase: 'degraded' }, { type: 'open' });
    expect(dead.phase).toBe('connecting');
  });
});

/** An unknown age is said as unknown, never as "just now". */
describe('formatChunkAge', () => {
  it('is null when the store reported no mtime', () => {
    expect(formatChunkAge(null, 5_000)).toBeNull();
  });

  it('reads at the grain the tail actually knows', () => {
    expect(formatChunkAge(5_000, 5_100)).toBe('just now');
    expect(formatChunkAge(1_000, 9_000)).toBe('8s ago');
    expect(formatChunkAge(0, 120_000)).toBe('2m ago');
  });
});


/**
 * THE WINDOW (issue 05) — and specifically the distinction a readout must not collapse.
 */
describe('rowTailWindow', () => {
  const snap = (extra: Partial<LiveRows>): RowTailState => ({
    phase: 'live',
    snapshot: { rows: 9, lastChunkAt: 1, at: 2, ...extra },
  });

  it('hands back the rows the server sent', () => {
    expect(rowTailWindow(snap({ recent: [{ host: 'a.com' }] }))).toEqual({
      rows: [{ host: 'a.com' }],
      clipped: false,
    });
  });

  it('reports a clipped window so a wide-rowed run does not look like a quiet one', () => {
    expect(rowTailWindow(snap({ recent: [{ a: 1 }], clipped: true }))?.clipped).toBe(true);
  });

  /** THE ONE THAT MATTERS. A replayed snapshot carries counts and no window; drawing `[]` for it
   *  would flash "no rows" over a Run whose count says nine, on every reconnect. */
  it('says DO NOT DRAW for a snapshot carrying no window, which is not an empty window', () => {
    expect(rowTailWindow(snap({}))).toBeNull();
    expect(rowTailWindow({ phase: 'connecting', snapshot: null })).toBeNull();
    expect(rowTailWindow(snap({ recent: [] }))).toEqual({ rows: [], clipped: false });
  });
});
