/**
 * Settings › Infra, in a browser: the four poll states are four, and a Machine shows its own.
 *
 * WHY THIS NEEDS CHROMIUM AND NOT JSDOM. Two of the three claims this page makes are invisible to
 * `svelte-check` and to vitest. The first is FORM: ADR 0052 §6 forbids rounding the four poll states
 * off, and the console's answer is a distinct `border-left-style` per state as well as a distinct
 * colour — a class whose computed style happens to equal its neighbour's passes every DOM assertion
 * while showing a human one shape. jsdom has no cascade to ask. The second is WIDTH: the page is
 * designed at 390px first, and a mono queue name that widens the document is only visible where
 * layout exists.
 *
 * The third is the reason the page exists at all and it IS assertable without a browser — a Machine's
 * poll state comes from its own identity — but it is asserted here too, because the failure it guards
 * is a RENDERING one: the row drawn under `kf-dns-02` showing `kf-dns-01`'s verdict. The stub below
 * makes that reachable on purpose: every Machine shares one queue, the queue's `lastPoll` is the
 * freshest across all four, and a page that read `lastPoll` would call all four of them serving.
 *
 * ONE `page.route` FOR THE WHOLE API, switched on pathname, most specific first — `runs.spec.ts:116`
 * records why: "Playwright matches handlers in reverse registration order, so `**​/api/runs`
 * registered after `**​/api/runs/*` silently wins for both."
 *
 * NOTHING HERE IS FIXED IN TIME. `Infra.svelte` reads freshness against the real `Date.now()`, so the
 * poll timestamps are computed per request relative to now rather than pinned — a fixture dated 2026
 * would make every row `stale` and the spec would assert nothing.
 *
 * ── AND THE TWO SIGNALS ADR 0052 §6 ADDS, WHICH NEED A BROWSER FOR THE SAME TWO REASONS ──────────
 *
 * The CONVERGE STRIP is geometry: "height by duration" is a claim about pixels, and the one thing that
 * cannot be checked without layout is that a converge Pulumi recorded as instant — three of the 112
 * records on the live volume have `endTime === startTime` — still draws a tick rather than a gap. A
 * percentage floor in a unit test proves the number; only Chromium proves the pixels. Its tones are
 * the same form-not-only-colour problem one step harder: a tick is three pixels wide so it cannot
 * carry a border style, and its axis is FILL TEXTURE, which is exactly the kind of CSS that silently
 * resolves to its neighbour's value.
 *
 * REGISTRY DRIFT needs a browser for the opposite reason: the claim is about what is NOT on the page.
 * "A registry that cannot be reached renders as unknown, never as drift" is asserted by driving the
 * three ways the answer can be missing and checking that the second digest appears nowhere — and the
 * digest a Worker is running still does.
 *
 * NEITHER ROUTE EXISTS. `GET /api/infra/stacks/:fqn/history` is issue 13's and
 * `GET /api/infra/registry/resolve` is nobody's yet, so the {@link Stubs} flags drive the
 * route-is-absent path deliberately — that is the state of every install today, and the page has to be
 * honest in it rather than only in the happy one.
 */

import { expect, test } from '@playwright/test';

/** `POLL_FRESH_MS` (`@kontra/core/queues:55`). Restated as a number here on purpose: a spec that
 *  imported the window would agree with the app about a value they are both wrong about. */
const POLL_FRESH_MS = 120_000;

const FLEET = 'kontra-fleet/dns';
const CONTROL = 'kontra-control/local';
const ACTOR_QUEUE = 'nscheck-0.1.0';

/** `<pid>@<host>@<queue>` — `shared/core/src/queues.ts:workerIdentity`. The join is this and nothing else. */
const identity = (pid: number, host: string, queue: string): string => `${pid}@${host}@${queue}`;

/**
 * The four states on one queue, and one poller belonging to no Machine at all.
 *
 * `kf-dns-04` IS ABSENT FROM THIS LIST, which is what `nothing polling` means: the Placement
 * converged and a dispatch to it hangs to StartToClose. `lastPoll` at the bottom is the freshest
 * across the whole queue — the number a page that keyed on the QUEUE instead of the Machine would
 * render under all four boxes.
 */
function actorPollers(now: number): unknown {
  return {
    queue: ACTOR_QUEUE,
    pollers: 5,
    identities: [],
    workers: [
      { identity: identity(41, 'kf-dns-01', ACTOR_QUEUE), lastPoll: now - 5_000 }, // serving
      { identity: identity(41, 'kf-dns-02', ACTOR_QUEUE), lastPoll: now - POLL_FRESH_MS - 60_000 }, // stale
      { identity: identity(41, 'kf-dns-03', ACTOR_QUEUE), lastPoll: 0 }, // undated
      // A developer's `kontra serve --actor` against the same control plane.
      { identity: identity(9182, 'dev-laptop', ACTOR_QUEUE), lastPoll: now - 12_000 },
      // An identity that is not in the shape at all — a custom `Identity` is legal.
      { identity: 'ci-runner-7', lastPoll: 0 },
    ],
    lastPoll: now - 5_000,
  };
}

/** `roles.ts:queueAssignments(['materializer','infra'])`, verbatim, plus `KONTRA_DATASET_SLOTS`. */
const ASSIGNMENTS = [
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

/** The control stack's checkpoint: containers, no inventory — so the Machines come from the resource
 *  types, and a network and a volume are not boxes. */
const CONTROL_STATE = {
  fqn: CONTROL,
  project: 'kontra-control',
  stack: 'local',
  updated: new Date().toISOString(),
  outputs: {},
  resources: [
    { urn: 'a', type: 'pulumi:pulumi:Stack', name: 'local', synthetic: true, detail: {} },
    {
      urn: 'b',
      type: 'docker:index/container:Container',
      name: 'orchestrator-api',
      synthetic: false,
      detail: { name: 'orchestrator-api', image: 'kontra:0.4.0' },
    },
    {
      urn: 'c',
      type: 'docker:index/container:Container',
      name: 'postgres',
      synthetic: false,
      detail: { name: 'postgres', image: 'postgres:16-alpine' },
    },
    { urn: 'd', type: 'docker:index/network:Network', name: 'kontra', synthetic: false, detail: { name: 'kontra' } },
  ],
};

/**
 * The digest the Placement pinned and the one the tag resolves to now.
 *
 * IN THE SHAPE THE SYSTEM PRODUCES — `<advertised>/<actor>@sha256:<64 hex>`, which is what
 * `activities/fleet.ts:resolveWorkerImage` returns with `KONTRA_REGISTRY` stripped of its scheme
 * (`127.0.0.1:5000` on this installation, `dockerFleet.ts:62`).
 */
const RUNNING = `sha256:${'a'.repeat(64)}`;
const IN_REGISTRY = `sha256:${'b'.repeat(64)}`;
const PINNED_IMAGE = `127.0.0.1:5000/nscheck@${RUNNING}`;

/**
 * Pulumi's own converge records, copied off the live volume and given every tone the page draws.
 *
 * NEWEST FIRST ON THE WIRE, ON PURPOSE. Issue 13's route will answer newest-last; the route does not
 * exist yet, and a strip whose left end depends on the server getting that right is a strip that will
 * silently reverse one day. `startTime` is EPOCH SECONDS, which is what is on disk — read as
 * milliseconds every tick would be dated 1970.
 */
const HISTORY = [
  // A converge still going. Pulumi's DIY backend writes its record at COMPLETION, so this shape is
  // specified rather than observed — but `GET /api/infra/ops/:fqn` reports a `stackWorkflow` mid-run
  // (`infraRoutes.ts:198`), and a converge with no outcome yet must not be drawn as one that succeeded.
  { kind: 'update', result: 'in-progress', startTime: 1790186410, endTime: 1790186418 },
  { kind: 'preview', result: 'succeeded', startTime: 1790186400, endTime: 1790186403, resourceChanges: { same: 2 } },
  { kind: 'destroy', result: 'failed', startTime: 1790186380, endTime: 1790186426, resourceChanges: { delete: 1, same: 1 } },
  { kind: 'update', result: 'succeeded', startTime: 1790186360, endTime: 1790186376, resourceChanges: { replace: 1, same: 1 } },
  // endTime === startTime and NO resourceChanges: both measured on the volume, and both must still
  // draw a tick rather than a gap.
  { kind: 'destroy', result: 'succeeded', startTime: 1790186355, endTime: 1790186355 },
  { kind: 'update', result: 'succeeded', startTime: 1790186351, endTime: 1790186354, resourceChanges: { create: 2 } },
];

/** The Fleet's: an inventory the program published, and one Placement on every Machine. */
const FLEET_STATE = {
  fqn: FLEET,
  project: 'kontra-fleet',
  stack: 'dns',
  updated: new Date().toISOString(),
  outputs: {
    inventory: {
      'kf-dns-01': { name: 'kf-dns-01', host: '10.108.0.21', size: 's-2vcpu-4gb' },
      'kf-dns-02': { name: 'kf-dns-02', host: '10.108.0.22', size: 's-2vcpu-4gb' },
      'kf-dns-03': { name: 'kf-dns-03', host: '10.108.0.23', size: 's-2vcpu-4gb' },
      'kf-dns-04': { name: 'kf-dns-04', host: '10.108.0.24', size: 's-2vcpu-4gb' },
    },
    placements: [
      { actorName: 'nscheck', actorVersion: '0.1.0', maxSessions: 8, workerImage: PINNED_IMAGE },
    ],
  },
  resources: [1, 2, 3, 4].map((n) => ({
    urn: `d${n}`,
    type: 'digitalocean:index/droplet:Droplet',
    name: `kf-dns-0${n}`,
    synthetic: false,
    created: new Date().toISOString(),
    detail: {
      name: `kf-dns-0${n}`,
      region: 'nyc3',
      size: 's-2vcpu-4gb',
      status: 'active',
      priceMonthly: 24,
      ipv4AddressPrivate: `10.108.0.2${n}`,
    },
  })),
};

interface Stubs {
  /** Omit to drive the "this control plane does not serve that route" path. */
  roles?: boolean;
  /**
   * `false` leaves the converge-record route 404ing, which is what a live control plane does today —
   * issue 13 owes it. The page must then draw NO strip at all rather than an empty one, because an
   * empty strip asserts that a stack has never converged.
   */
  history?: boolean;
  /**
   * What `GET /api/infra/registry/resolve` answers. NO ROUTE SERVES THIS ON ANY INSTALL, so `absent`
   * is today's reality and the one the page must render as `unknown`.
   *   `absent`  — 404, the route does not exist
   *   `same`    — the tag still resolves to the digest the Machine is running
   *   `moved`   — it resolves to a different one: drift
   *   `silent`  — the route answered `{image: ''}`, which is `resolveWorkerImage` giving up on every
   *               registry base. Must be `unknown`, NEVER drift.
   */
  resolve?: 'absent' | 'same' | 'moved' | 'silent';
}

async function stub(page: import('@playwright/test').Page, s: Stubs = {}): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const now = Date.now();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Another origin. Refusing is a path the app handles — `runs.spec.ts:132`.
    if (path.startsWith('/api/panels')) return route.abort();

    // ── the fqn is ONE segment, so the slash arrives percent-encoded (infraRoutes.ts:229 decodes) ──
    const state = /^\/api\/infra\/stacks\/([^/]+)\/state$/.exec(path);
    if (state) {
      const fqn = decodeURIComponent(state[1]!);
      if (fqn === CONTROL) return json(CONTROL_STATE);
      if (fqn === FLEET) return json(FLEET_STATE);
      // `readStack` answers 404 for a stack that has never been converged, and `infra/state.ts:18`
      // calls that a normal answer.
      return json({ error: 'no such stack' }, 404);
    }
    // Issue 13's route, registered BEFORE `/api/infra/stacks` for the reason at the top of this file:
    // Playwright matches in reverse registration order, so the specific path must be tested first.
    const history = /^\/api\/infra\/stacks\/([^/]+)\/history$/.exec(path);
    if (history) {
      if (s.history === false) return json({ error: 'not found' }, 404);
      // ONLY THE FLEET HAS RECORDS. The control stack answers an EMPTY LIST, which issue 13's own
      // acceptance criterion calls the answer for a stack that has never converged — a different fact
      // from a route that is not there, and the page must draw them differently.
      return json({ records: decodeURIComponent(history[1]!) === FLEET ? HISTORY : [] });
    }
    if (path === '/api/infra/stacks') return json({ stacks: [CONTROL, FLEET] });
    if (path === '/api/infra/registry/resolve') {
      const mode = s.resolve ?? 'absent';
      if (mode === 'absent') return json({ error: 'not found' }, 404);
      if (mode === 'silent') return json({ image: '' });
      return json({ image: `127.0.0.1:5000/nscheck@${mode === 'same' ? RUNNING : IN_REGISTRY}` });
    }
    if (path === '/api/infra/roles') {
      // WITHOUT THE ROUTE the console must say it could not ask, not answer from a hardcoded list.
      if (s.roles === false) return json({ error: 'not found' }, 404);
      return json({ roles: ['api', 'materializer', 'infra'], assignments: ASSIGNMENTS });
    }

    const queue = /^\/api\/queues\/([^/]+)\/pollers$/.exec(path);
    if (queue) {
      const q = decodeURIComponent(queue[1]!);
      if (q === 'kontra-datasets') {
        return json({
          queue: q,
          pollers: 1,
          identities: [],
          workers: [{ identity: identity(9, 'orchestrator-api', q), lastPoll: now - 3_000 }],
          lastPoll: now - 3_000,
        });
      }
      // NOTHING POLLING, and reported as such rather than as an error: the Placement converged.
      return json({ queue: q, pollers: 0, identities: [], workers: [], lastPoll: 0 });
    }

    if (path === '/api/pollers') return json({ [ACTOR_QUEUE]: actorPollers(now) });

    // The Shell mounts Workspace on every surface and Settings reads /api/health; `{}` is enough for
    // both, and the absent `/api/login` answer is what opens the gate (core/run/session.ts:114-122).
    return json({});
  });
}

/** Uncaught exceptions, collected. A surface that throws on mount must be reported as itself rather
 *  than as a locator that timed out 30 s later. */
function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.stack ?? String(err)));
  return errors;
}

const pollRow = (page: import('@playwright/test').Page, machine: string, queue: string) =>
  page.getByTestId(`poll-${machine}::${queue}`);

/** The computed shape of one row, which is the half a text assertion cannot see. */
async function shapeOf(locator: import('@playwright/test').Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      state: el.getAttribute('data-state'),
      style: cs.borderLeftStyle,
      colour: cs.borderLeftColor,
      width: cs.borderLeftWidth,
    };
  });
}

test('all four poll states render, and they are four shapes as well as four colours', async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  await expect(page.getByTestId('infra')).toBeVisible();
  await expect(page.getByTestId('stack-kontra-fleet/dns')).toBeVisible();

  const rows = ['kf-dns-01', 'kf-dns-02', 'kf-dns-03', 'kf-dns-04'].map((m) =>
    pollRow(page, m, ACTOR_QUEUE)
  );
  for (const r of rows) await expect(r).toBeVisible();

  const shapes = [];
  for (const r of rows) shapes.push(await shapeOf(r));

  // The states themselves, in Machine order.
  expect(shapes.map((s) => s.state)).toEqual(['serving', 'stale', 'undated', 'nothing-polling']);

  // FOUR SHAPES. A fourth state rendered with the third's border is a state that has been rounded
  // off in the only dimension a reader who cannot separate red from amber has left.
  expect(new Set(shapes.map((s) => s.style)).size).toBe(4);
  expect(new Set(shapes.map((s) => s.colour)).size).toBe(4);
  // `double` silently degrades to `solid` below three pixels, which would make `stale` and `serving`
  // the same shape. Measured rather than assumed.
  expect(shapes.map((s) => s.width)).toEqual(['3px', '3px', '3px', '3px']);

  // And the word, because the shape is not the whole answer either.
  await expect(rows[0]!).toContainText('serving');
  await expect(rows[1]!).toContainText('stale');
  await expect(rows[2]!).toContainText('undated');
  await expect(rows[3]!).toContainText('nothing polling');

  expect(errors).toEqual([]);
});

test("a Machine's poll state is its own, never the queue's freshest", async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  // All four Machines share `nscheck-0.1.0`, whose queue-level `lastPoll` is `kf-dns-01`'s poll from
  // five seconds ago. A page reading that number would call every one of them serving.
  const serving = pollRow(page, 'kf-dns-01', ACTOR_QUEUE);
  const cold = pollRow(page, 'kf-dns-04', ACTOR_QUEUE);
  await expect(serving).toHaveAttribute('data-state', 'serving');
  await expect(cold).toHaveAttribute('data-state', 'nothing-polling');

  // The serving row names the identity it was folded from, and it is THIS Machine's.
  await expect(serving).toContainText(`41@kf-dns-01@${ACTOR_QUEUE}`);
  // The one with nothing polling names no identity at all — there is none to name, and borrowing a
  // neighbour's is the failure this whole page is keyed against.
  await expect(cold).not.toContainText('@kf-dns-01@');
  await expect(cold).not.toContainText('@kf-dns-04@');

  // Each row lives inside its own Machine's card, so the pairing is structural and not a coincidence
  // of ordering.
  await expect(page.getByTestId('machine-kf-dns-01').getByTestId(`poll-kf-dns-01::${ACTOR_QUEUE}`)).toBeVisible();
  await expect(page.getByTestId('machine-kf-dns-04').getByTestId(`poll-kf-dns-01::${ACTOR_QUEUE}`)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('pollers matching no Machine appear under Unattributed, including one that does not parse', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  const group = page.getByTestId('group-unattributed');
  await expect(group).toBeVisible();

  // The developer's `kontra serve`, attributed to a host that is no Machine.
  await expect(page.getByTestId(`unattributed-9182@dev-laptop@${ACTOR_QUEUE}`)).toContainText('dev-laptop');
  // And an identity `identityHost` cannot read at all: shown, and SAID, rather than dropped.
  const odd = page.getByTestId('unattributed-ci-runner-7');
  await expect(odd).toBeVisible();
  await expect(odd).toContainText('names no host at all');
  await expect(group).toContainText('2 pollers');

  // THE THIRTEENTH POLLER. The Fleet still reports four Machines: the two above are not Machines that
  // vanished, and dropping them is what makes a 12-Machine Fleet report thirteen pollers.
  await expect(page.getByTestId('group-fleets')).toContainText('4 machines');

  expect(errors).toEqual([]);
});

test('the control stack draws the queues queueAssignments gives it, with KONTRA_DATASET_SLOTS', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  await expect(page.getByTestId('stack-kontra-control/local')).toBeVisible();

  // ONE ROW FOR THE MATERIALIZER ROLE, attributed to the container whose poller names it — not
  // spread across `postgres`, which polls nothing and never will.
  const api = page.getByTestId('machine-orchestrator-api');
  const datasets = api.getByTestId('poll-orchestrator-api::kontra-datasets');
  await expect(datasets).toHaveAttribute('data-state', 'serving');
  await expect(datasets).toContainText('dataset write, paging and retention');
  // The slot count sits BESIDE the poll state, because "serving" and "nothing moves" is the reading
  // this page exists to make: at one slot a single stuck activity stops publishes, page reads, Lease
  // holds and retention together.
  await expect(datasets).toContainText('1 activity slot (KONTRA_DATASET_SLOTS)');
  // AND `postgres` SAYS IT IN THE CONTROL STACK'S VOCABULARY. "No placement" is a Fleet's word for
  // capacity somebody is paying for with nothing on it; a container that polls no queue is not that,
  // and borrowing the word would import Placements into a stack that has none and never will.
  await expect(page.getByTestId('machine-postgres')).toContainText('polls no queue');
  await expect(page.getByTestId('machine-postgres')).not.toContainText('no placement');
  await expect(page.getByTestId('machine-kf-dns-04')).toContainText('nothing polling');

  // `kontra-materializer` was removed 2026-09-26 as uncalled. Rendering from the function is what
  // makes it impossible to draw here; a hardcoded list would have kept it forever.
  await expect(page.getByTestId('infra')).not.toContainText('kontra-materializer');

  // The infra queue has no poller at all, so it has no box — and it is still shown, which is exactly
  // what is wrong with it.
  const declared = page.getByTestId('declared-kontra-control/local');
  await expect(declared).toContainText('kontra-infra');
  await expect(declared.getByTestId('poll-::kontra-infra')).toHaveAttribute('data-state', 'nothing-polling');

  expect(errors).toEqual([]);
});

test('with no roles route the page says it could not ask, rather than inventing a queue list', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page, { roles: false });
  await page.goto('/settings');

  await expect(page.getByTestId('infra-missing')).toContainText('/api/infra/roles');
  await expect(page.getByTestId('infra-missing')).toContainText('does not serve that route');
  // No queue name is invented in its absence. The Fleet half still renders from the checkpoint.
  await expect(page.getByTestId('infra')).not.toContainText('kontra-datasets');
  await expect(pollRow(page, 'kf-dns-01', ACTOR_QUEUE)).toBeVisible();

  expect(errors).toEqual([]);
});

// ── THE CONVERGE STRIP (ADR 0052 §6) ──────────────────────────────────────────────────────────────

/** The computed FORM of one tick. A tick is three pixels wide, so its form axis is fill texture — and
 *  a texture that resolves to its neighbour's is invisible to every assertion that only reads text. */
async function tickShape(locator: import('@playwright/test').Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      tone: el.getAttribute('data-tone'),
      colour: cs.backgroundColor,
      texture: cs.backgroundImage,
      halo: cs.outlineStyle,
      hollow: cs.boxShadow,
      // The pixel height, which is the half `height: N%` does not prove: a 0-duration record with a
      // percentage floor still has to come out as visible pixels.
      px: Math.round(el.getBoundingClientRect().height),
    };
  });
}

const ticks = (page: import('@playwright/test').Page) =>
  page.getByTestId(`strip-${FLEET}`).locator('.tick');

type TickShape = Awaited<ReturnType<typeof tickShape>>;

test('the stack header carries one tick per converge, oldest first, with the record on hover', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  const strip = page.getByTestId(`strip-${FLEET}`);
  await expect(strip).toBeVisible();
  await expect(ticks(page)).toHaveCount(HISTORY.length);
  await expect(strip).toContainText(`${HISTORY.length} converges`);
  // The one number a reader acts on, counted rather than left to be spotted among five ticks.
  await expect(strip).toContainText('1 failed');

  // OLDEST ON THE LEFT, whatever order the route used — the fixture is newest-first on the wire.
  const tones = await ticks(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')));
  expect(tones).toEqual(['ok', 'destroy', 'ok', 'failed', 'preview', 'running']);

  // ── the hover, which is where the change counts and the duration live ──
  const first = ticks(page).first();
  // Op, outcome, duration, counts, instant. `16s` and `1 replaced, 1 unchanged` are the two halves the
  // acceptance criterion names, and the instant is UTC because a Fleet spans time zones.
  await expect(ticks(page).nth(2)).toHaveAttribute(
    'title',
    'update · succeeded · 16s · 1 replaced, 1 unchanged · 2026-09-23T17:59:20.000Z'
  );
  await expect(first).toHaveAttribute('title', /^update · succeeded · 3s · 2 created · 2026-09-23T/);
  // A RECORD PULUMI DID NOT COUNT is not a record that changed nothing. Two of the 112 records on the
  // live volume carry no `resourceChanges` at all.
  await expect(ticks(page).nth(1)).toHaveAttribute('title', /changes not recorded/);
  await expect(ticks(page).nth(1)).toHaveAttribute('title', /under 1s/);

  expect(errors).toEqual([]);
});

test('a failed, a preview, a destroy and a running converge are four forms, not four labels', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');
  await expect(ticks(page)).toHaveCount(HISTORY.length);

  const shapes: TickShape[] = [];
  for (let i = 0; i < HISTORY.length; i += 1) shapes.push(await tickShape(ticks(page).nth(i)));

  // FIVE TONES, FIVE FORMS. `ok` twice, so five distinct tuples across six ticks.
  const form = (s: (typeof shapes)[number]) => [s.colour, s.texture, s.halo, s.hollow].join('|');
  expect(new Set(shapes.map(form)).size).toBe(5);
  // And the two ticks that ARE the same tone are the same form, which is the other half of the claim.
  expect(form(shapes[0]!)).toBe(form(shapes[2]!));

  const by = (tone: string) => shapes.find((s) => s.tone === tone)!;
  // A failed converge is haloed, so it is visibly wider than its neighbours in greyscale.
  expect(by('failed').halo).toBe('solid');
  // A preview changed nothing by definition: hollow, with no fill at all.
  expect(by('preview').hollow).not.toBe('none');
  expect(by('preview').texture).toBe('none');
  // A destroy and a running converge are textures, and they are two different ones.
  expect(by('destroy').texture).toContain('gradient');
  expect(by('running').texture).toContain('gradient');
  expect(by('destroy').texture).not.toBe(by('running').texture);

  expect(errors).toEqual([]);
});

test('height is duration, and a converge that took no measurable time is still a tick', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');
  await expect(ticks(page)).toHaveCount(HISTORY.length);

  const heights: TickShape[] = [];
  for (let i = 0; i < HISTORY.length; i += 1) heights.push(await tickShape(ticks(page).nth(i)));

  // In left-to-right (oldest-first) order: [0] the 3s create, [1] the 0s destroy, [2] the 16s place,
  // [3] the 46s failed teardown, [4] the 3s preview, [5] the 8s running one. The longest record in the
  // window is the tallest tick, and the ranking has to hold in pixels and not only in a percentage.
  expect(heights[3]!.px).toBeGreaterThan(heights[2]!.px);
  expect(heights[2]!.px).toBeGreaterThan(heights[0]!.px);

  // THE WHOLE REASON THE FLOOR EXISTS. Three of the 112 records on the live volume have
  // `endTime === startTime`; a proportional tick for those is zero pixels, and a gap in a row of ticks
  // reads as "nothing converged then" rather than as "that converge was instant".
  expect(heights[1]!.px).toBeGreaterThan(2);
  expect(heights[1]!.px).toBeLessThan(heights[3]!.px);

  expect(errors).toEqual([]);
});

test('with no history route there is no strip at all, and it is said once rather than per stack', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page, { history: false });
  await page.goto('/settings');

  await expect(page.getByTestId('infra')).toBeVisible();
  await expect(page.getByTestId(`stack-${FLEET}`)).toBeVisible();
  // ABSENT, NOT EMPTY. An empty strip would be this console asserting that a stack has never
  // converged, which is false for every stack on the live volume.
  await expect(page.getByTestId(`strip-${FLEET}`)).toHaveCount(0);
  await expect(page.getByTestId(`stack-${FLEET}`)).not.toContainText('no converge on record');

  // TWO STACKS, ONE ROW. A warning list nobody finishes reading is a warning list that does not warn.
  const missing = page.getByTestId('infra-missing');
  await expect(missing).toContainText('/api/infra/stacks/:fqn/history');
  await expect(missing.locator('li', { hasText: '/history' })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('a stack the route answered for, that has never converged, says so', async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');

  // The control stack's history is an EMPTY LIST — issue 13's answer for a never-converged stack, and
  // a different fact from a route that is not there. It draws words, not a strip.
  const control = page.getByTestId(`stack-${CONTROL}`);
  await expect(control).toContainText('no converge on record');
  await expect(page.getByTestId(`strip-${CONTROL}`)).toHaveCount(0);
  // And the Fleet, which did converge, still has its ticks.
  await expect(ticks(page)).toHaveCount(HISTORY.length);

  expect(errors).toEqual([]);
});

// ── REGISTRY DRIFT (ADR 0052 §6) ──────────────────────────────────────────────────────────────────

const digest = (page: import('@playwright/test').Page, machine: string) =>
  page.getByTestId(`digest-${machine}::${ACTOR_QUEUE}`);

test('every Worker names the digest it is running, and a tag that still means it reads current', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page, { resolve: 'same' });
  await page.goto('/settings');

  // Every Machine the Placement landed on, not just the one polling: the digest is a fact of the
  // converge and does not depend on whether a Worker came up.
  for (const m of ['kf-dns-01', 'kf-dns-02', 'kf-dns-03', 'kf-dns-04']) {
    await expect(digest(page, m)).toContainText('sha256:aaaaaaaaaaaa');
    await expect(digest(page, m)).toHaveAttribute('data-drift', 'current');
  }
  // The full reference is still reachable, because a shortened digest is for reading and the long one
  // is for pasting into `docker pull`.
  await expect(digest(page, 'kf-dns-01')).toHaveAttribute('title', new RegExp(RUNNING));

  expect(errors).toEqual([]);
});

test('a tag that has moved is flagged, naming both digests', async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page, { resolve: 'moved' });
  await page.goto('/settings');

  const row = digest(page, 'kf-dns-01');
  await expect(row).toHaveAttribute('data-drift', 'drifted');
  await expect(row).toContainText('drifted');

  // BOTH DIGESTS, ON THE ROW. "Drifted" alone tells an operator nothing they can act on; the pair
  // tells them which one is on the Machine and which one a re-deploy would put there.
  await expect(row).toContainText('sha256:aaaaaaaaaaaa');
  await expect(row).toContainText('sha256:bbbbbbbbbbbb');
  // EVERY Worker of the Placement carries it, because every one of them is running that digest.
  for (const m of ['kf-dns-02', 'kf-dns-03', 'kf-dns-04']) {
    await expect(digest(page, m)).toHaveAttribute('data-drift', 'drifted');
    await expect(digest(page, m)).toContainText('sha256:bbbbbbbbbbbb');
  }

  // AND THE SENTENCE ONCE, not once per Machine. Drift is a property of the Placement — every Worker
  // of one runs the same digest — so four identical paragraphs is a warning repeated until it is
  // scenery. This is the failure `programs/fleet.ts:15-17` records: "silently ran stale code for
  // weeks", and it has to stay readable on a twelve-Machine Fleet.
  const notes = page.getByTestId(`drift-${FLEET}`);
  await expect(notes.locator('li')).toHaveCount(1);
  await expect(notes).toContainText('nscheck');
  await expect(notes).toContainText('127.0.0.1:5000/nscheck:0.1.0');
  await expect(notes).toContainText('older code than the tag names');

  expect(errors).toEqual([]);
});

test('a registry that cannot be reached is unknown, and NEVER drift', async ({ page }) => {
  const errors = watchErrors(page);
  // `resolveWorkerImage` fails SOFT: it returns '' after trying every base, because a Fleet that
  // refused to converge because it could not price or reach its registry would trade the job for the
  // accounting. So this is the COMMON answer, not an exceptional one.
  await stub(page, { resolve: 'silent' });
  await page.goto('/settings');

  const row = digest(page, 'kf-dns-01');
  await expect(row).toHaveAttribute('data-drift', 'unknown');
  await expect(row).toContainText('unknown');
  // The digest the Machine IS running is still named — that half is exact, from the checkpoint.
  await expect(row).toContainText('sha256:aaaaaaaaaaaa');
  // No second digest is invented, anywhere on the page.
  await expect(page.getByTestId('infra')).not.toContainText('sha256:bbbbbbbbbbbb');
  // AND NO ROW IS DRIFTED. Asserted on the attribute rather than on the word: the legend at the foot
  // explains what `drifted` means, so a text search for it on this section matches the page that is
  // telling the truth as well as the page that is not.
  await expect(page.locator('[data-drift="drifted"]')).toHaveCount(0);
  // NO NOTE ON THE STACK EITHER. `unknown` is the state of every Placement on every install today —
  // no route serves a registry resolve — so a note for it would put one sentence on every stack and
  // bury the one that differs. The Worker's own row still says the word.
  await expect(page.getByTestId(`drift-${FLEET}`)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('with no resolve route the digest is still shown, and the missing route is named', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // Nothing on any install serves a registry resolve today. The page must degrade to `unknown` and say
  // which route it could not reach, rather than answering from nothing.
  await stub(page, { resolve: 'absent' });
  await page.goto('/settings');

  await expect(digest(page, 'kf-dns-01')).toHaveAttribute('data-drift', 'unknown');
  await expect(digest(page, 'kf-dns-01')).toContainText('sha256:aaaaaaaaaaaa');
  await expect(page.getByTestId('infra-missing')).toContainText('/api/infra/registry/resolve');
  // On the attribute, not the word — the legend names every state it draws. See the test above.
  await expect(page.locator('[data-drift="drifted"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('usable at 390px with no horizontal scroll, and at 1280px', async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page);

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(pollRow(page, 'kf-dns-01', ACTOR_QUEUE)).toBeVisible();
    // The strip is the widest thing this page can draw — one tick per converge, capped at 60. It
    // scrolls inside itself rather than widening the document, which is the claim the next two
    // assertions check from the outside.
    await expect(page.getByTestId(`strip-${FLEET}`)).toBeVisible();

    const over = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      // A page that rendered nothing has no overflow either — `overflow.mjs:121` makes the same
      // distinction, so the emptiness cannot pass as cleanliness.
      text: document.body.textContent?.trim().length ?? 0,
    }));
    expect(over.doc, `document overflows at ${width}px`).toBeLessThanOrEqual(0);
    expect(over.body, `body overflows at ${width}px`).toBeLessThanOrEqual(0);
    expect(over.text, `nothing rendered at ${width}px`).toBeGreaterThan(20);
  }

  expect(errors).toEqual([]);
});
