/**
 * The live row tail's client-side reducer and readouts.
 *
 * FRAMEWORK-FREE ON PURPOSE — this is the half that survived the React page being deleted, and it
 * is why the reducer lives in core rather than inside a component.
 */
import { describe, expect, it } from 'vitest';

import {
  ROW_TAIL_KEEP,
  ROW_TAIL_START,
  formatChunkAge,
  rowTailLabel,
  rowTailReduce,
  rowTailTrimmed,
  rowTailWindow,
  type LiveRows,
  type RowChunk,
  type RowTailState,
} from './rowTail';

/**
 * THE REDUCER'S TWO LOAD-BEARING RULES.
 */
describe('rowTailReduce', () => {
  const snapshot: LiveRows = { rows: 1203, lastChunkAt: 1_000, at: 1_100 };

  /**
   * THE COUNT REPLACES; THE TAIL DOES NOT. The server sends full state for the tally — a count, not
   * a delta — so the newest snapshot simply wins. Its row window is a different thing: that is
   * folded into the tail, which is the one part of this state that remembers.
   */
  it('replaces the tally on a snapshot and leaves the tail to accumulate', () => {
    const next = rowTailReduce(ROW_TAIL_START, { type: 'snapshot', snapshot });
    expect(next).toEqual({ snapshot, phase: 'live', tail: [] });
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
  /** Drive the reducer the way the stream does, so the tail under test is one the client built. */
  const after = (...windows: (RowChunk[] | undefined)[]): RowTailState =>
    windows.reduce<RowTailState>(
      (st, recent) =>
        rowTailReduce(st, {
          type: 'snapshot',
          snapshot: { rows: 9, lastChunkAt: 1, at: 2, ...(recent ? { recent } : {}) },
        }),
      ROW_TAIL_START
    );

  it('hands back what the client has accumulated', () => {
    expect(rowTailWindow(after([{ id: 'a', row: { host: 'a.com' } }]))).toEqual({
      rows: [{ host: 'a.com' }],
      clipped: false,
    });
  });

  it('reports a clipped window so a wide-rowed run does not look like a quiet one', () => {
    const st = rowTailReduce(ROW_TAIL_START, {
      type: 'snapshot',
      snapshot: { rows: 9, lastChunkAt: 1, at: 2, recent: [{ id: 'a', row: { a: 1 } }], clipped: true },
    });
    expect(rowTailWindow(st)?.clipped).toBe(true);
  });

  /** THE ONE THAT MATTERS. A replayed snapshot carries counts and no window; drawing `[]` for it
   *  would flash "no rows" over a Run whose count says nine, on every reconnect. */
  it('says DO NOT DRAW before anything has been accumulated', () => {
    expect(rowTailWindow(after(undefined))).toBeNull();
    expect(rowTailWindow(ROW_TAIL_START)).toBeNull();
    expect(rowTailWindow(after([]))).toBeNull();
  });
});

/**
 * THE TAIL GROWS. The server re-sends a 50-chunk WINDOW every poll, so a readout that drew it
 * directly showed the same rows forever while the count climbed past them.
 */
describe('the accumulated tail', () => {
  const win = (...ids: string[]): RowChunk[] => ids.map((id) => ({ id, row: { id } }));
  const feed = (st: RowTailState, recent: RowChunk[]): RowTailState =>
    rowTailReduce(st, { type: 'snapshot', snapshot: { rows: 0, lastChunkAt: 1, at: 2, recent } });

  it('appends only what is new when the window is re-sent', () => {
    let st = feed(ROW_TAIL_START, win('a', 'b'));
    st = feed(st, win('a', 'b', 'c')); // the same window, one chunk further on
    expect(st.tail.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('never repeats a chunk, however many times the window carries it', () => {
    let st = ROW_TAIL_START;
    for (let i = 0; i < 20; i++) st = feed(st, win('a', 'b'));
    expect(st.tail.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('keeps growing past the server window, which is the whole point', () => {
    let st = ROW_TAIL_START;
    // 60 chunks arriving as a sliding window of 5 — more than ROW_TAIL_WINDOW ever carries at once.
    for (let i = 0; i < 60; i++) {
      const ids = Array.from({ length: 5 }, (_, k) => `c${Math.max(0, i - 4) + k}`);
      st = feed(st, win(...ids));
    }
    expect(st.tail.length).toBeGreaterThan(50);
  });

  it('drops its oldest end at the cap rather than growing without bound', () => {
    let st = ROW_TAIL_START;
    for (let i = 0; i < ROW_TAIL_KEEP + 25; i++) st = feed(st, win(`c${i}`));
    expect(st.tail.length).toBe(ROW_TAIL_KEEP);
    expect(st.tail[0].id).toBe('c25'); // the first 25 fell off the front
    expect(rowTailTrimmed(st)).toBe(true);
  });

  /** A reconnect replays counts with no window. Clearing there would blank a correct tail. */
  it('survives a replayed snapshot that carries no window', () => {
    let st = feed(ROW_TAIL_START, win('a', 'b'));
    st = rowTailReduce(st, { type: 'snapshot', snapshot: { rows: 2, lastChunkAt: 1, at: 3 } });
    expect(st.tail.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('survives a degrade and a reopen', () => {
    let st = feed(ROW_TAIL_START, win('a'));
    st = rowTailReduce(st, { type: 'error' });
    st = rowTailReduce(st, { type: 'open' });
    expect(st.tail.map((c) => c.id)).toEqual(['a']);
    expect(st.phase).toBe('connecting');
  });
});
