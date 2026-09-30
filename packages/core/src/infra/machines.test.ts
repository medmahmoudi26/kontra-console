import { POLL_FRESH_MS, workerIdentity } from '@kontra/core/queues';
import { describe, expect, it } from 'vitest';

import { imageKey } from './drift';
import type { ConvergeWire } from './history';
import {
  CONTROL_PROJECT,
  deriveMachines,
  narrowStack,
  pollFor,
  POLL_STATES,
  stateWord,
  type MachineInput,
  type PollerReading,
  type StackReading,
} from './machines';

/**
 * The four states ADR 0052 §6 forbids rounding off, plus the fifth `pollers.ts` refuses to fold into
 * them, and the one structural property this module exists for: a Machine's row is derived from its
 * OWN identity, so it cannot show a neighbour's verdict.
 *
 * THE IDENTITIES ARE BUILT WITH `workerIdentity`, NOT TYPED. `identityHost(workerIdentity(...))` is
 * the property the producer and the parser are one contract about (`@kontra/core/queues:84-90`); a
 * test that hand-wrote `'7@kf-dns-01@q'` would still pass the day the shape changed.
 */
const NOW = 1_800_000_000_000;

/** Two digests in the shape `resolveWorkerImage` returns — `<advertised>/<actor>@sha256:<64 hex>`.
 *  `drift.test.ts` holds the parsing; here they only need to be two distinguishable pins. */
const PINNED = `sha256:${'a'.repeat(64)}`;
const NEWER = `sha256:${'b'.repeat(64)}`;

const fresh = NOW - 1_000;
const old = NOW - POLL_FRESH_MS - 1_000;

function fleet(machines: string[], placements: StackReading['placements']): StackReading {
  return {
    fqn: `kontra-fleet/dns`,
    project: 'kontra-fleet',
    stack: 'dns',
    machines: machines.map((name) => ({ name, size: 's-2vcpu-4gb', region: 'nyc3' })),
    placements,
  };
}

function report(workers: Array<[host: string, lastPoll: number]>, queue = 'nscheck-0.1.0'): PollerReading {
  return {
    queue,
    workers: workers.map(([host, lastPoll]) => ({ identity: workerIdentity(41, host, queue), lastPoll })),
  };
}

function input(over: Partial<MachineInput> = {}): MachineInput {
  return { stacks: [], assignments: [], pollers: {}, now: NOW, ...over };
}

describe('the five poll states, kept apart', () => {
  it('names them all and gives each a word without jargon punctuation', () => {
    expect(POLL_STATES).toEqual(['serving', 'stale', 'undated', 'nothing-polling', 'unknown']);
    expect(stateWord('nothing-polling')).toBe('nothing polling');
    expect(stateWord('serving')).toBe('serving');
  });

  it('a poll inside the window is serving and one outside it is stale', () => {
    expect(pollFor('kf-dns-01', report([['kf-dns-01', fresh]]), NOW).state).toBe('serving');
    expect(pollFor('kf-dns-01', report([['kf-dns-01', old]]), NOW).state).toBe('stale');
  });

  it('the boundary is POLL_FRESH_MS and it is inclusive, as pollIsFresh has it', () => {
    expect(pollFor('m', report([['m', NOW - POLL_FRESH_MS]]), NOW).state).toBe('serving');
    expect(pollFor('m', report([['m', NOW - POLL_FRESH_MS - 1]]), NOW).state).toBe('stale');
  });

  it('lastPoll 0 is undated — neither fresh nor stale', () => {
    const p = pollFor('kf-dns-01', report([['kf-dns-01', 0]]), NOW);
    expect(p.state).toBe('undated');
    // The identity is still carried: Temporal DID list it, which is the whole difference from
    // `nothing-polling`.
    expect(p.identity).toContain('kf-dns-01');
  });

  it('no identity at all is nothing-polling, and carries no identity', () => {
    const p = pollFor('kf-dns-01', report([['kf-dns-02', fresh]]), NOW);
    expect(p.state).toBe('nothing-polling');
    expect(p.identity).toBeUndefined();
  });

  it('a describe error is unknown and never nothing-polling', () => {
    // `pollers.ts`: "`unknown` is never `none`." Folding this into `nothing-polling` would draw a red
    // Fleet for an unreachable cluster and send an operator to restart Workers that are fine.
    const p = pollFor('kf-dns-01', { queue: 'q', workers: [], error: 'DEADLINE_EXCEEDED' }, NOW);
    expect(p.state).toBe('unknown');
    expect(p.unknown).toBe('DEADLINE_EXCEEDED');
  });

  it('a queue nobody reported is unknown, not nothing-polling', () => {
    // The distinction the catalog loader's `degraded` list is for: an absent report is not an empty
    // one. A 404 swallowed into `{}` is what made every actor on the Actors page read UNKNOWN once.
    expect(pollFor('kf-dns-01', undefined, NOW).state).toBe('unknown');
  });

  it('two PIDs on one Machine fold to the freshest, because a restart leaves the old one listed', () => {
    const p = pollFor('kf-dns-01', report([['kf-dns-01', old], ['kf-dns-01', fresh]]), NOW);
    expect(p.state).toBe('serving');
    expect(p.lastPoll).toBe(fresh);
  });
});

describe("a Machine's row is derived from its own identity", () => {
  /**
   * THE ONE PROPERTY THIS MODULE EXISTS FOR. `QueueState.lastPoll` is the freshest poll ACROSS the
   * queue, so on a Fleet it is twelve Machines' answer drawn under one of them. Here `kf-dns-01` is
   * serving and `kf-dns-02` is not polling at all on the SAME queue — a reader of `lastPoll` would
   * call both of them serving.
   */
  it('does not inherit a neighbour on the same queue', () => {
    const view = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01', 'kf-dns-02'], [{ actor: 'nscheck', version: '0.1.0' }])],
        pollers: { 'nscheck-0.1.0': { ...report([['kf-dns-01', fresh]]), lastPoll: fresh } },
      })
    );
    const [one, two] = view.fleets[0]!.machines;
    expect(one!.serving[0]!.state).toBe('serving');
    expect(two!.serving[0]!.state).toBe('nothing-polling');
  });

  it('keys every row on the machine+queue pair it was folded from', () => {
    const view = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01', 'kf-dns-02'], [{ actor: 'nscheck', version: '0.1.0' }])],
        pollers: { 'nscheck-0.1.0': report([['kf-dns-01', fresh]]) },
      })
    );
    const rows = view.fleets[0]!.machines.flatMap((m) => m.serving);
    expect(rows.map((r) => r.key)).toEqual(['kf-dns-01::nscheck-0.1.0', 'kf-dns-02::nscheck-0.1.0']);
    // Every row's `machine` is the half of its own key, so a row cannot be rendered under a box it
    // was not folded for.
    for (const r of rows) expect(r.key).toBe(`${r.machine}::${r.queue}`);
  });

  it('all four states render on one Fleet at once, one per Machine', () => {
    const view = deriveMachines(
      input({
        stacks: [
          fleet(
            ['kf-dns-01', 'kf-dns-02', 'kf-dns-03', 'kf-dns-04'],
            [{ actor: 'nscheck', version: '0.1.0' }]
          ),
        ],
        pollers: {
          'nscheck-0.1.0': report([
            ['kf-dns-01', fresh],
            ['kf-dns-02', old],
            ['kf-dns-03', 0],
            // kf-dns-04 is absent: the Placement converged and nothing is polling.
          ]),
        },
      })
    );
    expect(view.fleets[0]!.machines.map((m) => m.serving[0]!.state)).toEqual([
      'serving',
      'stale',
      'undated',
      'nothing-polling',
    ]);
  });
});

describe('a Placement lands on the first N Machines in name order', () => {
  it('slices a short placement rather than spreading it', () => {
    // `programs/fleet.ts:131-135` — the prefix is a decision, so a scale-up adds Workers and never
    // relocates one. A console that spread it would draw the Worker under the wrong box.
    const view = deriveMachines(
      input({
        // Deliberately out of order on the way in: the derivation sorts.
        stacks: [
          fleet(['kf-dns-03', 'kf-dns-01', 'kf-dns-04', 'kf-dns-02'], [
            { actor: 'subfinder', version: '0.2.1', workers: 2 },
          ]),
        ],
      })
    );
    const machines = view.fleets[0]!.machines;
    expect(machines.map((m) => m.name)).toEqual(['kf-dns-01', 'kf-dns-02', 'kf-dns-03', 'kf-dns-04']);
    expect(machines.map((m) => m.serving.length)).toEqual([1, 1, 0, 0]);
  });

  it('an absent worker count is every Machine', () => {
    const view = deriveMachines(
      input({ stacks: [fleet(['a', 'b', 'c'], [{ actor: 'nscheck', version: '0.1.0' }])] })
    );
    expect(view.fleets[0]!.machines.map((m) => m.serving.length)).toEqual([1, 1, 1]);
  });

  it('a Placement on a stack with no Machines is declared, not dropped', () => {
    const view = deriveMachines(
      input({
        stacks: [fleet([], [{ actor: 'nscheck', version: '0.1.0' }])],
        pollers: { 'nscheck-0.1.0': report([]) },
      })
    );
    expect(view.fleets[0]!.machines).toEqual([]);
    expect(view.fleets[0]!.declared.map((r) => [r.queue, r.state])).toEqual([
      ['nscheck-0.1.0', 'nothing-polling'],
    ]);
  });
});

describe('the control stack renders the queues queueAssignments gives it', () => {
  const control: StackReading = {
    fqn: `${CONTROL_PROJECT}/local`,
    project: CONTROL_PROJECT,
    stack: 'local',
    machines: [{ name: 'orchestrator-api' }, { name: 'postgres' }, { name: 'redis' }],
    placements: [],
  };

  /** Exactly what `roles.ts:queueAssignments(['materializer','infra'])` returns, plus the slot count. */
  const assignments = [
    {
      role: 'materializer',
      purpose: 'dataset write, paging and retention',
      queue: 'kontra-datasets',
      variable: 'KONTRA_DATASET_QUEUE',
      slots: 1,
    },
    {
      role: 'infra',
      purpose: 'the controller-pinned workflows',
      queue: 'kontra-infra',
      variable: 'KONTRA_INFRA_QUEUE',
    },
  ];

  it('splits on the project, and the control half is the host engine s', () => {
    const view = deriveMachines(input({ stacks: [control, fleet(['kf-dns-01'], [])] }));
    expect(view.control.map((s) => s.fqn)).toEqual([`${CONTROL_PROJECT}/local`]);
    expect(view.fleets.map((s) => s.fqn)).toEqual(['kontra-fleet/dns']);
    expect(view.machines).toBe(4);
  });

  it('the materializer is ONE row, and KONTRA_DATASET_SLOTS is beside its poll state', () => {
    const view = deriveMachines(
      input({
        stacks: [control],
        assignments,
        pollers: { 'kontra-datasets': report([['orchestrator-api', fresh]], 'kontra-datasets') },
      })
    );
    const api = view.control[0]!.machines.find((m) => m.name === 'orchestrator-api')!;
    expect(api.serving.map((r) => r.queue)).toEqual(['kontra-datasets']);
    expect(api.serving[0]!.state).toBe('serving');
    expect(api.serving[0]!.notes).toContain('1 activity slot (KONTRA_DATASET_SLOTS)');
    expect(api.serving[0]!.title).toBe('dataset write, paging and retention');
  });

  it('attributes a role queue only to the container its poller names', () => {
    // Spreading role rows across all three containers would draw `nothing polling` under `postgres`
    // and `redis`, which poll nothing and never will.
    const view = deriveMachines(
      input({
        stacks: [control],
        assignments,
        pollers: { 'kontra-datasets': report([['orchestrator-api', fresh]], 'kontra-datasets') },
      })
    );
    expect(view.control[0]!.machines.map((m) => [m.name, m.serving.length])).toEqual([
      ['orchestrator-api', 1],
      ['postgres', 0],
      ['redis', 0],
    ]);
  });

  it('a role queue nobody polls is declared with nothing polling, and one nobody could ask about is unknown', () => {
    const view = deriveMachines(
      input({
        stacks: [control],
        assignments,
        pollers: { 'kontra-infra': { queue: 'kontra-infra', workers: [], error: 'UNAVAILABLE' } },
      })
    );
    expect(view.control[0]!.declared.map((r) => [r.queue, r.state])).toEqual([
      ['kontra-datasets', 'unknown'], // never reported at all
      ['kontra-infra', 'unknown'], // reported, and the describe failed
    ]);
    expect(view.control[0]!.declared[1]!.unknown).toBe('UNAVAILABLE');
  });

  it('draws no queue row at all when the assignments could not be read', () => {
    // The console does not get to guess. A hardcoded list would have shipped a page showing
    // `kontra-materializer`, removed 2026-09-26 as uncalled.
    const view = deriveMachines(input({ stacks: [control], assignments: [] }));
    expect(view.control[0]!.declared).toEqual([]);
    expect(view.control[0]!.machines.flatMap((m) => m.serving)).toEqual([]);
  });
});

describe('unattributed pollers are shown, not dropped', () => {
  const stacks = [fleet(['kf-dns-01'], [{ actor: 'nscheck', version: '0.1.0' }])];

  it('a poller whose host is no Machine gets its own row', () => {
    const view = deriveMachines(
      input({
        stacks,
        pollers: {
          'nscheck-0.1.0': report([
            ['kf-dns-01', fresh],
            ['dev-laptop', fresh],
          ]),
        },
      })
    );
    // Without this bucket a one-Machine Fleet reports two pollers and loses one of them.
    expect(view.fleets[0]!.machines[0]!.serving[0]!.state).toBe('serving');
    expect(view.unattributed.map((u) => [u.host, u.queue, u.state, u.parsed])).toEqual([
      ['dev-laptop', 'nscheck-0.1.0', 'serving', true],
    ]);
  });

  it('an identity that does not parse is unattributed and says so, rather than vanishing', () => {
    const view = deriveMachines(
      input({
        stacks,
        pollers: {
          'nscheck-0.1.0': { queue: 'nscheck-0.1.0', workers: [{ identity: 'ci-runner-7', lastPoll: 0 }] },
        },
      })
    );
    expect(view.unattributed).toEqual([
      {
        key: 'nscheck-0.1.0::ci-runner-7',
        identity: 'ci-runner-7',
        queue: 'nscheck-0.1.0',
        state: 'undated',
        lastPoll: 0,
        parsed: false,
      },
    ]);
  });

  it('a Machine in the OTHER half attributes, so it is not reported as unattributed', () => {
    const view = deriveMachines(
      input({
        stacks: [
          ...stacks,
          {
            fqn: `${CONTROL_PROJECT}/local`,
            project: CONTROL_PROJECT,
            stack: 'local',
            machines: [{ name: 'cli' }],
            placements: [],
          },
        ],
        // A workflow Worker run from the control stack's `cli` container.
        pollers: { 'hunt-1.2.1': report([['cli', fresh]], 'hunt-1.2.1') },
      })
    );
    expect(view.unattributed).toEqual([]);
  });

  it('a queue that could not be described contributes no unattributed rows', () => {
    // Its identities are unknown, not absent, and inventing rows from a failed describe is the
    // half-fold `describeQueue` refuses.
    const view = deriveMachines(
      input({ stacks, pollers: { 'nscheck-0.1.0': { queue: 'nscheck-0.1.0', error: 'UNAVAILABLE' } } })
    );
    expect(view.unattributed).toEqual([]);
    expect(view.fleets[0]!.machines[0]!.serving[0]!.state).toBe('unknown');
  });
});

describe('reading a Pulumi checkpoint', () => {
  it('takes the Machines from the inventory the program published', () => {
    const s = narrowStack('kontra-fleet/dns', {
      outputs: {
        inventory: {
          'kf-dns-01': { name: 'kf-dns-01', host: '10.108.0.21', size: 's-2vcpu-4gb' },
          'kf-dns-02': { name: 'kf-dns-02', host: '10.108.0.22', size: 's-2vcpu-4gb' },
        },
        placements: [{ actorName: 'nscheck', actorVersion: '0.1.0', maxSessions: 8 }],
      },
      resources: [
        { type: 'pulumi:pulumi:Stack', name: 'dns', synthetic: true, detail: {} },
        {
          type: 'digitalocean:index/droplet:Droplet',
          name: 'kf-dns-01',
          synthetic: false,
          created: '2026-09-25T08:03:00Z',
          detail: { name: 'kf-dns-01', region: 'nyc3', status: 'active', priceMonthly: 24, ipv4AddressPrivate: '10.108.0.21' },
        },
      ],
    });
    expect(s.project).toBe('kontra-fleet');
    expect(s.stack).toBe('dns');
    expect(s.machines.map((m) => m.name)).toEqual(['kf-dns-01', 'kf-dns-02']);
    expect(s.machines[0]).toEqual({
      name: 'kf-dns-01',
      size: 's-2vcpu-4gb',
      region: 'nyc3',
      address: '10.108.0.21',
      status: 'active',
      priceMonthly: 24,
      created: '2026-09-25T08:03:00Z',
    });
    // The Machine the inventory names and the resources do not still gets a row, with only the facts
    // the inventory carries. An absent fact is an absent KEY, not an empty one.
    expect(s.machines[1]).toEqual({ name: 'kf-dns-02', size: 's-2vcpu-4gb', address: '10.108.0.22' });
    expect(s.placements).toEqual([{ actor: 'nscheck', version: '0.1.0', maxSessions: 8 }]);
  });

  it('falls back to the resource types when there is no inventory, and skips the synthetic ones', () => {
    const s = narrowStack('kontra-control/local', {
      resources: [
        { type: 'pulumi:pulumi:Stack', name: 'local', synthetic: true, detail: {} },
        { type: 'pulumi:providers:docker', name: 'default', synthetic: true, detail: {} },
        { type: 'docker:index/container:Container', name: 'postgres', synthetic: false, detail: { name: 'postgres' } },
        { type: 'docker:index/network:Network', name: 'kontra', synthetic: false, detail: { name: 'kontra' } },
        { type: 'docker:index/volume:Volume', name: 'pgdata', synthetic: false, detail: { name: 'pgdata' } },
      ],
    });
    // A network and a volume are not boxes; the synthetic Stack and provider have no counterpart at all.
    expect(s.machines.map((m) => m.name)).toEqual(['postgres']);
  });

  it('prefers the placements array over the scalars, because a packed Fleet is not summarised by them', () => {
    const s = narrowStack('kontra-fleet/desync', {
      outputs: {
        placements: [
          { actorName: 'desync', actorVersion: '1.2.1', workers: 2 },
          { actorName: 'subfinder', actorVersion: '0.2.1' },
        ],
        actorName: 'desync',
        actorVersion: '1.2.1',
      },
    });
    expect(s.placements).toEqual([
      { actor: 'desync', version: '1.2.1', workers: 2 },
      { actor: 'subfinder', version: '0.2.1' },
    ]);
  });

  it('reads the scalars on a checkpoint written before packing existed', () => {
    const s = narrowStack('kontra-fleet/old', {
      outputs: { actorName: 'webcrawl', actorVersion: '0.2.3', maxSessions: 2 },
    });
    expect(s.placements).toEqual([{ actor: 'webcrawl', version: '0.2.3', maxSessions: 2 }]);
  });

  it('a never-converged stack narrows to nothing rather than throwing', () => {
    // `readStack` answers 404 for this and the header calls it a normal answer: "nothing has ever
    // been converged" is not an error.
    expect(narrowStack('kontra-fleet/dns', {})).toEqual({
      fqn: 'kontra-fleet/dns',
      project: 'kontra-fleet',
      stack: 'dns',
      machines: [],
      placements: [],
    });
  });

  it('carries the pinned image and the Bundle sha off the placements array', () => {
    const s = narrowStack('kontra-docker-fleet/canary', {
      outputs: {
        placements: [
          {
            actorName: 'canary',
            actorVersion: '0.1.1',
            workerImage: `127.0.0.1:5000/canary@${PINNED}`,
            bundleSha: 'c0ffee',
          },
        ],
      },
    });
    expect(s.placements).toEqual([
      { actor: 'canary', version: '0.1.1', workerImage: `127.0.0.1:5000/canary@${PINNED}`, bundleSha: 'c0ffee' },
    ]);
  });

  it('reads no workerImage off the scalars, because the programs echo none', () => {
    // `fleet.ts:471-489` echoes bundleUrl, bundleSha, actorName, actorVersion, actorEngine, controller
    // and maxSessions as top-level scalars. `workerImage` exists ONLY inside `placements`. So a
    // checkpoint old enough to have no array has no container digest, which must render as no drift
    // line rather than as `unknown` about a fact nobody ever recorded.
    const s = narrowStack('kontra-fleet/old', {
      outputs: { actorName: 'webcrawl', actorVersion: '0.2.3', bundleSha: 'deadbeef', workerImage: 'ignored' },
    });
    expect(s.placements).toEqual([{ actor: 'webcrawl', version: '0.2.3', bundleSha: 'deadbeef' }]);
  });
});

// ── THE TWO SIGNALS WITH NO ROUTE BEHIND THEM (ADR 0052 §6) ───────────────────────────────────────

describe('the converge strip, folded per stack', () => {
  // TYPED AS THE WIRE, NOT INFERRED. Two literals whose `resourceChanges` name different keys infer as
  // a union carrying `delete?: undefined`, which is not assignable to `Record<string, number>` — so an
  // un-annotated fixture fails `packages/core`'s own `tsc --noEmit` while vitest (which never
  // typechecks) stays green. Annotating also means a change to ConvergeWire breaks this fixture here
  // rather than silently leaving it testing a shape the parser no longer accepts.
  const RECORDS: readonly ConvergeWire[] = [
    { kind: 'update', result: 'succeeded', startTime: 1790186351, endTime: 1790186354, resourceChanges: { create: 2 } },
    { kind: 'destroy', result: 'failed', startTime: 1790186360, endTime: 1790186376, resourceChanges: { delete: 1 } },
  ];

  it('is ABSENT when nobody asked, which is what the route not existing looks like', () => {
    // Issue 13 owes `GET /api/infra/stacks/:fqn/history`. Until it lands, an empty strip would be this
    // console asserting that a stack has never converged — false for every stack on the live volume.
    const view = deriveMachines(input({ stacks: [fleet(['kf-dns-01'], [])] }));
    expect(view.fleets[0]!.converges).toBeUndefined();
  });

  it('is an EMPTY strip when the route answered and the stack has never converged', () => {
    const view = deriveMachines(input({ stacks: [fleet(['kf-dns-01'], [])], history: { 'kontra-fleet/dns': [] } }));
    const strip = view.fleets[0]!.converges;
    expect(strip).toBeDefined();
    expect(strip!.ticks).toEqual([]);
    expect(strip!.latest).toBeUndefined();
  });

  it('draws one tick per record, newest last, with the failure counted', () => {
    const view = deriveMachines(
      input({ stacks: [fleet(['kf-dns-01'], [])], history: { 'kontra-fleet/dns': RECORDS } })
    );
    const strip = view.fleets[0]!.converges!;
    expect(strip.ticks.map((c) => c.tone)).toEqual(['ok', 'failed']);
    expect(strip.failed).toBe(1);
    // A FAILED TEARDOWN IS FAILED, not destroyed: it left Machines running and money being spent.
    expect(strip.latest!.kind).toBe('destroy');
    expect(strip.latest!.tone).toBe('failed');
  });

  it('gives a stack its own history and no other stack any of it', () => {
    const view = deriveMachines(
      input({
        stacks: [
          fleet(['kf-dns-01'], []),
          { fqn: 'kontra-fleet/web', project: 'kontra-fleet', stack: 'web', machines: [], placements: [] },
        ],
        history: { 'kontra-fleet/dns': RECORDS },
      })
    );
    expect(view.fleets.find((s) => s.stack === 'dns')!.converges!.total).toBe(2);
    expect(view.fleets.find((s) => s.stack === 'web')!.converges).toBeUndefined();
  });
});

describe('registry drift, attached to the Worker that pinned the digest', () => {
  const placement = [{ actor: 'canary', version: '0.1.1', workerImage: `127.0.0.1:5000/canary@${PINNED}` }];
  const rowOf = (view: ReturnType<typeof deriveMachines>) => view.fleets[0]!.machines[0]!.serving[0]!;

  it('names the digest the Worker is running, from the checkpoint alone', () => {
    const view = deriveMachines(input({ stacks: [fleet(['kf-dns-01'], placement)] }));
    expect(rowOf(view).image).toBe(`127.0.0.1:5000/canary@${PINNED}`);
  });

  it('is unknown, NEVER drifted, when the registry was not asked', () => {
    // No route serves a registry resolve at all today, so this is the state on a live install.
    const view = deriveMachines(input({ stacks: [fleet(['kf-dns-01'], placement)] }));
    expect(rowOf(view).drift!.state).toBe('unknown');
  });

  it('is current when the tag still resolves to it, and drifted when it does not', () => {
    const key = imageKey('canary', '0.1.1');
    const same = deriveMachines(
      input({ stacks: [fleet(['kf-dns-01'], placement)], images: { [key]: { image: `127.0.0.1:5000/canary@${PINNED}` } } })
    );
    expect(rowOf(same).drift!.state).toBe('current');

    const moved = deriveMachines(
      input({ stacks: [fleet(['kf-dns-01'], placement)], images: { [key]: { image: `127.0.0.1:5000/canary@${NEWER}` } } })
    );
    expect(rowOf(moved).drift!.state).toBe('drifted');
    expect(rowOf(moved).drift!.pinned).toBe(PINNED);
    expect(rowOf(moved).drift!.now).toBe(NEWER);
  });

  it('keys the resolve by THIS placement, so a second actor cannot borrow its verdict', () => {
    // The same failure shape `pollFor` refuses: a row whose verdict came from a neighbour. Two
    // Placements on one Fleet, one resolve, and only the actor it names may read it.
    const packed = [
      { actor: 'canary', version: '0.1.1', workers: 1, workerImage: `127.0.0.1:5000/canary@${PINNED}` },
      { actor: 'subfinder', version: '0.2.1', workers: 1, workerImage: `127.0.0.1:5000/subfinder@${PINNED}` },
    ];
    const view = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01'], packed)],
        images: { [imageKey('canary', '0.1.1')]: { image: `127.0.0.1:5000/canary@${NEWER}` } },
      })
    );
    const rows = view.fleets[0]!.machines[0]!.serving;
    expect(rows.map((r) => [r.title, r.drift!.state])).toEqual([
      ['canary', 'drifted'],
      // Nobody resolved subfinder's tag, so its verdict is `unknown` — not canary's.
      ['subfinder', 'unknown'],
    ]);
  });

  it('says nothing at all for a Placement with no container image', () => {
    // A DigitalOcean Fleet's Workers run natively off a Bundle. No image, no tag, no drift row.
    const view = deriveMachines(
      input({ stacks: [fleet(['kf-dns-01'], [{ actor: 'nscheck', version: '0.1.0', bundleSha: 'c0ffee' }])] })
    );
    expect(rowOf(view).image).toBeUndefined();
    expect(rowOf(view).drift).toBeUndefined();
    // The Bundle sha IS the answer to "what is this Worker running" on that half, so it is carried.
    expect(rowOf(view).bundleSha).toBe('c0ffee');
  });

  it('says the sentence ONCE PER PLACEMENT while every Worker keeps its verdict', () => {
    // Drift is a property of the Placement — `dockerFleet.ts:assignmentFor` hands every Machine the
    // same image — so twelve boxes running one Actor is one finding, not twelve paragraphs. Measured
    // at 390px: per-row it was four wrapped lines each.
    const view = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01', 'kf-dns-02', 'kf-dns-03', 'kf-dns-04'], placement)],
        images: { [imageKey('canary', '0.1.1')]: { image: `127.0.0.1:5000/canary@${NEWER}` } },
      })
    );
    const s = view.fleets[0]!;
    expect(s.machines.map((m) => m.serving[0]!.drift!.state)).toEqual([
      'drifted',
      'drifted',
      'drifted',
      'drifted',
    ]);
    expect(s.driftNotes).toHaveLength(1);
    expect(s.driftNotes[0]!.title).toBe('canary');
    expect(s.driftNotes[0]!.key).toBe(imageKey('canary', '0.1.1'));
  });

  it('gives a packed Fleet one note per Actor, not one per Fleet', () => {
    const packed = [
      { actor: 'canary', version: '0.1.1', workers: 1, workerImage: `127.0.0.1:5000/canary@${PINNED}` },
      { actor: 'subfinder', version: '0.2.1', workers: 1, workerImage: `127.0.0.1:5000/subfinder@${PINNED}` },
    ];
    const view = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01'], packed)],
        images: {
          [imageKey('canary', '0.1.1')]: { image: `127.0.0.1:5000/canary@${NEWER}` },
          [imageKey('subfinder', '0.2.1')]: { image: `127.0.0.1:5000/subfinder@${NEWER}` },
        },
      })
    );
    expect(view.fleets[0]!.driftNotes.map((n) => n.title)).toEqual(['canary', 'subfinder']);
  });

  it('writes no note for current, unknown or absent — only for the two with a fix', () => {
    // `unknown` is the state of EVERY Placement on every install today, because no route serves a
    // registry resolve. A note for it would put one sentence on every stack and bury the one that
    // differs; the Worker's own row still says the word.
    const unknown = deriveMachines(input({ stacks: [fleet(['kf-dns-01'], placement)] }));
    expect(unknown.fleets[0]!.driftNotes).toEqual([]);

    const current = deriveMachines(
      input({
        stacks: [fleet(['kf-dns-01'], placement)],
        images: { [imageKey('canary', '0.1.1')]: { image: `127.0.0.1:5000/canary@${PINNED}` } },
      })
    );
    expect(current.fleets[0]!.driftNotes).toEqual([]);

    // An image the Fleet's own program would refuse IS a note: it has a fix, unlike `unknown`.
    const bad = deriveMachines(
      input({ stacks: [fleet(['kf-dns-01'], [{ actor: 'canary', version: '0.1.1', workerImage: '127.0.0.1:5000/canary:0.1.1' }])] })
    );
    expect(bad.fleets[0]!.driftNotes.map((n) => n.drift.state)).toEqual(['unpinned']);
  });

  it('never attaches a drift verdict to a control-plane role row', () => {
    // A role is this process, not an artifact: `queueAssignments` has no version and no image, and a
    // row claiming a digest for `kontra-datasets` would be inventing one.
    const view = deriveMachines(
      input({
        stacks: [{ fqn: `${CONTROL_PROJECT}/local`, project: CONTROL_PROJECT, stack: 'local', machines: [], placements: [] }],
        assignments: [{ role: 'infra', purpose: 'the controller-pinned workflows', queue: 'kontra-infra', variable: 'KONTRA_INFRA_QUEUE' }],
        images: { [imageKey('the controller-pinned workflows', '')]: { image: `127.0.0.1:5000/x@${NEWER}` } },
      })
    );
    const declared = view.control[0]!.declared[0]!;
    expect(declared.image).toBeUndefined();
    expect(declared.drift).toBeUndefined();
  });
});

/**
 * WHO HOLDS A FLEET, which is what makes it live.
 *
 * These pin the bug that put `8 machines · $192.00/mo` on the Settings page for ZERO live droplets.
 * The cause was not arithmetic: `kontra-fleet/cl0-s2` and `crlf-s2` are two real stacks whose
 * checkpoints still record four `status: active` droplets each at $24/mo, frozen since the moment
 * their Fleets were killed WITHOUT a Pulumi destroy. A checkpoint records what Pulumi last DID and
 * never what IS, so the panel was faithfully reporting a stale belief as live capacity.
 *
 * A Lease (ADR 0037) is the system's own answer to "somebody is using this" — the Machines are
 * destroyed when the last one drops — so liveness comes from the ledger and the live total reaches
 * zero BY CONSTRUCTION rather than by filtering a number somebody might later un-filter.
 */
function stackOf(fqn: string, machines: Array<[name: string, price: number]>): StackReading {
  const [project = '', stack = ''] = fqn.split('/');
  return {
    fqn,
    project,
    stack,
    machines: machines.map(([name, priceMonthly]) => ({ name, size: 's-2vcpu-4gb', priceMonthly })),
    placements: [],
  };
}

const CL0 = stackOf('kontra-fleet/cl0-s2', [
  ['kf-cl0-s2-01', 24],
  ['kf-cl0-s2-02', 24],
  ['kf-cl0-s2-03', 24],
  ['kf-cl0-s2-04', 24],
]);

function rowFor(fqn: string, over: Partial<MachineInput>) {
  return deriveMachines(input(over)).fleets.find((s) => s.fqn === fqn);
}

describe('holding: which Fleets are live, and which are history', () => {
  it('a ledger with a holder is held, and names the Run — Mohamed’s "used by which workflow"', () => {
    const row = rowFor('kontra-fleet/cl0-s2', {
      stacks: [CL0],
      leases: { 'kontra-fleet/cl0-s2': { leases: [{ holder: 'wf-hunt-0.1.0' }] } },
    });
    expect(row?.holding).toEqual({ state: 'held', holders: ['wf-hunt-0.1.0'] });
    // Held, so the checkpoint's price is a BILL and this row belongs in the live section.
    expect(row?.priceMonthly).toBe(96);
    expect(row?.orphanSuspect).toBe(false);
  });

  it('a ledger that answered with no leases is released — this is the $192.00 bug', () => {
    const row = rowFor('kontra-fleet/cl0-s2', {
      stacks: [CL0],
      leases: { 'kontra-fleet/cl0-s2': { leases: [] } },
    });
    // Nobody holds it, so it is history. The row still reports what the checkpoint recorded — that
    // is not a lie, it is what the checkpoint says — but it is no longer live capacity.
    expect(row?.holding).toEqual({ state: 'released' });
    expect(row?.priceMonthly).toBe(96);
    // AND THE DIVERGENCE IS NAMED rather than hidden: four droplets nothing is holding is exactly
    // the condition worth acting on, because those are the ones that might still be billing.
    expect(row?.orphanSuspect).toBe(true);
  });

  it('a ledger that could not be read is unknown, NOT released', () => {
    const row = rowFor('kontra-fleet/cl0-s2', {
      stacks: [CL0],
      leasesUnreachable: { 'kontra-fleet/cl0-s2': 'temporal is unwell' },
    });
    expect(row?.holding).toEqual({ state: 'unknown', why: 'temporal is unwell' });
    // NOT an orphan. `unknown` is absence of evidence, not evidence of absence — flagging it would
    // cry wolf on every Temporal hiccup, and a page that cries wolf gets ignored on the day it is right.
    expect(row?.orphanSuspect).toBe(false);
  });

  it('unreachable wins over a stale entry for the same stack', () => {
    const row = rowFor('kontra-fleet/cl0-s2', {
      stacks: [CL0],
      leases: { 'kontra-fleet/cl0-s2': { leases: [] } },
      leasesUnreachable: { 'kontra-fleet/cl0-s2': 'query timed out' },
    });
    // Order is deliberate: a failed read that also carries a previous answer must not be believed.
    expect(row?.holding.state).toBe('unknown');
    expect(row?.orphanSuspect).toBe(false);
  });

  it('no leases read at all is unasked, so the live section is not falsely emptied', () => {
    const row = rowFor('kontra-fleet/cl0-s2', { stacks: [CL0] });
    // A control plane that does not serve `/api/infra/leases` must not have every Fleet read as
    // released — that would claim nothing is running, which is the inverse of this whole bug.
    expect(row?.holding).toEqual({ state: 'unasked' });
    expect(row?.orphanSuspect).toBe(false);
  });

  it('a released stack with no Machines is not an orphan — this is a clean teardown', () => {
    const row = rowFor('kontra-fleet/recon-c6', {
      stacks: [stackOf('kontra-fleet/recon-c6', [])],
      leases: { 'kontra-fleet/recon-c6': { leases: [], destroyed: true } },
    });
    // The real `recon-c6`: stopped so its scope exit ran, Pulumi destroyed the droplets and emptied
    // the checkpoint. Nothing recorded, nothing held, nothing owed.
    expect(row?.holding).toEqual({ state: 'released' });
    expect(row?.priceMonthly).toBe(0);
    expect(row?.orphanSuspect).toBe(false);
  });

  it('a Lease with no holder still holds the Fleet, and is named rather than dropped', () => {
    const row = rowFor('kontra-fleet/cl0-s2', {
      stacks: [CL0],
      leases: { 'kontra-fleet/cl0-s2': { leases: [{ holder: '' }] } },
    });
    // `LeaseView.holder` is empty for a Lease nobody can be asked about — `destroy_on_exit=False`
    // takes one — and it keeps the Machines alive regardless. Dropping it would read as released and
    // send four live droplets to the history section.
    expect(row?.holding).toEqual({ state: 'held', holders: ['unattributed'] });
    expect(row?.orphanSuspect).toBe(false);
  });

  it('each stack is judged on its own ledger, not the set', () => {
    const view = deriveMachines(
      input({
        stacks: [CL0, stackOf('kontra-fleet/live-one', [['kf-live-01', 24]])],
        leases: {
          'kontra-fleet/cl0-s2': { leases: [] },
          'kontra-fleet/live-one': { leases: [{ holder: 'wf-scan-2.0.0' }] },
        },
      })
    );
    const byFqn = new Map(view.fleets.map((s) => [s.fqn, s]));
    expect(byFqn.get('kontra-fleet/cl0-s2')?.holding.state).toBe('released');
    expect(byFqn.get('kontra-fleet/live-one')?.holding.state).toBe('held');
    // The live total is the held rows only, and it gets there without anything being filtered out.
    const live = view.liveFleets;
    expect(live.reduce((n, s) => n + s.priceMonthly, 0)).toBe(24);
  });
});

describe('the $192.00 regression, with the real stacks', () => {
  it('reports zero live machines and zero live cost while still showing what the checkpoints hold', () => {
    const view = deriveMachines(
      input({
        stacks: [
          CL0,
          stackOf('kontra-fleet/crlf-s2', [
            ['kf-crlf-s2-01', 24],
            ['kf-crlf-s2-02', 24],
            ['kf-crlf-s2-03', 24],
            ['kf-crlf-s2-04', 24],
          ]),
        ],
        // Neither has a Lease ledger any more: both Fleets died without a Pulumi destroy, so the
        // workflow is gone and `readLeases` answers "nobody holds it" for each.
        leases: {
          'kontra-fleet/cl0-s2': { leases: [] },
          'kontra-fleet/crlf-s2': { leases: [] },
        },
      })
    );

    // WHAT WAS ON SCREEN: 8 machines, $192.00/mo, under a live heading.
    expect(view.machines).toBe(8);
    expect(view.fleets.reduce((n, s) => n + s.priceMonthly, 0)).toBe(192);

    // WHAT THE LIVE SECTION SAYS NOW. Zero, and not because 192 was filtered — because no stack is
    // held, so there is nothing in the section to sum.
    expect(view.liveFleets).toEqual([]);
    expect(view.liveMachines).toBe(0);
    expect(view.livePriceMonthly).toBe(0);

    // AND THE EIGHT ARE NOT SWEPT UNDER THE RUG. They are history, and both are flagged: a
    // checkpoint asserting droplets nothing holds is the case that actually costs money, and the
    // reader gets two named rows to reconcile or destroy rather than a corrected total.
    expect(view.pastFleets.map((s) => s.fqn)).toEqual([
      'kontra-fleet/cl0-s2',
      'kontra-fleet/crlf-s2',
    ]);
    expect(view.orphanSuspects.map((s) => s.fqn)).toEqual([
      'kontra-fleet/cl0-s2',
      'kontra-fleet/crlf-s2',
    ]);
  });
});
