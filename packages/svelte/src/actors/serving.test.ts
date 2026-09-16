import { describe, expect, it } from 'vitest';

import { servingState, servingHint } from './serving';

const NOW = 1_800_000_000_000;

describe('three serving states, not two', () => {
  it('a fresh poller is serving', () => {
    expect(servingState({ pollers: 2, lastPoll: NOW - 1_000 }, NOW)).toBe('serving');
  });

  it('no pollers is idle', () => {
    expect(servingState({ pollers: 0, lastPoll: 0 }, NOW)).toBe('idle');
  });

  it('a poller whose last poll is stale is idle, not serving', () => {
    // Temporal keeps a poller listed for about five minutes after it was last seen, so counting
    // identities would report a worker killed thirty seconds ago as serving.
    expect(servingState({ pollers: 3, lastPoll: NOW - 60 * 60 * 1000 }, NOW)).toBe('idle');
  });

  it('an unreachable cluster is UNKNOWN, never idle', () => {
    // THE FAILURE DIRECTION THAT MATTERS. Reporting a control plane nobody could reach as a wall of
    // dead actors sends an operator to restart workers that are fine.
    expect(servingState({ pollers: 0, lastPoll: 0, error: 'timeout' }, NOW)).toBe('unknown');
    expect(servingState(null, NOW)).toBe('unknown');
    expect(servingState(undefined, NOW)).toBe('unknown');
  });

  it('an error wins over a healthy-looking count', () => {
    // A report carrying both a count and an error is a stale count; the error is the newer fact.
    expect(servingState({ pollers: 4, lastPoll: NOW, error: 'rpc failed' }, NOW)).toBe('unknown');
  });

  it('every state says what it means for a dispatch', () => {
    for (const s of ['serving', 'idle', 'unknown'] as const) {
      expect(servingHint(s).length, s).toBeGreaterThan(10);
    }
    // And the three hints are distinct — one shared string would make the states decorative.
    expect(new Set(['serving', 'idle', 'unknown'].map((s) => servingHint(s as never))).size).toBe(3);
  });
});
