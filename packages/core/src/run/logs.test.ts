import { describe, expect, it } from 'vitest';

import {
  atLeast,
  filterLogs,
  fixtureLogs,
  incompleteCount,
  newestFirst,
  parseRecord,
  type LogRecord,
} from './logs';

const rec = (over: Partial<LogRecord> = {}): LogRecord => ({
  ts: 1_789_660_000_000,
  level: 'info',
  msg: 'batch 4/12 — 200 units resolved',
  runId: 'nscheck-1',
  ...over,
});

describe('the level floor', () => {
  it('orders weakest-first, so a floor is a comparison and not a lookup table', () => {
    expect(atLeast('debug', 'debug')).toBe(true);
    expect(atLeast('debug', 'info')).toBe(false);
    expect(atLeast('error', 'warn')).toBe(true);
  });
});

describe('the filter', () => {
  /**
   * THE ASSERTION THIS FILE EXISTS FOR (ADR 0050 §2).
   *
   * `speak` is removed on the argument that a completeness claim is more useful as a queryable log
   * record than as narration — PROVIDED IT DOES NOT GET LOST. A claim emitted at INFO that vanishes
   * because a reader raised the floor to `warn` is exactly the silent demotion the ADR warns the
   * migration could cause, and it would be invisible: the reader sees a list, not an absence.
   */
  it('shows every completeness claim regardless of the level floor', () => {
    const records = [
      rec({ level: 'info', msg: 'progress', ts: 3 }),
      rec({ level: 'info', msg: 'seed_limit 200 reached — PARTIAL by request', ts: 2, incomplete: true }),
      rec({ level: 'error', msg: 'upstream reset', ts: 1 }),
    ];
    // Raised floor: the INFO progress line goes, the INFO completeness claim must not.
    const raised = filterLogs(records, { floor: 'error', onlyIncomplete: true });
    expect(raised.map((r) => r.msg)).toEqual(['seed_limit 200 reached — PARTIAL by request']);
  });

  it('applies the floor when the toggle is off', () => {
    const records = [rec({ level: 'debug' }), rec({ level: 'warn' })];
    expect(filterLogs(records, { floor: 'warn' })).toHaveLength(1);
    expect(filterLogs(records, { floor: 'debug' })).toHaveLength(2);
  });

  it('matches text across the message AND the fields a reader would search by', () => {
    const records = [
      rec({ msg: 'nothing', machine: 'kf-desync-01' }),
      rec({ msg: 'nothing', unit: 'kontra-actor-webcrawl' }),
      rec({ msg: 'ABANDONED', machine: 'other' }),
    ];
    expect(filterLogs(records, { text: 'desync' })).toHaveLength(1);
    expect(filterLogs(records, { text: 'webcrawl' })).toHaveLength(1);
    expect(filterLogs(records, { text: 'abandoned' })).toHaveLength(1); // case-insensitive
  });

  it('counts completeness claims over the WHOLE set, not the filtered view', () => {
    // The toggle's badge says how many exist, so turning the filter on cannot change the number on
    // the button that turns it on.
    const records = fixtureLogs('nscheck-1');
    const n = incompleteCount(records);
    expect(n).toBeGreaterThan(0);
    expect(incompleteCount(filterLogs(records, { floor: 'error' }))).toBeLessThanOrEqual(n);
  });
});

describe('ordering', () => {
  it('is newest first', () => {
    const out = newestFirst([rec({ ts: 1 }), rec({ ts: 3 }), rec({ ts: 2 })]);
    expect(out.map((r) => r.ts)).toEqual([3, 2, 1]);
  });
});

describe('parsing a VictoriaLogs line', () => {
  it('reads _time/_msg and the stream fields the agent stamps', () => {
    const r = parseRecord(
      {
        _time: '2026-09-17T15:57:00.749Z',
        _msg: 'batch 12/12',
        level: 'info',
        run_id: 'nscheck-9',
        machine: 'kf-desync-01',
        _stream_unit: 'kontra-actor-nscheck',
      },
      'fallback'
    );
    expect(r.runId).toBe('nscheck-9');
    expect(r.machine).toBe('kf-desync-01');
    expect(r.unit).toBe('kontra-actor-nscheck');
    expect(r.ts).toBe(Date.parse('2026-09-17T15:57:00.749Z'));
  });

  it('treats the STRING "true" as incomplete, because a stream field is a string on the wire', () => {
    expect(parseRecord({ _msg: 'x', incomplete: 'true' }, 'r').incomplete).toBe(true);
    expect(parseRecord({ _msg: 'x', incomplete: true }, 'r').incomplete).toBe(true);
    expect(parseRecord({ _msg: 'x' }, 'r').incomplete).toBeUndefined();
  });

  it('keeps a line whose level nobody set, rather than dropping it', () => {
    // A line with no level is still a line somebody wrote. Discarding it silently is the failure
    // this rail exists to replace.
    expect(parseRecord({ _msg: 'x', level: 'NOTICE' }, 'r').level).toBe('info');
    expect(parseRecord({ _msg: 'x' }, 'r').level).toBe('info');
  });
});

describe('the fixture', () => {
  it('carries the real completeness claims, so the design is tested against real density', () => {
    const msgs = fixtureLogs('r').map((r) => r.msg);
    expect(msgs.some((m) => m.includes('UNSCANNED, not clean'))).toBe(true);
    expect(msgs.some((m) => m.includes('PARTIAL by request'))).toBe(true);
    // And enough progress noise for the findability test to mean something.
    expect(fixtureLogs('r').filter((r) => r.level === 'debug').length).toBeGreaterThanOrEqual(6);
  });
});
