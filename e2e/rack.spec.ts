/**
 * The Infrastructure region on the run page, in a browser, against a stubbed orchestrator.
 *
 * ── WHY THIS NEEDS A BROWSER AND THE VITEST SUITE DOES NOT COVER IT ─────────────────────────────
 *
 * `core/src/run/fleet.test.ts` pins the derivation — twenty-two cases, no DOM. What it cannot reach
 * is the half this slice is actually about: whether the region REDRAWS ITSELF while a converge runs.
 * That behaviour is a `$effect` chain armed by `rack.converging`, and jsdom would happily run it
 * against a fetch nobody serves and report a pass. CONTRACT.md makes a browser the bar for exactly
 * this, and the third test below is the one that would have caught a chain that never started.
 *
 * ── THE STUB DRIVES A CONVERGE FORWARD ──────────────────────────────────────────────────────────
 *
 * `/api/infra/stacks/:fqn/state` and `/api/infra/ops/:fqn` are served from a mutable `stage`, so a
 * test can advance the Fleet — two Machines made, a third being made, then all four up with Workers
 * polling — and assert that the page followed WITHOUT A RELOAD. A stub that answered the same bytes
 * every time would pass whether or not the page ever asked again.
 */

import { expect, test, type Page } from '@playwright/test';

const RUN = 'campaign-1790632559';
const FQN = 'kontra-fleet/recon-s4';
const EXEC = '01a00772-8296-4f0e-9a1a-000000000001';
const QUEUE = 'webcrawl-0.2.3'; // `sharedQueue('webcrawl', '0.2.3')` — no `-shared` when versioned

const urn = (type: string, name: string): string => `urn:pulumi:recon-s4::kontra-fleet::${type}::${name}`;
const DROPLET = 'digitalocean:index/droplet:Droplet';
const COMMAND = 'command:remote:Command';

const ROW = {
  runId: RUN,
  type: 'Campaign',
  status: 'running',
  tenant: 'acme',
  startedAt: Date.parse('2026-09-28T21:56:00Z'),
  closedAt: 0,
  dispatches: 0,
  materialization: { total: 0, pending: 0, running: 0, complete: 0, failed: 0, rows: 0, bytes: 0 },
  lifecycle: 'executing',
};

const DETAIL = {
  runId: RUN,
  type: 'Campaign',
  tenant: 'acme',
  startedAt: ROW.startedAt,
  closedAt: 0,
  execution: 'running',
  materialization: ROW.materialization,
  materializationRecords: [],
  lifecycle: 'executing',
  // FALSE, AND LOAD-BEARING. The self-refresh chain is guarded on an unsettled run — the same guard
  // the elapsed clock uses. A `settled: true` fixture would make the third test silently vacuous.
  settled: false,
  activity: null,
  asks: [],
  parkedForMs: 0,
};

/** The two events one Fleet child produces before it closes. Only the first names a workflowType —
 *  which is the shape `fleetStacksOf` has to survive, so the fixture keeps it. */
const HISTORY = [
  {
    id: 12,
    type: 'StartChildWorkflowExecutionInitiated',
    cat: 'child',
    t: 1.2,
    at: ROW.startedAt + 1_200,
    detail: 'workflowId=kontra-fleet/recon-s4',
    attempt: 1,
    dur: 0,
    link: { workflowId: FQN, execId: EXEC, type: 'stackWorkflow', via: 'child' },
  },
  {
    id: 13,
    type: 'ChildWorkflowExecutionStarted',
    cat: 'child',
    t: 1.4,
    at: ROW.startedAt + 1_400,
    detail: '',
    attempt: 1,
    dur: 0,
    link: { workflowId: FQN, execId: EXEC, via: 'child' },
  },
];

/** A checkpoint holding `names`, with the Fleet's own outputs. `planned` is the `machines` output,
 *  which Pulumi only writes when an `up` COMPLETES — absent mid-first-converge, deliberately. */
function checkpoint(names: string[], opts: { planned?: number } = {}) {
  return {
    fqn: FQN,
    project: 'kontra-fleet',
    stack: 'recon-s4',
    updated: '2026-09-28T21:58:00Z',
    outputs: {
      tag: 'recon',
      ...(opts.planned === undefined ? {} : { machines: opts.planned }),
      placements: [{ actorName: 'webcrawl', actorVersion: '0.2.3', bundleSha: 'a'.repeat(64) }],
      inventory: Object.fromEntries(names.map((n) => [n, { name: n, size: 's-2vcpu-4gb' }])),
    },
    resources: names.map((name) => ({
      urn: urn(DROPLET, name),
      type: DROPLET,
      name,
      synthetic: false,
      created: '2026-09-28T21:57:00Z',
      // `ipv4Address` IS IN THE FIXTURE ON PURPOSE. The route really does carry it, and the last
      // test asserts the rack never prints it — a fixture without it would prove nothing.
      detail: {
        name,
        region: 'sfo3',
        size: 's-2vcpu-4gb',
        status: 'active',
        priceMonthly: 24,
        ipv4Address: '198.51.100.7',
        ipv4AddressPrivate: '10.124.0.31',
      },
    })),
  };
}

/** One stage of a converge: what the two infra routes answer right now. */
interface Stage {
  state: ReturnType<typeof checkpoint>;
  op: { status: string; progress: Record<string, unknown>; cursor?: Record<string, unknown> };
  pollers: Record<string, unknown>;
}

/** Two of four Machines made, the third being created this second, nothing placed yet. */
const MIDWAY: Stage = {
  state: checkpoint(['kf-recon-01', 'kf-recon-02']),
  // `progress` is the WORKFLOW's stored phase; `cursor` is the engine's activity heartbeat. Two
  // authorities, two vocabularies — `up` is the operation, `create` is what it is doing to this one
  // resource — and the route sends them as two fields because a query cannot reach a heartbeat.
  op: {
    status: 'RUNNING',
    progress: { phase: 'running', op: 'up' },
    cursor: { op: 'create', urn: urn(DROPLET, 'kf-recon-03') },
  },
  /*
   * THE QUEUE IS REPORTED WITH NO WORKERS ON IT, WHICH IS NOT THE SAME AS NOT REPORTING IT.
   *
   * `{}` was the first fixture and it produced `unknown` — correctly: `/api/pollers` gathers every
   * actor queue the registry knows, so a queue MISSING from the answer means Temporal could not be
   * asked, and `machines.ts` refuses to fold that into "nothing is polling" ("`unknown` is never
   * `none`"). A Placement that has converged with no Worker yet is the queue present and empty,
   * which is what this is — and it is the state the whole install window sits in.
   */
  pollers: { [QUEUE]: { queue: QUEUE, workers: [] } },
};

/** All four up, the Worker installing on the last, three of four already polling. */
const PLACING: Stage = {
  state: checkpoint(['kf-recon-01', 'kf-recon-02', 'kf-recon-03', 'kf-recon-04'], { planned: 4 }),
  op: {
    status: 'RUNNING',
    progress: { phase: 'running', op: 'up' },
    cursor: { op: 'create', urn: urn(COMMAND, 'kf-recon-04-actor-webcrawl') },
  },
  pollers: {
    [QUEUE]: {
      queue: QUEUE,
      workers: ['kf-recon-01', 'kf-recon-02', 'kf-recon-03'].map((h, i) => ({
        identity: `${40 + i}@${h}@${QUEUE}`,
        lastPoll: Date.now() - 1_000,
      })),
    },
  },
};

/** A mutable pointer the stub reads on every request, so a test can advance the converge. */
async function stubApi(page: Page, opts: { stage: () => Stage | null; history?: unknown[] }): Promise<void> {
  // AWAITED, NOT RETURNED: newer Playwright resolves `page.route` to a Disposable.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.startsWith('/api/panels')) return route.abort();
    if (path === '/api/runs') return json([ROW]);
    if (path === `/api/runs/${RUN}`) return json(DETAIL);
    // ONE `state` FRAME AND NO `end`. An `end` closes the source and settles the page, which would
    // take the self-refresh chain's guard away — see DETAIL.settled. This is a run that is still
    // going, which is the only state in which this region does anything.
    if (path === `/api/runs/${RUN}/stream`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: state\ndata: ${JSON.stringify(DETAIL)}\n\n`,
      });
    }
    if (/^\/api\/runs\/[^/]+\/history$/.test(path)) {
      const events = opts.history ?? HISTORY;
      return json({ events, scanned: events.length, elided: 0, truncated: false });
    }
    if (/^\/api\/runs\/[^/]+\/datasets$/.test(path)) return json([]);
    if (/^\/api\/runs\/[^/]+\/io$/.test(path)) return json({ error: 'no such execution' }, 404);
    if (/^\/api\/runs\/[^/]+\/heartbeats$/.test(path)) return json({ nodes: {} });

    const stage = opts.stage();
    if (/^\/api\/infra\/stacks\/[^/]+\/state$/.test(path)) {
      return stage ? json(stage.state) : json({ error: 'no such stack' }, 404);
    }
    if (/^\/api\/infra\/ops\/[^/]+$/.test(path)) {
      return stage ? json({ fqn: FQN, ...stage.op }) : json({ error: 'no such infra op' }, 404);
    }
    if (path === '/api/pollers') return json(stage?.pollers ?? {});

    if (path === '/api/workflows') return json({ workflows: [], registered: [] });
    if (path === '/api/fleet/operations') return json([]);
    if (path === '/api/logs/query' || path === '/api/logs/tail') {
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' });
    }
    return json({});
  });
}

/** Uncaught exceptions, collected — a region that throws on mount must be reported as itself. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.stack ?? String(err)));
  return errors;
}

test('the rack draws every Machine the Fleet is for, including the ones that do not exist yet', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stubApi(page, { stage: () => PLACING });
  await page.goto(`/runs/${encodeURIComponent(RUN)}`);

  const rack = page.getByTestId('run-rack');
  await expect(rack).toBeVisible();

  // Four boxes, named the way the server names them.
  await expect(rack.getByTestId('rack-machine')).toHaveCount(4);
  for (const n of ['kf-recon-01', 'kf-recon-02', 'kf-recon-03', 'kf-recon-04']) {
    await expect(rack.getByText(n, { exact: true })).toBeVisible();
  }

  // THE ACTOR IS ON THE MACHINE, which is the whole request: a server with the names on it.
  await expect(rack.getByTestId('rack-actor')).toHaveCount(4);
  await expect(rack.getByTestId('rack-actor').first()).toContainText('webcrawl');
  await expect(rack.getByTestId('rack-actor').first()).toContainText('0.2.3');

  // Three Workers polling, one still installing — and the counts say so rather than a colour alone.
  await expect(rack.getByTestId('rack-machines')).toContainText('4');
  await expect(rack).toContainText('3 of 4 workers serving');
  await expect(rack.getByTestId('rack-actor').nth(3)).toContainText('installing');

  // The engine's cursor, as a sentence and not a URN.
  await expect(rack.getByTestId('rack-cursor')).toContainText('creating the webcrawl Worker on kf-recon-04');

  expect(errors).toEqual([]);
});

test('a Machine being created is told apart from one that exists and one that does not', async ({ page }) => {
  const errors = watchErrors(page);
  await stubApi(page, { stage: () => MIDWAY });
  await page.goto(`/runs/${encodeURIComponent(RUN)}`);

  const rack = page.getByTestId('run-rack');
  await expect(rack).toBeVisible();

  // MID-FIRST-CONVERGE THERE IS NO `machines` OUTPUT, so there is no denominator — Pulumi writes
  // stack outputs when an `up` completes. Two boxes exist, a third is being made, and the page must
  // not invent "2 of 2".
  await expect(rack.getByTestId('rack-machine')).toHaveCount(3);
  // ASSERTED ON THE COUNT ITSELF, not on the region's text. `not.toContainText(' of 2')` was the
  // first spelling and it matched the WORKERS line ("0 of 2 workers serving") — a substring assertion
  // over a whole region fails for reasons that have nothing to do with the claim.
  await expect(rack.getByTestId('rack-machines')).toHaveText(/^2 machines$/);
  await expect(rack.getByTestId('rack-cursor')).toContainText('creating kf-recon-03');

  // The third box exists ONLY because the engine's cursor named it: Pulumi writes a resource into
  // the checkpoint after the provider has made it, so the Machine being created is in no checkpoint.
  const third = rack.getByTestId('rack-machine').nth(2);
  await expect(third).toContainText('kf-recon-03');
  await expect(third).toContainText('creating');
  await expect(rack.getByTestId('rack-machine').nth(0)).toContainText('up');

  // A Machine that exists and has no Worker on it says so — it is the most actionable line here.
  await expect(rack.getByTestId('rack-actor').first()).toContainText('nothing polling');

  expect(errors).toEqual([]);
});

test('it follows a converge forward with no reload', async ({ page }) => {
  // THE TEST THE REST OF THE SUITE CANNOT DO. Everything on this page rides the run stream, and a
  // bring-up changes nothing in the run view — so if the self-refresh chain never armed, the region
  // would freeze on its first read and every other assertion in this file would still pass.
  const errors = watchErrors(page);
  let stage: Stage = MIDWAY;
  await stubApi(page, { stage: () => stage });
  await page.goto(`/runs/${encodeURIComponent(RUN)}`);

  const rack = page.getByTestId('run-rack');
  await expect(rack.getByTestId('rack-machine')).toHaveCount(3);
  await expect(rack.getByTestId('rack-cursor')).toContainText('creating kf-recon-03');

  // The converge moves on. Nothing is clicked and nothing is reloaded.
  stage = PLACING;

  await expect(rack.getByTestId('rack-machine')).toHaveCount(4, { timeout: 10_000 });
  await expect(rack.getByTestId('rack-cursor')).toContainText('the webcrawl Worker on kf-recon-04');
  await expect(rack).toContainText('3 of 4 workers serving');

  expect(errors).toEqual([]);
});

test('a run that started no Fleet draws no rack at all', async ({ page }) => {
  // Most runs provision nothing. An empty Infrastructure panel on every one of them would be a
  // region that means nothing, which is how a surface stops being read.
  const errors = watchErrors(page);
  await stubApi(page, { stage: () => null, history: [] });
  await page.goto(`/runs/${encodeURIComponent(RUN)}`);

  await expect(page.getByTestId('run-progress')).toBeVisible();
  await expect(page.getByTestId('run-rack')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the rack prints no Machine address, though the route it reads carries them', async ({ page }) => {
  /*
   * A RUN PAGE IS THE MOST SCREENSHOTTED SURFACE IN THIS CONSOLE, and these Machines are mid-scan
   * against somebody else's infrastructure. `narrowStack` carries an address and the Infra page —
   * where an operator goes to debug one — shows it; this region deliberately does not.
   *
   * Asserted against the RENDERED TEXT of the region rather than against the component's props,
   * because the leak this guards against is a future edit adding `{m.address}` to the markup.
   */
  const errors = watchErrors(page);
  await stubApi(page, { stage: () => PLACING });
  await page.goto(`/runs/${encodeURIComponent(RUN)}`);

  const rack = page.getByTestId('run-rack');
  await expect(rack).toBeVisible();
  const text = (await rack.innerText()).replace(/\s+/g, ' ');
  expect(text).not.toContain('198.51.100.7');
  expect(text).not.toContain('10.124.0.31');
  // …in a region that demonstrably rendered the Machines those addresses belong to.
  expect(text).toContain('kf-recon-01');
  expect(errors).toEqual([]);
});
