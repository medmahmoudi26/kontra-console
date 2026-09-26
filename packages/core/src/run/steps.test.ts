import { describe, expect, it } from 'vitest';

import {
  buildSteps,
  causes,
  isOpen,
  nameStep,
  rootCause,
  shortSeconds,
  startedAtText,
  stepClock,
  type Step,
} from './steps';
import type { RunEvent } from './api';

let nextId = 0;
const ev = (type: string, detail: string, t: number, extra: Partial<RunEvent> = {}): RunEvent => ({
  id: ++nextId,
  type,
  cat: 'activity',
  t,
  at: 0,
  detail,
  attempt: 1,
  dur: 0,
  ...extra,
});

/** One activity, as Temporal writes it: the summary is on the SCHEDULED event and nowhere else. */
const activity = (type: string, summary: string, t0: number, t1: number, ok = true): RunEvent[] => [
  ev('ActivityTaskScheduled', `activityType=${type} · taskQueue=kontra-datasets`, t0, { summary }),
  ev('ActivityTaskStarted', `activityType=${type} · identity=1@api`, t0 + 0.01),
  ev(ok ? 'ActivityTaskCompleted' : 'ActivityTaskFailed', `activityType=${type} · identity=1@api`, t1),
];

const child = (t0: number, t1: number, ok = true, error = ''): RunEvent[] => [
  ev('StartChildWorkflowExecutionInitiated', 'workflowType=stackWorkflow · taskQueue=kontra-infra', t0, {
    summary: 'fleet up kontra-fleet/c-1790194348 (1x c-1790194348)',
    cat: 'child',
    link: { workflowId: 'kontra-fleet/c-1790194348', via: 'child' },
  }),
  ev('ChildWorkflowExecutionStarted', 'workflowType=stackWorkflow', t0 + 0.02, { cat: 'child' }),
  ev(
    ok ? 'ChildWorkflowExecutionCompleted' : 'ChildWorkflowExecutionFailed',
    `workflowType=stackWorkflow${error ? ` · ${error}` : ''}`,
    t1,
    { cat: ok ? 'child' : 'failure' }
  ),
];

const nexus = (t0: number, t1: number): RunEvent[] => [
  ev('NexusOperationScheduled', 'endpoint=kontra-canary-1-0-0 · nexus=kontra.actor/run', t0, {
    summary: 'sweep · canary@1.0.0 · 2 units',
    cat: 'child',
  }),
  ev('NexusOperationStarted', 'endpoint=kontra-canary-1-0-0', t0 + 0.04, { cat: 'child' }),
  ev('NexusOperationCompleted', 'endpoint=kontra-canary-1-0-0', t1, { cat: 'child' }),
];

describe('reading a history as steps', () => {
  /**
   * THE BUG THIS MODULE EXISTS FOR, stated as a test.
   *
   * `timeline.ts` keys lanes on `summary || detail`. An activity's SCHEDULED event carries the
   * summary and its COMPLETED event does not, so the two halves keyed differently and one activity
   * drew two lanes — the second labelled with the raw `activityType=holdFleetLease`. Pairing on the
   * subject both halves actually agree on is the whole fix.
   */
  it('pairs the two halves of one activity into ONE step, not two', () => {
    nextId = 0;
    const steps = buildSteps(activity('holdFleetLease', 'hold c-1790194348', 0.09, 0.25));
    expect(steps).toHaveLength(1);
    expect(steps[0]!.subject).toBe('holdFleetLease');
    expect(steps[0]!.state).toBe('done');
    expect(steps[0]!.t0).toBeCloseTo(0.09);
    expect(steps[0]!.t1).toBeCloseTo(0.25);
  });

  /**
   * The same mismatch made the open-bar pass mark work closed under one key and look for openers
   * under another, so every FINISHED activity also emitted a bar that never closed. Measured on
   * `canary-1790194348`: three completed activities reported as `3 running`.
   */
  it('reports no step as open once its closer has landed', () => {
    nextId = 0;
    const steps = buildSteps([
      ...activity('holdFleetLease', 'hold c-1', 0.09, 0.25),
      ...activity('resolveBundle', 'resolve canary@1.0.0', 41.08, 41.2),
      ...activity('dropFleetLease', 'drop c-1', 80.14, 80.18),
    ]);
    expect(steps).toHaveLength(3);
    expect(steps.filter(isOpen)).toEqual([]);
  });

  it('leaves a step with no closer open, which is what "in flight" means', () => {
    nextId = 0;
    const steps = buildSteps([
      ...activity('holdFleetLease', 'hold c-1', 0.09, 0.25),
      ev('NexusOperationScheduled', 'endpoint=kontra-canary-1-0-0', 34.2, { summary: 'sweep · canary@1.0.0 · 2 units' }),
      ev('NexusOperationStarted', 'endpoint=kontra-canary-1-0-0', 34.27),
    ]);
    const open = steps.filter(isOpen);
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('nexus');
    expect(open[0]!.state).toBe('running');
  });

  it('reads activities, child workflows and Nexus operations as the same shape', () => {
    nextId = 0;
    const steps = buildSteps([
      ...activity('holdFleetLease', 'hold c-1', 0.1, 0.9),
      ...child(1, 10.7),
      ...nexus(34.2, 54.8),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(['activity', 'child', 'nexus']);
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  /**
   * Two `stackWorkflow` children with identical summaries — `fleet up …` both times. They are told
   * apart by POSITION and not by a guess about which is a teardown, which is the mistake
   * `vocabulary.ts` makes (`seq > 1 ? 'fleet-torn-down'`), announcing a teardown halfway through a
   * run that then keeps using the fleet.
   */
  it('numbers repeats instead of guessing what the second one means', () => {
    nextId = 0;
    const steps = buildSteps([...child(1, 10.7), ...child(10.9, 33.9)]);
    expect(steps.map((s) => s.seq)).toEqual([1, 2]);
    expect(steps.every((s) => s.repeats)).toBe(true);
    expect(nameStep(steps[1]!).title).toBe('Bring the Fleet up');
  });

  it('does not mark a subject that happens once as a repeat', () => {
    nextId = 0;
    const steps = buildSteps(activity('publishBatch', '', 54.9, 56.4));
    expect(steps[0]!.repeats).toBe(false);
    expect(steps[0]!.seq).toBe(1);
  });

  it('matches closers to openers in order when a subject recurs', () => {
    nextId = 0;
    const steps = buildSteps([
      ...activity('OpenSession', 'open a', 1, 2),
      ...activity('OpenSession', 'open b', 3, 9),
    ]);
    expect(steps.map((s) => [s.t0, s.t1])).toEqual([
      [1, 2],
      [3, 9],
    ]);
  });

  it('carries the failure onto the step that failed', () => {
    nextId = 0;
    const steps = buildSteps(child(41.2, 80.1, false, 'Activity task failed: code: -2'));
    expect(steps[0]!.state).toBe('failed');
    expect(steps[0]!.error).toContain('Activity task failed');
  });

  it('ignores an event of a known shape whose subject cannot be read', () => {
    nextId = 0;
    // No `activityType=` in the detail: this pairs with nothing, and opening a step keyed on ''
    // would let every later closer match it.
    const steps = buildSteps([ev('ActivityTaskScheduled', 'taskQueue=only', 1)]);
    expect(steps).toEqual([]);
  });

  it('is empty for a run whose first workflow task has not completed', () => {
    nextId = 0;
    expect(buildSteps([ev('WorkflowExecutionStarted', 'workflowType=Canary', 0, { cat: 'workflow' })])).toEqual([]);
  });
});

describe('naming a step', () => {
  const one = (subject: string, summary = ''): Step =>
    buildSteps(activity(subject, summary, 1, 2))[0]!;

  it('uses kontra’s own words for kontra’s own machinery', () => {
    nextId = 0;
    expect(nameStep(one('holdFleetLease', 'hold c-1')).title).toBe('Hold the Fleet lease');
    expect(nameStep(one('publishBatch')).what).toContain('lake');
  });

  /** Never `activityType=holdFleetLe…`, which is what the run page was showing. */
  it('breaks up an unknown activity type rather than printing the machinery', () => {
    nextId = 0;
    const named = nameStep(one('reticulateSplines'));
    expect(named.title).toBe('Reticulate Splines');
    expect(named.title).not.toContain('activityType');
  });

  it('reads the unit count out of a dispatch summary', () => {
    nextId = 0;
    const [sweep] = buildSteps(nexus(34.2, 54.8));
    expect(nameStep(sweep!).title).toBe('Sweep 2 units');
    expect(nameStep(sweep!).sub).toContain('canary@1.0.0');
  });

  it('says one unit in the singular', () => {
    nextId = 0;
    const steps = buildSteps([
      ev('NexusOperationScheduled', 'endpoint=e', 1, { summary: 'sweep · a@1 · 1 units' }),
      ev('NexusOperationCompleted', 'endpoint=e', 2),
    ]);
    expect(nameStep(steps[0]!).title).toBe('Sweep 1 unit');
  });

  it('keeps the machine-readable subject visible beside the friendly name', () => {
    nextId = 0;
    expect(nameStep(one('holdFleetLease', 'hold c-1')).sub).toBe('hold c-1');
    expect(nameStep(one('convergeFleetSessions')).sub).toBe('convergeFleetSessions');
  });
});

/**
 * The real failure off `canary-1790194348`, trimmed to the lines that matter. Four layers glued
 * into one string, with the only actionable sentence sixty lines down and repeated twice.
 */
const REAL_FAILURE = [
  "identity=63@kontra-api · could not place canary@1.0.0 on kontra-fleet/c-1790194348: Child Workflow execution failed. 1 Machine(s) are already up and holding this Fleet with nothing on them: Child Workflow execution failed: Activity task failed: code: -2",
  ' stderr: Command failed with exit code 1: pulumi up --yes --stack c-1790194348',
  "    pulumi:pulumi:Stack kontra-fleet-c-1790194348 running error: Unhandled exception: Error: cannot read the fleet SSH key at /root/.ssh/id_rsa (set KONTRA_SSH_KEY): ENOENT: no such file or directory",
  '        at privateKey (/src/control/orchestrator/dist/src/infra/programs/fleet.js:378:15)',
  "    error: cannot read the fleet SSH key at /root/.ssh/id_rsa (set KONTRA_SSH_KEY): ENOENT: no such file or directory",
].join('\n');

describe('unwrapping a failure', () => {
  it('leads with kontra’s own sentence and ends at the root cause', () => {
    const chain = causes(REAL_FAILURE);
    expect(chain[0]!.who).toBe('kontra');
    expect(chain[0]!.msg).toContain('could not place canary@1.0.0');
    expect(rootCause(chain)).toContain('cannot read the fleet SSH key');
    expect(rootCause(chain)).toContain('KONTRA_SSH_KEY');
  });

  it('strips the event machinery off the front of kontra’s sentence', () => {
    expect(causes(REAL_FAILURE)[0]!.msg).not.toContain('identity=');
    expect(causes('workflowType=stackWorkflow · it broke')[0]!.msg).toBe('it broke');
  });

  it('names the Temporal frames as Temporal’s, not as somebody’s explanation', () => {
    const chain = causes(REAL_FAILURE);
    const frames = chain.filter((c) => c.who === 'temporal').map((c) => c.msg);
    expect(frames).toContain('Child Workflow execution failed.');
    expect(frames).toContain('Activity task failed');
  });

  it('does not repeat the same sentence when the transcript prints it twice', () => {
    const roots = causes(REAL_FAILURE).filter((c) => c.msg.includes('fleet SSH key'));
    expect(roots).toHaveLength(1);
  });

  it('skips stack frames when hunting for the cause', () => {
    expect(rootCause(causes(REAL_FAILURE))).not.toContain('at privateKey');
  });

  it('marks exactly one entry as the root', () => {
    expect(causes(REAL_FAILURE).filter((c) => c.root)).toHaveLength(1);
  });

  it('is empty for no failure, so a healthy step draws nothing', () => {
    expect(causes('')).toEqual([]);
    expect(rootCause([])).toBe('');
  });
});

describe('formatting', () => {
  it('keeps a decimal under a minute so a fast step is not drawn as a zero-width one', () => {
    expect(shortSeconds(0.122)).toBe('122ms');
    expect(shortSeconds(41.08)).toBe('41.1s');
    expect(shortSeconds(80.4)).toBe('1m 20s');
    expect(shortSeconds(Number.NaN)).toBe('—');
  });

  it('says when a sub-second step happened rather than drawing an empty range', () => {
    nextId = 0;
    const [quick] = buildSteps(activity('resolveBundle', 'resolve', 41.08, 41.2));
    expect(stepClock(quick!, 90)).toBe('at 41.1s · 120ms');
  });

  it('draws an open step against now', () => {
    nextId = 0;
    const steps = buildSteps([ev('NexusOperationScheduled', 'endpoint=e', 34.2, { summary: 's' })]);
    expect(stepClock(steps[0]!, 42)).toBe('34.2s → now · 7.8s');
  });

  it('prints the start date, because a run id carries an epoch nobody reads', () => {
    // Local time by construction — the operator's clock is the one they are comparing against.
    const d = new Date(2026, 8, 23, 19, 22, 58);
    expect(startedAtText(d.getTime())).toBe('23 Sep 2026 · 19:22:58');
  });

  it('says nothing for a run with no start instant, rather than 1 Jan 1970', () => {
    expect(startedAtText(0)).toBe('');
    expect(startedAtText(Number.NaN)).toBe('');
  });
});
