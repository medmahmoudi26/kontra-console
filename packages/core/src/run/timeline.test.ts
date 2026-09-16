import { describe, expect, it } from 'vitest';

import type { RunEvent } from './api';
import { buildTimeline, short } from './timeline';

const ev = (p: Partial<RunEvent> & { id: number; t: number }): RunEvent => ({
  type: 'ActivityTaskCompleted',
  cat: 'activity',
  at: 0,
  detail: '',
  attempt: 1,
  dur: 0,
  ...p,
});

describe('buildTimeline', () => {
  it('a closing event becomes a bar spanning t - dur to t', () => {
    // `dur` is "seconds this event closes"; the server has already paired the scheduling event
    // with its completion, so nothing here re-derives the pair.
    const tl = buildTimeline([ev({ id: 1, t: 5, dur: 2, detail: 'firstactor/n1' })]);
    expect(tl.lanes).toHaveLength(1);
    expect(tl.lanes[0]!.bars[0]).toMatchObject({ start: 3, end: 5, open: false });
  });

  it('a zero-duration event is a MOMENT, not a one-pixel bar', () => {
    // A timer fired at t=3 drawn as a bar looks like three seconds of work.
    const tl = buildTimeline([ev({ id: 1, t: 3, cat: 'timer', type: 'TimerFired' })]);
    expect(tl.lanes).toHaveLength(0);
    expect(tl.moments).toHaveLength(1);
    expect(tl.moments[0]!.t).toBe(3);
  });

  it('groups by what the event is ABOUT, not by category', () => {
    // Grouping by `cat` gives four lanes for any run, which says nothing about one with forty
    // dispatches.
    const tl = buildTimeline([
      ev({ id: 1, t: 3, dur: 1, detail: 'firstactor/n1' }),
      ev({ id: 2, t: 4, dur: 1, detail: 'firstactor/n2' }),
      ev({ id: 3, t: 5, dur: 1, detail: 'firstactor/n1' }),
    ]);
    expect(tl.lanes.map((l) => l.key).sort()).toEqual(['firstactor/n1', 'firstactor/n2']);
    expect(tl.lanes.find((l) => l.key === 'firstactor/n1')!.bars).toHaveLength(2);
  });

  it('prefers the linked workflow id, which is the set of rows that are navigable', () => {
    const tl = buildTimeline([
      ev({ id: 1, t: 2, dur: 1, cat: 'child', detail: 'anything', link: { workflowId: 'wf-abc' } as never }),
    ]);
    expect(tl.lanes[0]!.key).toBe('wf-abc');
  });

  it('something scheduled and never closed is an OPEN bar, and counts as running', () => {
    // The row a person opening this page is looking for. Derived by subtraction: a bar with no
    // closing event IS still going.
    const tl = buildTimeline(
      [ev({ id: 1, t: 2, type: 'ActivityTaskScheduled', detail: 'webcrawl/n3' })],
      9
    );
    expect(tl.running).toBe(1);
    expect(tl.lanes[0]!.bars[0]).toMatchObject({ start: 2, end: 9, open: true });
  });

  it('does NOT reopen work that a later event closed', () => {
    const tl = buildTimeline(
      [
        ev({ id: 1, t: 2, type: 'ActivityTaskScheduled', detail: 'a/n1' }),
        ev({ id: 2, t: 6, dur: 4, type: 'ActivityTaskCompleted', detail: 'a/n1' }),
      ],
      20
    );
    expect(tl.running).toBe(0);
    expect(tl.lanes[0]!.bars).toHaveLength(1);
    expect(tl.lanes[0]!.bars[0]!.open).toBe(false);
  });

  it('counts failures and marks the bar', () => {
    const tl = buildTimeline([ev({ id: 1, t: 4, dur: 2, type: 'ActivityTaskFailed', detail: 'a/n1' })]);
    expect(tl.failed).toBe(1);
    expect(tl.lanes[0]!.bars[0]!.failed).toBe(true);
  });

  it('clamps a bar that began before the log did, rather than drawing off the left edge', () => {
    // An archived history can start mid-run, leaving `dur` longer than `t`.
    const tl = buildTimeline([ev({ id: 1, t: 2, dur: 30, detail: 'a/n1' })]);
    expect(tl.lanes[0]!.bars[0]!.start).toBe(0);
  });

  it('orders lanes by when their work began, so a late starter is not buried', () => {
    const tl = buildTimeline([
      ev({ id: 1, t: 9, dur: 1, detail: 'zebra' }),
      ev({ id: 2, t: 2, dur: 1, detail: 'alpha' }),
    ]);
    // By start time (alpha at 1, zebra at 8), NOT alphabetically — which would agree here by luck,
    // so the values are what is asserted.
    expect(tl.lanes.map((l) => l.bars[0]!.start)).toEqual([1, 8]);
  });

  it('an empty history is an empty timeline with a usable span, not a divide by zero', () => {
    const tl = buildTimeline([]);
    expect(tl.lanes).toHaveLength(0);
    expect(tl.span).toBe(1); // every bar is positioned as a percentage of this
  });
});

describe('short', () => {
  it('reads at every scale a run reaches', () => {
    expect(short(0.25)).toBe('250ms');
    expect(short(4.2)).toBe('4.2s');
    expect(short(42)).toBe('42s');
    expect(short(125)).toBe('2m 5s');
  });
});

describe('what counts as a failure', () => {
  /** One event, shaped like the reduced log's rows. */
  const ev = (id: number, type: string, cat: RunEvent['cat'], t: number): RunEvent =>
    ({ id, type, cat, t, dur: 0, attempt: 1, summary: '', detail: '' }) as RunEvent;

  it('does NOT count a cancelled timer, because that is what an answered ask looks like', () => {
    // MEASURED ON A LIVE RUN. `approve` starts a deadline timer for its question and cancels it
    // when the answer arrives; the run completed in 7.6s and the surface said `1 failed`, every
    // time, for every answered ask.
    const tl = buildTimeline([
      ev(1, 'WorkflowExecutionStarted', 'workflow', 0),
      ev(2, 'TimerStarted', 'timer', 0.4),
      ev(3, 'WorkflowExecutionSignaled', 'signal', 6.3),
      ev(4, 'TimerCanceled', 'timer', 6.4),
      ev(5, 'WorkflowExecutionCompleted', 'workflow', 7.6),
    ]);
    expect(tl.failed).toBe(0);
  });

  it('still counts the cancellations that ARE failures', () => {
    for (const type of [
      'ActivityTaskFailed',
      'ActivityTaskTimedOut',
      'WorkflowExecutionTerminated',
      'WorkflowExecutionCanceled',
      'ActivityTaskCancelRequested',
    ]) {
      const tl = buildTimeline([ev(1, type, 'activity', 1)]);
      expect(tl.failed, type).toBe(1);
    }
  });
});
