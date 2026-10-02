import { describe, expect, it } from 'vitest';

import { collapse, historyUrl, loadInfra, resolveUrl, ROLES_URL, why } from './load';

/**
 * The loader's job is the ORDER of the reads and what an unanswered one means — not the join, which is
 * `@kontra/console-core/infra/machines`'s and has its own suite.
 *
 * `fetchImpl` IS AN ARGUMENT for exactly this reason (`dev/contract.ts:42`, `catalog/load.ts:40`,
 * `session.ts:16`): the module wants a vitest and jsdom's `fetch` reaches nothing.
 */
const NOW = 1_800_000_000_000;

type Answer = { status?: number; body?: unknown };

/** A stub keyed on pathname, most specific first — the shape `e2e/runs.spec.ts:116-122` argues for. */
function stub(routes: Record<string, Answer>): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const a = routes[url];
    if (a === undefined) return new Response('{}', { status: 404 });
    if ((a.status ?? 200) >= 400) return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
    return new Response(JSON.stringify(a.body ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, asked };
}

describe('why a read failed, in words', () => {
  it('keeps the four fixes apart', () => {
    // A bare number sends the reader to the wrong fix. 503 from `/api/infra/*` is `auth.ts` failing
    // CLOSED with no token configured; it is not an outage.
    expect(why(0)).toBe('the control plane did not answer');
    expect(why(401)).toBe('this read needs a signed-in console session');
    expect(why(404)).toBe('this control plane does not serve that route');
    expect(why(503)).toContain('KONTRA_STATE_TOKEN');
    expect(why(500)).toBe('HTTP 500');
  });
});

describe('loadInfra', () => {
  it('reads the stack list, then each stack, and joins the pollers', async () => {
    const { fetch, asked } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['kontra-fleet/dns'] } },
      '/api/infra/stacks/kontra-fleet%2Fdns/state': {
        body: {
          updated: '2026-09-25T08:03:00Z',
          outputs: {
            inventory: { 'kf-dns-01': { name: 'kf-dns-01', host: '10.108.0.21' } },
            placements: [{ actorName: 'nscheck', actorVersion: '0.1.0' }],
          },
          resources: [],
        },
      },
      '/api/pollers': {
        body: {
          'nscheck-0.1.0': {
            queue: 'nscheck-0.1.0',
            workers: [{ identity: `41@kf-dns-01@nscheck-0.1.0`, lastPoll: NOW - 1000 }],
          },
        },
      },
      [ROLES_URL]: { body: { roles: ['api', 'infra'], assignments: [] } },
      [historyUrl('kontra-fleet/dns')]: { body: { records: [] } },
    });

    const { view, missing, roles } = await loadInfra(fetch, NOW);

    // The fqn is ONE path segment, so the slash is percent-encoded — `infra/dashboard.ts:109`.
    expect(asked).toContain('/api/infra/stacks/kontra-fleet%2Fdns/state');
    expect(missing).toEqual([]);
    expect(roles).toEqual(['api', 'infra']);
    expect(view.fleets[0]!.machines[0]!.serving[0]!.state).toBe('serving');
  });

  it('describes each role queue separately, because /api/pollers only carries actor queues', async () => {
    const { fetch, asked } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: [] } },
      '/api/pollers': { body: {} },
      [ROLES_URL]: {
        body: {
          roles: ['materializer'],
          assignments: [
            {
              role: 'materializer',
              purpose: 'dataset write, paging and retention',
              queue: 'kontra-datasets',
              variable: 'KONTRA_DATASET_QUEUE',
              slots: 1,
            },
          ],
        },
      },
      '/api/queues/kontra-datasets/pollers': {
        body: { queue: 'kontra-datasets', workers: [], lastPoll: 0 },
      },
    });

    const { view, missing } = await loadInfra(fetch, NOW);
    expect(asked).toContain('/api/queues/kontra-datasets/pollers');
    expect(missing).toEqual([]);
    // No control stack has been converged, so the queue has no box — and it is still SHOWN.
    expect(view.control).toEqual([]);
  });

  it('names the read that failed rather than rendering a partial page as a whole one', async () => {
    const { fetch } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { status: 503, body: { error: 'no token' } },
      '/api/pollers': { body: {} },
    });

    const { view, missing } = await loadInfra(fetch, NOW);
    expect(view.fleets).toEqual([]);
    expect(missing.map((m) => [m.url, m.status])).toEqual([
      ['/api/infra/stacks', 503],
      [ROLES_URL, 404],
    ]);
    expect(missing[0]!.why).toContain('KONTRA_STATE_TOKEN');
    // The route that does not exist yet reads as a control plane that does not serve it — not as
    // "there are no queues", which would be a hardcoded list's answer.
    expect(missing[1]!.why).toBe('this control plane does not serve that route');
  });

  it('a stack that has never been converged is not a failed read', async () => {
    // `readStack` answers 404 for it and `infra/state.ts:18` calls that a normal answer. A warning
    // here would put a fault on a page that is telling the truth.
    const { fetch } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['kontra-fleet/dns'] } },
      '/api/infra/stacks/kontra-fleet%2Fdns/state': { status: 404, body: { error: 'no such stack' } },
      '/api/pollers': { body: {} },
      [ROLES_URL]: { body: { assignments: [] } },
      [historyUrl('kontra-fleet/dns')]: { body: { records: [] } },
    });

    const { view, missing } = await loadInfra(fetch, NOW);
    expect(missing).toEqual([]);
    expect(view.fleets.map((s) => [s.fqn, s.machines.length])).toEqual([['kontra-fleet/dns', 0]]);
  });

  it('a fqn with no slash is refused before it becomes a request', async () => {
    const { fetch, asked } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['nonsense', 'kontra-fleet/dns'] } },
      '/api/infra/stacks/kontra-fleet%2Fdns/state': { body: {} },
      '/api/pollers': { body: {} },
      [ROLES_URL]: { body: { assignments: [] } },
    });
    await loadInfra(fetch, NOW);
    expect(asked.filter((u) => u.includes('nonsense'))).toEqual([]);
  });
});

// ── THE TWO ROUTES THAT DO NOT EXIST YET ──────────────────────────────────────────────────────────

describe('one row per WAY a read failed, not one per read', () => {
  it('collapses a per-stack failure into a pattern with a count, keeping other routes apart', () => {
    const rows = collapse([
      { url: '/api/infra/stacks/a%2F1/history', label: '/api/infra/stacks/:fqn/history', status: 404, why: 'gone' },
      { url: '/api/infra/stacks/a%2F2/history', label: '/api/infra/stacks/:fqn/history', status: 404, why: 'gone' },
      { url: '/api/infra/stacks/a%2F3/history', label: '/api/infra/stacks/:fqn/history', status: 404, why: 'gone' },
      // A DIFFERENT ROUTE WITH THE SAME WORDS IS A DIFFERENT MISSING ROUTE. Folding these together
      // because `why(404)` returns one sentence would hide one of them entirely.
      { url: ROLES_URL, label: ROLES_URL, status: 404, why: 'gone' },
      // And the same route failing two ways is two facts: a 503 needs a token, a 404 needs a deploy.
      { url: '/api/infra/stacks/a%2F4/history', label: '/api/infra/stacks/:fqn/history', status: 503, why: 'closed' },
    ]);
    expect(rows).toEqual([
      { url: '/api/infra/stacks/:fqn/history', status: 404, why: 'gone', count: 3 },
      { url: ROLES_URL, status: 404, why: 'gone' },
      { url: '/api/infra/stacks/a%2F4/history', status: 503, why: 'closed' },
    ]);
  });

  it('a single failure keeps its concrete url, because one fqn is information', () => {
    const rows = collapse([
      { url: '/api/infra/stacks/a%2F1/history', label: '/api/infra/stacks/:fqn/history', status: 404, why: 'gone' },
    ]);
    expect(rows).toEqual([{ url: '/api/infra/stacks/a%2F1/history', status: 404, why: 'gone' }]);
  });
});

describe('the converge records', () => {
  const stacks = { '/api/infra/stacks': { body: { stacks: ['kontra-fleet/dns'] } } };
  const rest = { '/api/pollers': { body: {} }, [ROLES_URL]: { body: { assignments: [] } } };
  const state = { '/api/infra/stacks/kontra-fleet%2Fdns/state': { body: { outputs: {} } } };

  it('feeds the strip, oldest tick first', async () => {
    const { fetch } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      ...stacks,
      ...state,
      ...rest,
      // Two records off the live volume, newest FIRST on the wire to prove the order is normalised.
      [historyUrl('kontra-fleet/dns')]: {
        body: {
          records: [
            { kind: 'destroy', result: 'succeeded', startTime: 1790186655, endTime: 1790186668, resourceChanges: { delete: 2 } },
            { kind: 'update', result: 'succeeded', startTime: 1790186351, endTime: 1790186354, resourceChanges: { create: 2 } },
          ],
        },
      },
    });
    const { view, missing } = await loadInfra(fetch, NOW);
    expect(missing).toEqual([]);
    const strip = view.fleets[0]!.converges!;
    expect(strip.ticks.map((c) => c.tone)).toEqual(['ok', 'destroy']);
    expect(strip.latest!.kind).toBe('destroy');
  });

  it('tolerates a bare array, because the route that will send it does not exist yet', async () => {
    const { fetch } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      ...stacks,
      ...state,
      ...rest,
      [historyUrl('kontra-fleet/dns')]: {
        body: [{ kind: 'update', result: 'succeeded', startTime: 1790186351, endTime: 1790186354 }],
      },
    });
    const { view } = await loadInfra(fetch, NOW);
    expect(view.fleets[0]!.converges!.ticks).toHaveLength(1);
  });

  it('is reported once when the route is missing, not once per stack', async () => {
    const { fetch } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['kontra-fleet/a', 'kontra-fleet/b', 'kontra-fleet/c'] } },
      '/api/infra/stacks/kontra-fleet%2Fa/state': { body: { outputs: {} } },
      '/api/infra/stacks/kontra-fleet%2Fb/state': { body: { outputs: {} } },
      '/api/infra/stacks/kontra-fleet%2Fc/state': { body: { outputs: {} } },
      ...rest,
    });
    const { view, missing } = await loadInfra(fetch, NOW);
    expect(missing).toEqual([
      { url: '/api/infra/stacks/:fqn/history', status: 404, why: why(404), count: 3 },
    ]);
    // AND NO STRIP ANYWHERE. A missing route must not produce three empty strips, which would assert
    // that three stacks have never converged.
    expect(view.fleets.map((s) => s.converges)).toEqual([undefined, undefined, undefined]);
  });
});

describe('the registry resolve', () => {
  const PINNED = `sha256:${'a'.repeat(64)}`;
  const NEWER = `sha256:${'b'.repeat(64)}`;

  /** One Fleet running one digest-pinned Worker — what `kontra deploy` + `kontra fleet` produce. */
  function docker(extra: Record<string, Answer> = {}) {
    return stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['kontra-docker-fleet/canary'] } },
      '/api/infra/stacks/kontra-docker-fleet%2Fcanary/state': {
        body: {
          outputs: {
            inventory: { 'kf-canary-01': { name: 'kf-canary-01', host: 'kf-canary-01' } },
            placements: [
              { actorName: 'canary', actorVersion: '0.1.1', workerImage: `127.0.0.1:5000/canary@${PINNED}` },
            ],
          },
        },
      },
      '/api/pollers': { body: {} },
      [ROLES_URL]: { body: { assignments: [] } },
      [historyUrl('kontra-docker-fleet/canary')]: { body: { records: [] } },
      ...extra,
    });
  }

  const drift = (view: Awaited<ReturnType<typeof loadInfra>>['view']) =>
    view.fleets[0]!.machines[0]!.serving[0]!.drift!;

  it('asks about the tag the Placement pinned, naming the actor and version and not a URL', async () => {
    // The browser must not choose a URL the orchestrator fetches: that process holds
    // DIGITALOCEAN_TOKEN and the cluster SSH key. It names the actor; the server names the registry.
    const { fetch, asked } = docker({
      [resolveUrl('canary', '0.1.1')]: { body: { image: `127.0.0.1:5000/canary@${PINNED}` } },
    });
    const { view } = await loadInfra(fetch, NOW);
    expect(asked).toContain('/api/infra/registry/resolve?actor=canary&version=0.1.1');
    expect(drift(view).state).toBe('current');
  });

  it('flags a tag that has moved, naming both digests', async () => {
    const { fetch } = docker({
      [resolveUrl('canary', '0.1.1')]: { body: { image: `127.0.0.1:5000/canary@${NEWER}` } },
    });
    const { view } = await loadInfra(fetch, NOW);
    expect(drift(view).state).toBe('drifted');
    expect(drift(view).pinned).toBe(PINNED);
    expect(drift(view).now).toBe(NEWER);
  });

  it('a route that does not exist renders as unknown, NEVER as drift', async () => {
    // This is the state on every install today: nothing serves a registry resolve at all.
    const { fetch } = docker();
    const { view, missing } = await loadInfra(fetch, NOW);
    expect(drift(view).state).toBe('unknown');
    expect(drift(view).why).toBe('the registry could not be asked what this tag resolves to');
    // ONE resolve failed, so the row keeps its concrete URL — with two Placements it would collapse
    // to the pattern. Either way the reader is told which route to go and build.
    expect(missing.some((m) => m.url.startsWith('/api/infra/registry/resolve'))).toBe(true);
  });

  it('a registry the control plane could not reach is unknown too, in the registry’s own words', async () => {
    // `resolveWorkerImage` fails SOFT — it returns `''` after trying every base — so this is the
    // COMMON answer, not an exceptional one. The route answered; the registry did not.
    const { fetch } = docker({ [resolveUrl('canary', '0.1.1')]: { body: { image: '' } } });
    const { view, missing } = await loadInfra(fetch, NOW);
    expect(drift(view).state).toBe('unknown');
    expect(drift(view).why).toContain('127.0.0.1:5000/canary:0.1.1');
    // Nothing failed as a READ, so nothing is listed as one.
    expect(missing).toEqual([]);
  });

  it('asks once per distinct actor@version, however many Machines run it', async () => {
    const { fetch, asked } = stub({
      // The ledger read, answered and empty — see `holdingOf`. Explicit in every stub rather than
      // defaulted by the helper, because a helper that quietly satisfies a read is the opposite of
      // this module's rule that a failed part is NAMED.
      '/api/infra/leases': { body: { fleets: {} } },
      '/api/infra/stacks': { body: { stacks: ['kontra-docker-fleet/canary'] } },
      '/api/infra/stacks/kontra-docker-fleet%2Fcanary/state': {
        body: {
          outputs: {
            inventory: {
              'kf-canary-01': { name: 'kf-canary-01' },
              'kf-canary-02': { name: 'kf-canary-02' },
            },
            placements: [
              { actorName: 'canary', actorVersion: '0.1.1', workerImage: `127.0.0.1:5000/canary@${PINNED}` },
              // No image at all: a native Placement has no tag to resolve, so it must not be asked
              // about — and a request per Machine would be four for two facts.
              { actorName: 'nscheck', actorVersion: '0.1.0', bundleSha: 'c0ffee' },
            ],
          },
        },
      },
      '/api/pollers': { body: {} },
      [ROLES_URL]: { body: { assignments: [] } },
      [historyUrl('kontra-docker-fleet/canary')]: { body: { records: [] } },
      [resolveUrl('canary', '0.1.1')]: { body: { image: `127.0.0.1:5000/canary@${PINNED}` } },
    });
    await loadInfra(fetch, NOW);
    expect(asked.filter((u) => u.startsWith('/api/infra/registry/resolve'))).toEqual([
      '/api/infra/registry/resolve?actor=canary&version=0.1.1',
    ]);
  });
});

describe('the lease ledger decides which section a Fleet is in', () => {
  /** The minimum that makes one Fleet stack exist, so each test below varies only the ledger. */
  function oneFleet(ledger: Answer) {
    return stub({
      '/api/infra/leases': ledger,
      '/api/infra/stacks': { body: { stacks: ['kontra-fleet/cl0-s2'] } },
      '/api/infra/stacks/kontra-fleet%2Fcl0-s2/state': {
        body: {
          outputs: { inventory: { 'kf-cl0-s2-01': { name: 'kf-cl0-s2-01' } } },
          resources: [
            {
              type: 'digitalocean:index/droplet:Droplet',
              name: 'kf-cl0-s2-01',
              synthetic: false,
              detail: { name: 'kf-cl0-s2-01', status: 'active', priceMonthly: 24 },
            },
          ],
        },
      },
      '/api/pollers': { body: {} },
      [ROLES_URL]: { body: { roles: [], assignments: [] } },
      [historyUrl('kontra-fleet/cl0-s2')]: { body: { records: [] } },
    });
  }

  it('a held Fleet is live, and its cost is the only total that is a bill', async () => {
    const { fetch } = oneFleet({
      body: { fleets: { 'kontra-fleet/cl0-s2': { leases: [{ holder: 'wf-hunt-0.1.0' }] } } },
    });
    const { view, missing } = await loadInfra(fetch, NOW);

    expect(missing).toEqual([]);
    expect(view.liveFleets.map((s) => s.fqn)).toEqual(['kontra-fleet/cl0-s2']);
    expect(view.liveMachines).toBe(1);
    expect(view.livePriceMonthly).toBe(24);
    expect(view.orphanSuspects).toEqual([]);
  });

  it('a released Fleet is history and is flagged, while its recorded cost stays visible', async () => {
    const { fetch } = oneFleet({ body: { fleets: { 'kontra-fleet/cl0-s2': { leases: [] } } } });
    const { view } = await loadInfra(fetch, NOW);

    // The real shape of the $192.00 bug, end to end through the loader: the droplet is still in the
    // checkpoint, nobody holds it, so nothing is live and the row is named as worth reconciling.
    expect(view.liveFleets).toEqual([]);
    expect(view.liveMachines).toBe(0);
    expect(view.livePriceMonthly).toBe(0);
    expect(view.pastFleets.map((s) => s.fqn)).toEqual(['kontra-fleet/cl0-s2']);
    expect(view.orphanSuspects.map((s) => s.fqn)).toEqual(['kontra-fleet/cl0-s2']);
    // Not hidden — history still reports what the checkpoint recorded.
    expect(view.pastFleets[0]!.priceMonthly).toBe(24);
  });

  it('a Fleet whose ledger could not be read is unknown, and is NOT flagged as an orphan', async () => {
    const { fetch } = oneFleet({
      body: { fleets: {}, unreachable: { 'kontra-fleet/cl0-s2': 'temporal is unwell' } },
    });
    const { view } = await loadInfra(fetch, NOW);

    expect(view.pastFleets[0]!.holding).toEqual({ state: 'unknown', why: 'temporal is unwell' });
    // Absence of evidence. Flagging it would put a warning on the page every time Temporal hiccups.
    expect(view.orphanSuspects).toEqual([]);
  });

  it('a control plane that does not serve the route leaves every Fleet unasked, and SAYS so', async () => {
    const { fetch } = oneFleet({ status: 404, body: { error: 'not found' } });
    const { view, missing } = await loadInfra(fetch, NOW);

    // The read failing must not read as "nobody holds anything", which would empty the live section
    // and claim nothing is running — the inverse of the bug this whole change is about.
    expect(view.pastFleets[0]!.holding).toEqual({ state: 'unasked' });
    expect(view.liveFleets).toEqual([]);
    expect(view.orphanSuspects).toEqual([]);
    // AND IT IS NAMED. A silently degraded page is what `collapse` and `missing` exist to prevent.
    expect(missing.map((m) => m.url)).toContain('/api/infra/leases');
    expect(missing[0]!.why).toBe('this control plane does not serve that route');
  });
});
