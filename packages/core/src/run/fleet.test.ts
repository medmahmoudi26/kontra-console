import { sharedQueue, workerIdentity } from '@kontra/core/queues';
import { describe, expect, it } from 'vitest';

import type { PollerReading, StackStateWire } from '../infra/machines';
import type { RunEvent } from './api';
import {
  cursorOf,
  deriveRack,
  fleetStacksOf,
  machineExists,
  parseUrn,
  resourceRole,
  STACK_WORKFLOW,
  type FleetLink,
  type RackInput,
  type StackOpWire,
} from './fleet';

const NOW = 1_800_000_000_000;
const FQN = 'kontra-fleet/recon-s4';

/**
 * A URN exactly as `activities/infra.ts` heartbeats it — built from the shape Pulumi emits rather
 * than typed, so the two halves of `parseUrn` cannot drift apart in a fixture.
 */
const urn = (type: string, name: string): string =>
  `urn:pulumi:recon-s4::kontra-fleet::${type}::${name}`;
const DROPLET = 'digitalocean:index/droplet:Droplet';
const COMMAND = 'command:remote:Command';

let nextId = 1;
function ev(over: Partial<RunEvent>): RunEvent {
  return {
    id: nextId++,
    type: 'ChildWorkflowExecutionStarted',
    cat: 'child',
    t: 0,
    at: NOW,
    detail: '',
    attempt: 1,
    dur: 0,
    ...over,
  };
}

/** The three events one Fleet child produces, as the reducer emits them. */
function child(
  fqn: string,
  execId: string,
  opts: { t0?: number; close?: string; dur?: number } = {}
): RunEvent[] {
  const link = { workflowId: fqn, execId, via: 'child' as const };
  const out: RunEvent[] = [
    ev({
      type: 'StartChildWorkflowExecutionInitiated',
      t: opts.t0 ?? 1,
      link: { ...link, type: STACK_WORKFLOW },
    }),
    // DELIBERATELY CARRIES NO `type`. Only the Initiated event reliably names a workflowType; if the
    // reader needed it on every event, a Fleet would be found and never seen to close.
    ev({ type: 'ChildWorkflowExecutionStarted', t: (opts.t0 ?? 1) + 0.2, link }),
  ];
  if (opts.close) {
    out.push(ev({ type: opts.close, t: (opts.t0 ?? 1) + (opts.dur ?? 30), dur: opts.dur ?? 30, link }));
  }
  return out;
}

/** A checkpoint holding `machines` Droplets, with `placements` echoed in the outputs. */
function wire(over: {
  tag?: string;
  machines?: string[];
  planned?: number;
  placements?: Array<{ actorName: string; actorVersion: string; bundleSha?: string; workers?: number }>;
} = {}): StackStateWire {
  const tag = over.tag ?? 'recon';
  const names = over.machines ?? [];
  return {
    fqn: FQN,
    project: 'kontra-fleet',
    stack: 'recon-s4',
    outputs: {
      tag,
      ...(over.planned === undefined ? {} : { machines: over.planned }),
      ...(over.placements === undefined ? {} : { placements: over.placements }),
      inventory: Object.fromEntries(names.map((n) => [n, { name: n, size: 's-2vcpu-4gb' }])),
    },
    resources: names.map((name) => ({
      urn: urn(DROPLET, name),
      type: DROPLET,
      name,
      synthetic: false,
      created: '2026-09-28T21:56:00Z',
      detail: { name, region: 'sfo3', size: 's-2vcpu-4gb', status: 'active', priceMonthly: 24 },
    })),
  };
}

/**
 * One Worker polling one Actor's shared queue.
 *
 * THE QUEUE NAME IS DERIVED, NEVER TYPED. `sharedQueue` is the cross-language rule
 * `shared/conformance/queues.json` holds four implementations to, and `deriveMachines` calls it to
 * decide which report belongs to which Placement. A fixture that spelled the name by hand would
 * still pass the day the rule changed — and it already caught this test out: `webcrawl-0.2.3-shared`
 * looks right and the `-shared` suffix is only used when there is NO version.
 */
function poller(host: string, actor: string, version: string, lastPoll = NOW - 1_000): PollerReading {
  const queue = sharedQueue(actor, version);
  return { queue, workers: [{ identity: workerIdentity(41, host, queue), lastPoll }] };
}

/** Poller reports keyed the way `/api/pollers` keys them: by queue. */
function reports(...rows: PollerReading[]): Record<string, PollerReading> {
  return Object.fromEntries(rows.map((r) => [r.queue!, r]));
}

function rack(over: Partial<RackInput> = {}) {
  return deriveRack({ links: [], wires: {}, ops: {}, pollers: {}, now: NOW, ...over });
}

// ── fleetStacksOf ────────────────────────────────────────────────────────────────────────────────

describe('fleetStacksOf', () => {
  it('finds a Fleet child by its workflow TYPE, not by its id’s prefix', () => {
    const events = child('some-other-project/anything', 'e1');
    expect(fleetStacksOf(events).map((l) => l.fqn)).toEqual(['some-other-project/anything']);
  });

  it('ignores a child that is not a stackWorkflow, however its id is spelled', () => {
    // A campaign's sub-workflows are children too, and one of them could be named anything.
    const events = [
      ev({
        type: 'StartChildWorkflowExecutionInitiated',
        link: { workflowId: 'kontra-fleet/looks-like-one', via: 'child', type: 'surfaceWorkflow' },
      }),
    ];
    expect(fleetStacksOf(events)).toEqual([]);
  });

  it('learns the type once and applies it to the events that do not repeat it', () => {
    // THE BUG THIS PINS. Only the Initiated event reliably names a workflowType. A reader that
    // required it on every event would find the Fleet, never see it close, and report a converge
    // still running twenty minutes after it finished.
    const [found] = fleetStacksOf(child(FQN, 'e1', { close: 'ChildWorkflowExecutionCompleted', dur: 214 }));
    expect(found!.closed).toBe(true);
    expect(found!.failed).toBe(false);
    expect(found!.dur).toBe(214);
  });

  it('reads every way a child can end, and which of them are failures', () => {
    for (const [type, failed] of [
      ['ChildWorkflowExecutionCompleted', false],
      ['ChildWorkflowExecutionFailed', true],
      ['ChildWorkflowExecutionCanceled', true],
      ['ChildWorkflowExecutionTimedOut', true],
      ['ChildWorkflowExecutionTerminated', true],
      ['StartChildWorkflowExecutionFailed', true],
    ] as const) {
      const [l] = fleetStacksOf(child(FQN, 'e1', { close: type }));
      expect([type, l!.closed, l!.failed]).toEqual([type, true, failed]);
    }
  });

  it('keeps a bring-up and its teardown APART, because they share a workflow id', () => {
    // `kontra-fleet/recon-s4` is the id of both. Keying on the id alone folds them into one row whose
    // duration came from the bring-up and whose outcome came from the teardown.
    const events = [
      ...child(FQN, 'up-exec', { t0: 1, close: 'ChildWorkflowExecutionCompleted', dur: 214 }),
      ...child(FQN, 'down-exec', { t0: 900, close: 'ChildWorkflowExecutionFailed', dur: 29 }),
    ];
    const found = fleetStacksOf(events);
    expect(found).toHaveLength(2);
    expect(found.map((l) => [l.execId, l.dur, l.failed])).toEqual([
      ['up-exec', 214, false],
      ['down-exec', 29, true],
    ]);
  });

  it('refuses an id that is not <project>/<stack>', () => {
    // An fqn is what the state read is addressed by; inventing one points it at a path that is not
    // there, and a nested one would point it OUT of the state directory.
    for (const id of ['nofleet', 'a/b/c', '']) {
      expect(fleetStacksOf([ev({ link: { workflowId: id, via: 'child', type: STACK_WORKFLOW } })])).toEqual([]);
    }
  });

  it('keeps the run’s own order', () => {
    const events = [...child('kontra-fleet/recon', 'a', { t0: 1 }), ...child('kontra-fleet/cl0', 'b', { t0: 5 })];
    expect(fleetStacksOf(events).map((l) => l.fqn)).toEqual(['kontra-fleet/recon', 'kontra-fleet/cl0']);
  });
});

// ── the cursor ───────────────────────────────────────────────────────────────────────────────────

describe('parseUrn and resourceRole', () => {
  it('reads the type and the name off a urn, and refuses anything that is not one', () => {
    expect(parseUrn(urn(DROPLET, 'kf-recon-03'))).toEqual({ type: DROPLET, name: 'kf-recon-03' });
    // A `{changes}` heartbeat has no urn in it at all — `activities/infra.ts` sends one or the other.
    expect(parseUrn(undefined)).toBeUndefined();
    expect(parseUrn('kf-recon-03')).toBeUndefined();
    expect(parseUrn('urn:pulumi:short')).toBeUndefined();
  });

  it('splits a Placement’s name into the Machine it is on and the Actor it places', () => {
    // `programs/fleet.ts` composes it as `${m.name}-actor-${actor.name}`, so this reads the server's
    // own composition rather than matching a pattern.
    expect(resourceRole('kf-recon-01-actor-webcrawl')).toEqual({
      machine: 'kf-recon-01',
      actor: 'webcrawl',
    });
    expect(resourceRole('kf-recon-01')).toEqual({ machine: 'kf-recon-01' });
    // A provider or a synthetic is not a box, and a cursor on one must not point at a Machine.
    expect(resourceRole('default_4_5_0')).toEqual({});
    expect(resourceRole('kontra-fleet')).toEqual({});
  });

  it('folds a live heartbeat into a cursor', () => {
    const c = cursorOf({ cursor: { op: 'create', urn: urn(COMMAND, 'kf-recon-02-actor-desync') } });
    expect(c).toEqual({
      op: 'create',
      type: COMMAND,
      name: 'kf-recon-02-actor-desync',
      machine: 'kf-recon-02',
      actor: 'desync',
    });
  });

  it('has no cursor when nothing reported a resource', () => {
    // `{phase: 'starting'}` is what `getProgress` answers for the whole first stretch of a converge,
    // and `{changes: …}` is a real heartbeat frame with no resource in it — `stackUp` sends one or
    // the other. Neither is a cursor.
    expect(cursorOf({ progress: { phase: 'starting', op: 'up' } })).toBeUndefined();
    expect(cursorOf({ cursor: { changes: { create: 5 } } })).toBeUndefined();
    expect(cursorOf({})).toBeUndefined();
    expect(cursorOf(undefined)).toBeUndefined();
  });

  it('reads the urn off `cursor`, and off `progress` only for an older control plane', () => {
    // THE FIELD THE ROUTE PROMISED AND DID NOT SEND. `readStackOp`'s comment said `progress` was
    // "the last heartbeat from the engine — which resource it is on"; `getProgress` is a query over
    // a workflow variable and the URN was on the pending ACTIVITY, unread. The fallback is for a
    // console deployed ahead of its orchestrator, not for a shape that occurs.
    const fresh = cursorOf({ cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-03') } });
    expect(fresh).toMatchObject({ op: 'create', machine: 'kf-recon-03' });

    const older = cursorOf({ progress: { phase: 'running', op: 'create', urn: urn(DROPLET, 'kf-recon-03') } });
    expect(older).toMatchObject({ op: 'create', machine: 'kf-recon-03' });

    // THE TWO `op`s ARE DIFFERENT VOCABULARIES and must never be mixed: `progress.op` is the
    // WORKFLOW's (`up`/`destroy`/`preview`) and `cursor.op` is PULUMI's for one resource. Taking the
    // verb from the bag that has no urn would draw `destroy kf-recon-03` for a Machine being made.
    const both = cursorOf({
      progress: { phase: 'running', op: 'destroy' },
      cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-03') },
    });
    expect(both!.op).toBe('create');
  });
});

// ── the rack ─────────────────────────────────────────────────────────────────────────────────────

const LINK: FleetLink = { fqn: FQN, execId: 'up-exec', t0: 1, at: NOW, dur: 0, closed: false, failed: false };

describe('deriveRack', () => {
  it('draws only the Fleets this run started', () => {
    const r = rack({
      links: [LINK],
      wires: { [FQN]: wire({ machines: ['kf-recon-01'] }), 'kontra-fleet/somebody-else': wire() },
    });
    expect(r.fleets.map((f) => f.fqn)).toEqual([FQN]);
  });

  it('draws a Machine the converge asked for before the checkpoint holds it', () => {
    // THE REASON THIS MODULE EXISTS. A bring-up is mostly the period before the boxes are there, and
    // a rack that draws nothing for four minutes reads as a hang.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: wire({ planned: 4, machines: ['kf-recon-01', 'kf-recon-02'] }) },
      ops: {
        [FQN]: {
          status: 'RUNNING',
          progress: { phase: 'running', op: 'up' },
          cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-03') },
        },
      },
    });
    const f = r.fleets[0]!;
    expect(f.machines.map((m) => [m.name, m.life])).toEqual([
      ['kf-recon-01', 'up'],
      ['kf-recon-02', 'up'],
      ['kf-recon-03', 'creating'], // the engine's cursor is on it THIS second
      ['kf-recon-04', 'planned'],
    ]);
    expect(f.planned).toBe(4);
    // ONLY THE BOXES THAT EXIST ARE COUNTED, and `creating` is not one of them: a provider call in
    // flight has booted nothing and is billing nothing. Counting it would make the headline jump
    // forward and then sit still while the box it already counted finished coming up.
    expect(r.machines).toBe(2);
    expect(f.machines.map((m) => machineExists(m.life))).toEqual([true, true, false, false]);
  });

  it('draws the Machine the cursor names even when the Fleet has no `machines` output yet', () => {
    // THE GAP A BROWSER FOUND. On a FIRST converge there are no stack outputs — Pulumi writes them
    // when an `up` completes — so there is no `planned` list, and a Machine being created is in no
    // checkpoint either (the resource is written after the provider makes it). With the cursor read
    // only over Machines the checkpoint already held, `creating` could not appear at all until a
    // Fleet had converged once: the most eventful minute of the very run somebody is watching drew
    // two static boxes.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: { fqn: FQN, resources: wire({ machines: ['kf-recon-01', 'kf-recon-02'] }).resources } },
      ops: { [FQN]: { status: 'RUNNING', cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-03') } } },
    });
    expect(r.fleets[0]!.machines.map((m) => [m.name, m.life])).toEqual([
      ['kf-recon-01', 'up'],
      ['kf-recon-02', 'up'],
      ['kf-recon-03', 'creating'],
    ]);
    // Still no denominator — one box appearing is not a total.
    expect(r.fleets[0]!.planned).toBeUndefined();
    // …and it is not counted as existing: the provider call is still in flight.
    expect(r.machines).toBe(2);
  });

  it('does not invent a Machine from a cursor that is installing a Worker', () => {
    // A Placement's resource name CONTAINS its Machine's, so `kf-recon-09-actor-webcrawl` names a
    // Machine — one the checkpoint does not hold, because a Placement cannot run before its Droplet
    // exists. Adding a box for it would draw a Machine that is not being created by anything.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: { fqn: FQN, resources: wire({ machines: ['kf-recon-01'] }).resources } },
      ops: { [FQN]: { status: 'RUNNING', cursor: { op: 'create', urn: urn(COMMAND, 'kf-recon-09-actor-webcrawl') } } },
    });
    expect(r.fleets[0]!.machines.map((m) => m.name)).toEqual(['kf-recon-01']);
  });

  it('leaves `planned` ABSENT mid-first-converge rather than inventing a denominator', () => {
    // Pulumi writes stack outputs when an `up` COMPLETES; resources are written as each is created.
    // So mid-first-bring-up there is no total, and "2 of 2" under a converge that will make four is a
    // wrong answer that renders.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: { fqn: FQN, resources: wire({ machines: ['kf-recon-01', 'kf-recon-02'] }).resources } },
      ops: { [FQN]: { status: 'RUNNING', progress: { phase: 'running', op: 'up' } } },
    });
    expect(r.fleets[0]!.planned).toBeUndefined();
    expect(r.planned).toBeUndefined();
    expect(r.fleets[0]!.machines).toHaveLength(2);
  });

  it('puts the Actors on the Machine, with their own poll state', () => {
    const r = rack({
      links: [LINK],
      wires: {
        [FQN]: wire({
          planned: 2,
          machines: ['kf-recon-01', 'kf-recon-02'],
          placements: [{ actorName: 'webcrawl', actorVersion: '0.2.3', bundleSha: 'a'.repeat(64) }],
        }),
      },
      pollers: reports(poller('kf-recon-01', 'webcrawl', '0.2.3')),
    });
    const [one, two] = r.fleets[0]!.machines;
    expect(one!.actors.map((a) => [a.name, a.version, a.state])).toEqual([['webcrawl', '0.2.3', 'serving']]);
    // The Placement converged onto BOTH Machines; only one is polling. `nothing-polling` under a box
    // that exists is the most actionable line on the page and must not be rounded off.
    expect(two!.actors[0]!.state).toBe('nothing-polling');
    expect(one!.actors[0]!.bundleSha).toBe('a'.repeat(64));
  });

  it('says which Worker the engine is installing right now', () => {
    const r = rack({
      links: [LINK],
      wires: {
        [FQN]: wire({
          planned: 2,
          machines: ['kf-recon-01', 'kf-recon-02'],
          placements: [{ actorName: 'webcrawl', actorVersion: '0.2.3' }],
        }),
      },
      ops: {
        [FQN]: {
          status: 'RUNNING',
          progress: { phase: 'running', op: 'up' },
          cursor: { op: 'create', urn: urn(COMMAND, 'kf-recon-02-actor-webcrawl') },
        },
      },
    });
    const [one, two] = r.fleets[0]!.machines;
    expect(one!.actors[0]!.placing).toBe(false);
    expect(two!.actors[0]!.placing).toBe(true);
    // A Machine whose PLACEMENT is being installed is up, not `creating` — the box already exists.
    expect(two!.life).toBe('up');
  });

  it('shows a Machine being torn down during a destroy', () => {
    const r = rack({
      links: [{ ...LINK, execId: 'down-exec' }],
      wires: { [FQN]: wire({ planned: 2, machines: ['kf-recon-01', 'kf-recon-02'] }) },
      ops: {
        [FQN]: {
          status: 'RUNNING',
          progress: { phase: 'running', op: 'destroy' },
          cursor: { op: 'delete', urn: urn(DROPLET, 'kf-recon-02') },
        },
      },
    });
    expect(r.fleets[0]!.machines.map((m) => m.life)).toEqual(['up', 'destroying']);
    expect(r.fleets[0]!.op).toBe('destroy');
  });

  it('reads a REPLACEMENT as a teardown even inside an `up`', () => {
    // `delete` beats the operation name: what the engine says about THIS resource is more specific
    // than what the workflow says about the stack.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: wire({ planned: 1, machines: ['kf-recon-01'] }) },
      ops: {
        [FQN]: {
          status: 'RUNNING',
          progress: { phase: 'running', op: 'up' },
          cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-01') },
        },
      },
    });
    expect(r.fleets[0]!.machines[0]!.life).toBe('creating');

    const replacing = rack({
      links: [LINK],
      wires: { [FQN]: wire({ planned: 1, machines: ['kf-recon-01'] }) },
      ops: {
        [FQN]: {
          status: 'RUNNING',
          progress: { phase: 'running', op: 'up' },
          cursor: { op: 'delete', urn: urn(DROPLET, 'kf-recon-01') },
        },
      },
    });
    expect(replacing.fleets[0]!.machines[0]!.life).toBe('destroying');
  });

  it('is converging on TEMPORAL’s status, never on the stored phase alone', () => {
    // THE WEDGE THIS PINS. A `stackWorkflow` whose worker died answers `phase: running` for ever —
    // that is a value stored in a workflow that is not moving. `status` comes from `describe`.
    const wedged = rack({
      links: [{ ...LINK, closed: true, failed: true }],
      wires: { [FQN]: wire({ planned: 1, machines: [] }) },
      ops: { [FQN]: { status: 'FAILED', progress: { phase: 'running', op: 'up' } } },
    });
    expect(wedged.fleets[0]!.converging).toBe(false);
    expect(wedged.fleets[0]!.failed).toBe(true);
    expect(wedged.converging).toBe(false);
    // …and a Machine that was asked for, is not there, and is not being built, is gone — not pending
    // for ever under a converge that has stopped.
    expect(wedged.fleets[0]!.machines.map((m) => m.life)).toEqual(['gone']);
  });

  it('sums the price only over Machines that exist, and treats 0 as unknown', () => {
    // `programs/fleet.ts` is explicit: a failed price lookup is 0, and 0 means unknown, never free.
    const r = rack({
      links: [LINK],
      wires: { [FQN]: wire({ planned: 4, machines: ['kf-recon-01', 'kf-recon-02'] }) },
      ops: { [FQN]: { status: 'RUNNING', progress: { phase: 'running', op: 'up' } } },
    });
    expect(r.priceMonthly).toBe(48); // two boxes at 24, and the two planned ones cost nothing yet
  });

  it('draws a Fleet whose state could not be read, rather than dropping it', () => {
    // A link with no checkpoint is a converge that started and whose stack has never been written —
    // or a read that failed. Either way the run DID start it, and a rack that omitted it would say
    // this run stood nothing up.
    const r = rack({ links: [LINK], ops: { [FQN]: { status: 'RUNNING', progress: { phase: 'starting', op: 'up' } } } });
    expect(r.fleets).toHaveLength(1);
    expect(r.fleets[0]!.machines).toEqual([]);
    expect(r.fleets[0]!.phase).toBe('starting');
    expect(r.fleets[0]!.tag).toBe('');
  });

  it('attributes a poller across ALL the run’s Fleets in one fold', () => {
    // `deriveMachines` needs every Machine name at once to decide whether a poller is attributable.
    // Folding one stack at a time would put a Fleet's own Workers in the unattributed bucket for the
    // stacks that were not in front of it.
    const CL0 = 'kontra-fleet/cl0-s1';
    const r = rack({
      links: [LINK, { ...LINK, fqn: CL0, execId: 'cl0-exec' }],
      wires: {
        [FQN]: wire({ planned: 1, machines: ['kf-recon-01'], placements: [{ actorName: 'webcrawl', actorVersion: '0.2.3' }] }),
        [CL0]: {
          ...wire({ planned: 1, machines: ['kf-cl0-01'], tag: 'cl0', placements: [{ actorName: 'desync', actorVersion: '1.3.2' }] }),
          fqn: CL0,
          stack: 'cl0-s1',
        },
      },
      pollers: reports(
        poller('kf-recon-01', 'webcrawl', '0.2.3'),
        poller('kf-cl0-01', 'desync', '1.3.2')
      ),
    });
    expect(r.fleets.map((f) => f.machines[0]!.actors[0]!.state)).toEqual(['serving', 'serving']);
    expect(r.machines).toBe(2);
    expect(r.planned).toBe(2);
  });
});
