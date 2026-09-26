import { describe, expect, it } from 'vitest';

import type { ServeHistory } from '@kontra/console-core/run/api';

import { NO_REASON_RECORDED, serveCapNote, serveLines, type ServeLine } from './serveHistory';

/** 23 Sep 2026, 19:22:58 local — the same instant `startedAtText`'s own doc uses as its example. */
const T = new Date(2026, 8, 23, 19, 22, 58).getTime();

const history = (serves: ServeHistory['serves'], capped = false): ServeHistory => ({ serves, capped });

/**
 * The single row a one-serve case is about.
 *
 * It THROWS on an empty derivation rather than indexing with `!`. A non-null assertion here would
 * turn "the mapper dropped the row" into a property read on `undefined` three lines later, which
 * reads as a broken test rather than as the regression it is.
 */
function only(h: ServeHistory): ServeLine {
  const [row] = serveLines(h);
  if (!row) throw new Error('serveLines returned no row for a history with one serve');
  return row;
}

describe('what a serve row says happened', () => {
  it('a completed serve worked, and carries no reason line', () => {
    const row = only(
      history([{ execId: 'e1', status: 'completed', startedAt: T, closedAt: T + 4_200 }])
    );
    expect(row.outcome).toBe('worked');
    // '' and not a placeholder: an empty reason line reads as a reason nobody wrote down.
    expect(row.reason).toBe('');
    expect(row.took).toBe('4.2s');
  });

  it('gives a serve still in flight no duration, because this panel does not tick', () => {
    // MEASURED IN THE BROWSER, which is why the field is empty rather than `now - startedAt`: three
    // loads of the same running serve printed 4.9s, 6.6s and 8.3s, each frozen at the moment its tab
    // opened. `setInterval` is banned in this tree (ADR 0048 §3) and a history does not want one, so
    // a stopwatch here is a stopwatch that stops — worse than no number. The start time stays.
    const row = only(history([{ execId: 'e1', status: 'running', startedAt: T, closedAt: 0 }]));
    expect(row.outcome).toBe('running');
    expect(row.took).toBe('');
    expect(row.when).not.toBe('');
    expect(row.reason).toBe('');
  });

  it('shows the failure reason, which is the whole point of keeping the history', () => {
    const row = only(
      history([
        {
          execId: 'e1',
          status: 'failed',
          startedAt: T,
          closedAt: T + 1_100,
          failure: "serve-dev failed (exit 1): ModuleNotFoundError: No module named 'httpx'",
        },
      ])
    );
    expect(row.outcome).toBe('failed');
    expect(row.reason).toBe(
      "serve-dev failed (exit 1): ModuleNotFoundError: No module named 'httpx'"
    );
  });

  it('says the reason is GONE rather than showing a failure with a blank line under it', () => {
    // A closed execution's history ages out of Temporal before its visibility row does, so "it
    // failed and the sentence is gone" is ordinary. Which of the two you are looking at is the
    // difference between a record with a hole in it and one that looks broken.
    const row = only(
      history([{ execId: 'e1', status: 'failed', startedAt: T, closedAt: T + 900 }])
    );
    expect(row.reason).toBe(NO_REASON_RECORDED);
  });

  it('treats a cancelled serve as failed — no Worker came out of it either', () => {
    // The collapse is about what the panel is FOR: whether that press produced something polling
    // the queue. The row's reason line is where the three kinds of not-working stay distinguishable.
    const row = only(
      history([{ execId: 'e1', status: 'cancelled', startedAt: T, closedAt: T + 100, failure: 'stopped' }])
    );
    expect(row.outcome).toBe('failed');
    expect(row.reason).toBe('stopped');
  });

  it('prints no clock at all for a serve with no start time', () => {
    // 0 is "the server did not say", and `0s` beside a failure would be read as "it failed instantly".
    const row = only(
      history([{ execId: 'e1', status: 'failed', startedAt: 0, closedAt: 0 }])
    );
    expect(row.when).toBe('');
    expect(row.took).toBe('');
  });

  it('keeps the server\'s order — the newest serve explains the state on screen', () => {
    const rows = serveLines(
      history([
        { execId: 'new', status: 'completed', startedAt: T, closedAt: T + 1_000 },
        { execId: 'old', status: 'failed', startedAt: T - 90_000, closedAt: T - 88_000 },
      ])
    );
    expect(rows.map((r) => r.execId)).toEqual(['new', 'old']);
  });

  it('draws nothing at all from an absent history, rather than throwing', () => {
    // The page asks for this on mount and the request can fail; a panel that throws on a null takes
    // the whole Actors view with it.
    expect(serveLines(null)).toEqual([]);
    expect(serveLines(undefined)).toEqual([]);
  });
});

describe('the cap is said out loud, or not said at all', () => {
  it('says how many are shown when the server stopped at its limit', () => {
    // A silent slice reads as the complete history: "this actor has been served twice" where the
    // truth is "here are the last two of many".
    const note = serveCapNote(
      history(
        [
          { execId: 'a', status: 'completed', startedAt: T, closedAt: T + 1 },
          { execId: 'b', status: 'completed', startedAt: T - 1, closedAt: T },
        ],
        true
      )
    );
    expect(note).toContain('2 most recent');
    expect(note).toContain('more times than that');
  });

  it('counts the rows that are actually there, so the sentence cannot disagree with the list', () => {
    const note = serveCapNote(history([{ execId: 'a', status: 'failed', startedAt: T, closedAt: T }], true));
    expect(note).toContain('1 most recent');
  });

  it('says nothing when the cap did not bite', () => {
    expect(serveCapNote(history([{ execId: 'a', status: 'completed', startedAt: T, closedAt: T }]))).toBe('');
    expect(serveCapNote(history([]))).toBe('');
    expect(serveCapNote(null)).toBe('');
  });
});
