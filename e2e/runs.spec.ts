/**
 * A run is handed off with its id — in a browser, against a stubbed orchestrator.
 *
 * WHY THE API IS STUBBED HERE AND THE STREAMER IS NOT (`dashboard.spec.ts`). That suite exists
 * because a terminal is invisible to a typecheck: a socket, a hand-rolled 101 and an xterm mounted
 * at 0×0 all pass `tsc` and show a human nothing. This one is about ROUTING AND WORDING — which
 * surface a click lands on, which id the header is showing, and what is printed in the gap before a
 * new run can say anything about itself. The orchestrator API is `page.route`d rather than booted
 * so the run under test can be shaped exactly, including the two-second window in which a brand new
 * run has no detail yet. That window is not reliably producible against a live cluster.
 *
 * FOUR TESTS WERE REMOVED HERE, not lost. They drove the RETIRED Runs page — they clicked
 * `nav-runs` and asserted on `run-row-*`, `open-run-id`, `watching-run`, `run-state` and
 * `run-error`. Every one of those testids is now absent from `frontend/src` (checked: zero
 * occurrences), the page they belonged to went with `RunsPage.tsx`, and two tests added with it —
 * in `sideNav.render.test.ts` and `shell.render.test.ts` — now assert `nav-runs` is NOT
 * rendered. A spec whose first action is a click on an element the suite proves does not exist is
 * not covering a surface; it is describing one. What those four were FOR survives in the vitest
 * suite, which tests the same wording against the live surfaces with a DOM.
 *
 * It imports `test` straight from `@playwright/test`. It used to come from `./fixtures`, because
 * the config declared a `streamerKind` option and a plain `test` treats an option it does not know
 * as an ERROR rather than a no-op — both the option and the fixtures file went with the Monitor.
 */

import { expect, test } from '@playwright/test';

/** A run that finished, and whose output the ledger says failed. Both dimensions, disagreeing —
 *  which is the pairing the whole run surface exists to keep visible (ADR 0017). */
const CRAWL = {
  runId: 'crawl-2026-08-14T09-00-00',
  type: 'Crawl',
  status: 'completed',
  tenant: 'acme',
  startedAt: Date.parse('2026-08-14T09:00:00Z'),
  closedAt: Date.parse('2026-08-14T09:04:54Z'),
  dispatches: 4,
  materialization: { total: 2, pending: 0, running: 0, complete: 1, failed: 1, rows: 623, bytes: 4096 },
  lifecycle: 'output_failed',
};

/** The newest run, still open. */
const SWEEP = {
  runId: 'nscheck-2026-08-14T11-30-00',
  type: 'NsCheck',
  status: 'running',
  tenant: 'acme',
  startedAt: Date.parse('2026-08-14T11:30:00Z'),
  closedAt: 0,
  dispatches: 2,
  materialization: { total: 1, pending: 0, running: 1, complete: 0, failed: 0, rows: 0, bytes: 0 },
  lifecycle: 'executing',
};

const SOURCE = '@workflow.defn\nclass NsCheck:\n    async def run(self):\n        pass\n';

/** `/api/runs/:id` shape — the detail names the execution dimension `execution`, and carries no
 *  `status`: that is the list row's name for the same authority. */
function detailOf(row: typeof CRAWL, over: Record<string, unknown> = {}) {
  return {
    runId: row.runId,
    type: row.type,
    tenant: row.tenant,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    execution: row.status,
    materialization: row.materialization,
    materializationRecords: [],
    lifecycle: row.lifecycle,
    settled: row.lifecycle === 'completed' || row.lifecycle === 'output_failed',
    ...over,
  };
}

interface Stubs {
  /** Rows `/api/runs` answers with. */
  runs?: unknown[];
  /** Per-run detail, by id. A function may delay — the two-second gap before the first answer is a
   *  case with its own bug. */
  detail?: Record<string, () => Promise<unknown> | unknown>;
  /** What `POST /api/runs` answers, if the test presses Run. */
  started?: { runId: string; type: string; queue: string };
  /** Line-delimited log records `/api/logs/query` answers with (VictoriaLogs shape: `_time`,
   *  `_msg`, `level`, `run_id`, plus whatever stream fields the emitter stamped). */
  logs?: Record<string, unknown>[];
  /** The reduced event history `/api/runs/:id/history` answers with — what Progress reduces into
   *  steps. Empty by default, which is the honest shape for a run that has dispatched nothing. */
  history?: unknown[];
  /** The output-dataset preview `/api/datasets/:name/preview` answers with. */
  preview?: { columns: { name: string; type: string }[]; rows: unknown[][]; truncated: boolean };
  /**
   * What `GET /api/runs/:id/datasets` answers — the Dataset partitions the LAKE attributes to this
   * run, which is what the DATASET region draws.
   *
   * NOT `materializationRecords`. That is the ADR 0017 ledger's, and it is EMPTY for every v2 Run
   * because `publishBatch` writes lake rows and no ledger record — so the region read an authority
   * that had nothing to say and printed "This run recorded no output Dataset" over rows that were
   * there. `version` and `dt` are part of the row because they ADDRESS the partition: the preview
   * is fetched with them, so what is shown is THIS run's rows and not the newest run's under the
   * same name.
   */
  datasets?: { name: string; kind: string; version?: string; dt?: string; rows: number; bytes: number }[];
  /**
   * What `GET /api/runs/:id/io` answers — the run's decoded start payload and result.
   *
   * ABSENT IS A CASE, not a gap: a run whose execution Temporal has dropped for retention has no
   * argument to show, and the INPUT region then says which fact it is rather than drawing a blank
   * form. A test that wants that path leaves this unset.
   */
  io?: { input?: unknown; output?: unknown; closedAs?: string };
  /** The `registered` descriptors `/api/workflows` answers with — each may carry `input`/`output`
   *  JsonSchema, which is what the typed input FORM and typed OUTPUT are drawn from. */
  workflows?: unknown[];
}

/**
 * One handler for the whole API, switched on the path.
 *
 * A single route rather than a dozen globs, because ORDER is the trap: Playwright matches handlers
 * in reverse registration order, so `**​/api/runs` registered after `**​/api/runs/*` silently wins
 * for both — and a run detail served the run LIST reads as a page that renders nothing.
 */
async function stub(page: import('@playwright/test').Page, s: Stubs): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // The streamer lives on its own origin and is not part of this test. Refusing is what the app
    // already handles: the rail keeps its last inventory rather than claiming zero Machines.
    if (path.startsWith('/api/panels')) return route.abort();

    if (path === '/api/runs' && route.request().method() === 'POST') {
      return json(s.started ?? { runId: 'unexpected', type: '', queue: '' }, 201);
    }
    if (path === '/api/runs') return json(s.runs ?? []);

    const run = /^\/api\/runs\/([^/]+)$/.exec(path);
    if (run) {
      const make = s.detail?.[decodeURIComponent(run[1]!)];
      if (!make) return json({ error: 'run not found' }, 404);
      return json(await make());
    }
    /*
     * THE RUN PAGE SUBSCRIBES, SO THE STREAM HAS TO ANSWER LIKE A STREAM.
     *
     * `/api/runs/:id/stream` is Server-Sent Events, and the catch-all below would hand it `{}` as
     * `application/json`. `EventSource` treats that as a failed connection and RETRIES — forever,
     * every few seconds, with the page showing "reconnecting — these numbers may be behind" the
     * whole time. A stub that is wrong in that particular way does not fail loudly; it makes every
     * assertion in this file race a banner.
     *
     * ONE `state` FRAME THEN `end`, which is the real shape for a run that is already finished —
     * every run in this file is. `end` is what makes the client call `source.close()` instead of
     * reconnecting, so the stub is a closed conversation rather than an abandoned one.
     */
    const stream = /^\/api\/runs\/([^/]+)\/stream$/.exec(path);
    if (stream) {
      const make = s.detail?.[decodeURIComponent(stream[1]!)];
      const view = make ? await make() : null;
      const frames =
        (view ? `event: state\ndata: ${JSON.stringify(view)}\n\n` : '') +
        `event: end\ndata: ${JSON.stringify({ runId: stream[1] })}\n\n`;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
    }
    if (/^\/api\/runs\/[^/]+\/history$/.test(path)) {
      return json({ events: s.history ?? [], scanned: (s.history ?? []).length, elided: 0, truncated: false });
    }
    if (/^\/api\/runs\/[^/]+\/heartbeats$/.test(path)) return json({ nodes: {} });
    // WHAT THE LAKE SAYS THIS RUN WROTE. An empty array is the honest default — a run that wrote
    // nothing — and `fetchRunDatasets` refuses a non-array, so the catch-all's `{}` below would
    // render the empty state rather than throwing. That is exactly how this went unnoticed.
    if (/^\/api\/runs\/[^/]+\/datasets$/.test(path)) return json(s.datasets ?? []);
    // THE RUN'S OWN TWO PAYLOADS. 404 rather than `{}` when a test declares none: `{}` would mean
    // "started with nothing and returned nothing", where 404 means "Temporal has dropped it" — two
    // different sentences on screen, and the region says which.
    if (/^\/api\/runs\/[^/]+\/io$/.test(path)) {
      return s.io ? json(s.io) : json({ error: 'no such execution' }, 404);
    }

    if (path === '/api/workflows') {
      return json({
        dir: '/tmp/.kontra/workflows',
        workflows: [{ name: 'nscheck.py', bytes: SOURCE.length, modifiedAt: Date.now() }],
        // THE DESCRIPTOR, without which Run is permanently disabled.
        //
        // `registered` is what a serving worker publishes about the type it serves, and the queue on
        // it is the ONLY writer of the Run form's queue field — the queue is derived from the
        // folder's content digest (`wf-<name>-<digest12>`, GitHub #15), not typed, so there is no
        // other way for it to become non-empty and `disabled={... || !queue.trim() || ...}` holds
        // forever. The stub answered `/api/workflows` without this key, so the button this spec
        // exists to press could never be pressed.
        //
        // `name` is the workflow TYPE (`NsCheck`, from SOURCE), not the file name: the page joins
        // the descriptor on the type the open source declares.
        registered: s.workflows ?? [{ name: 'NsCheck', queue: 'wf-nscheck-0a4be1b6cdea', description: '' }],
      });
    }
    // THE FOLDER LISTING, without which the Workflows page has no rows at all.
    //
    // A workflow became a FOLDER holding `workflow.py` rather than a bare file, and the page now
    // renders `mergeWorkflowFolders(files, sources)` — so a stub that answers `/api/workflows` and
    // leaves this to the catch-all's `json({})` produces `sources: undefined` and an empty list.
    // The row this spec presses Run on simply never existed, and the failure read as a missing
    // element rather than as a page rendering from half its inputs.
    if (path === '/api/sources/workflow') {
      return json({
        defaultRoot: '/tmp/.kontra/workflows',
        sources: [
          {
            id: 'wf-nscheck',
            kind: 'workflow',
            name: 'nscheck.py',
            path: '/tmp/.kontra/workflows/nscheck',
            version: '',
            description: '',
            registeredAt: 0,
          },
        ],
      });
    }
    if (path.startsWith('/api/workflows/file/')) return json({ name: 'nscheck.py', source: SOURCE });
    if (path === '/api/workflows/exposure') return json({ open: false, detail: '' });
    // Fleet history. Answered explicitly because the catch-all below returns `{}`, and a
    // non-array here is a bad shape rather than an empty list — the Runs page reports that as an
    // error in its Fleet panel, which is correct behaviour and pure noise in these tests.
    if (path === '/api/fleet/operations') return json([]);
    // A run's logs: VictoriaLogs answers line-delimited JSON, one record per line — `fetchLogs`
    // reads `res.text()` and splits on newlines, so this must NOT be a JSON array.
    if (path === '/api/logs/query' || path === '/api/logs/tail') {
      const body = (s.logs ?? []).map((l) => JSON.stringify(l)).join('\n');
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
    }
    // A run's output-dataset preview.
    if (/^\/api\/datasets\/[^/]+\/preview$/.test(path)) {
      return json(s.preview ?? { columns: [], rows: [], truncated: false });
    }
    if (path === '/api/datasets') return json([]);
    if (path === '/api/actors') return json([]);
    return json({});
  });
}

/** Uncaught exceptions, collected. A surface that throws on mount must be reported as itself
 *  rather than as a locator that timed out thirty seconds later. */
function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.stack ?? String(err)));
  return errors;
}

test('Run on the Workflows surface lands on the new run, and never shows the previous run verdict', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const NEW = 'nscheck-2026-08-14T12-30-00';
  await stub(page, {
    /*
     * BOTH RUNS IN THE LIST, and this is the shape that makes the bug reachable at all.
     *
     * On the run page the dimension chips come from the LIST row, not the detail fetch —
     * `Runs.svelte:169`, `rows.find((r) => r.runId === openRun)`. With only the old run in the
     * list there is no row for the new one, the chips never render, and a test asserting on them
     * fails with `element(s) not found` while proving nothing. (Which is what happened: the first
     * two attempts at this rewrite both failed that way.)
     *
     * So the list holds the completed run AND the running one, which is what `/api/runs` answers
     * once a run has started. The trap is then live: two rows, two different verdicts, and the
     * page must pick by id.
     */
    runs: [CRAWL, { ...SWEEP, runId: NEW, status: 'running' }],
    started: { runId: NEW, type: 'NsCheck', queue: 'recon' },
    detail: {
      [CRAWL.runId]: () => detailOf(CRAWL),
      [NEW]: async () => {
        // The two-second gap, made deterministic. Nothing may report on this run until it answers.
        await new Promise((done) => setTimeout(done, 3000));
        return detailOf({ ...SWEEP, runId: NEW }, { execution: 'running' });
      },
    },
  });
  await page.goto('/');

  // WORKFLOWS, not Catalog. Run moved when the two surfaces split: Catalog became an inventory of
  // what exists and Workflows became where you work on one. The hand-off being tested is unchanged
  // and is the whole point — whichever surface starts a run, the id comes with it.
  await expect(async () => {
    await page.getByTestId('nav-workflows').click();
    await expect(page.getByTestId('run-button')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('workflow-file-nscheck.py')).toBeVisible();

  await page.getByTestId('run-button').click();

  /*
   * THE HAND-OFF, AT ITS THIRD ADDRESS, AND THE ASSERTION THAT SURVIVED BOTH MOVES.
   *
   * It first asserted `watching-run` and that `nav-runs` had become active. Then the run strip
   * arrived and it asserted `run-tail-id` with `nav-workflows` still active — Run watched the run
   * in place, so that pressing it did not take the author's code and input off screen.
   *
   * NOW RUN NAVIGATES. The strip is gone (`workflows/Workflows.svelte` records why: it put the
   * thing you had just started BELOW the fold of the thing you started it with, while `/runs/<id>`
   * was a whole surface built to answer exactly that question). So the id travels in the ADDRESS,
   * and the assertion moves with it — from a testid on the launcher to the URL and the run page's
   * own header. The invariant has not changed once across all three: whichever surface starts a
   * run, the id comes with it.
   */
  await page.waitForURL(new RegExp(`/runs/${NEW}$`), { timeout: 20_000 });
  await expect(page.getByTestId('run-detail-id')).toHaveText(NEW);
  await expect(page.getByTestId('nav-runs')).toHaveAttribute('data-active', 'true');

  /*
   * THE TRAP, which is what this test is really for and which has not moved at all.
   *
   * In the gap there is no detail for the new run, and whatever is shown then must not be the
   * verdict of the run above it in the list — `completed`, printed under an id one second old, is
   * the measured bug.
   *
   * WHAT CHANGED IS WHICH MECHANISM PREVENTS IT. The strip printed a placeholder (`…`) while it
   * waited. This page does not need one: the chip is keyed on the run id
   * (`rows.find((r) => r.runId === openRun)`), so it cannot render another run's verdict — the
   * defect is unreachable by construction rather than papered over by a default. The assertion is
   * kept anyway, because "unreachable by construction" is a property of one line that somebody
   * could change without noticing what it was holding up.
   *
   * A NOTE ON THE MATCHER, since it cost two runs to learn. `not.toHaveText()` requires the
   * element to EXIST and merely hold different text; on a missing element it fails with
   * `element(s) not found` rather than passing. It cannot express "absent or different" — so if
   * this page ever goes back to gating the chip, this line must become `toHaveCount(0)`, not be
   * left to pass vacuously.
   */
  await expect(page.getByTestId('run-execution')).not.toHaveText('completed');

  // …and once the run answers for itself, it says what IT is doing.
  await expect(page.getByTestId('run-execution')).toHaveText('running', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('the Runs surface: prefilled typed input, typed output, and a run whose one error shows in full with its record', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const RUN = 'hunt-2026-09-20T08-49-00';
  // The actor's OWN error.message, verbatim, as `hunt`'s `_log_drops` writes it when a Unit is
  // isolated — a socket failure, the kind that actually drops a desync Unit. Not composed here.
  const DROP_ERROR = 'read tcp 10.0.0.14:41022->203.0.113.7:443: read: connection reset by peer';
  // The real desync erratic string (main.go), verbatim — carried in the dataset's void_reason column.
  const ROW_ERROR = 'baseline not reproducible — refusing to scan (statuses [200 200 200])';

  // A run that FINISHED CLEANLY and wrote its output — mostly green, with one findable error, not a
  // wall of red. Both dimensions agree here (completed + complete).
  const HUNT = {
    runId: RUN,
    type: 'Hunt',
    status: 'completed',
    tenant: 'acme',
    startedAt: Date.parse('2026-09-20T08:49:00Z'),
    closedAt: Date.parse('2026-09-20T09:07:00Z'),
    dispatches: 16,
    materialization: { total: 1, pending: 0, running: 0, complete: 1, failed: 0, rows: 1796, bytes: 262144 },
    lifecycle: 'completed',
  };

  // The workflow's declared input + output schemas — what the typed form and typed output draw from.
  const HUNT_DESCRIPTOR = {
    name: 'Hunt',
    queue: 'wf-hunt-0a4be1b6cdea',
    description: 'Attack the mapped surface for desyncs, two axes, and own the leads.',
    input: {
      type: 'object',
      required: ['program'],
      properties: {
        program: { type: 'string', default: '8x8', description: 'Selects scope_<program> / exchanges_<program>; stamped on every row.' },
        machines: { type: 'integer', default: 4, description: 'Fleet width — how many machines poll the desync actor.' },
        rate_ms: { type: 'integer', default: 100, description: 'Per-HOST minimum gap between connections.' },
        tier: { type: 'integer', default: 1, description: 'Fold vector tier ceiling: 1 quick, 2 standard, 3 full.' },
        max_points: { type: 'integer', default: 40, description: 'Injection points probed per exchange.' },
        backoff: { type: 'boolean', default: true, description: 'Let a host widen its own gap on 429/503/reset.' },
      },
    },
    output: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: 'The Dataset this run wrote observations to.' },
        errors: { type: 'integer', description: 'Units the workflow could not test (erratic + voided), counted from its own dataset.' },
        suggested_query: { type: 'string', description: 'A query to list the failed units — a plain string, copy it into the Datasets workbench.' },
        note: { type: 'string', description: 'A free-text summary the workflow returns.' },
      },
    },
  };

  await stub(page, {
    runs: [HUNT],
    workflows: [HUNT_DESCRIPTOR],
    detail: {
      [RUN]: () =>
        detailOf(HUNT, {
          materializationRecords: [{ name: 'observations', kind: 'output', rows: 1796, state: 'complete' }],
        }),
    },
    // The lines a real hunt run writes: progress via `note()`, and — when a Unit is isolated —
    // `_log_drops` logging the actor's OWN error.message with the record in stream fields.
    logs: [
      { _time: Date.parse('2026-09-20T08:49:03Z'), level: 'info', _msg: 'corpus published: 12,330 technique(s) in 32 shard(s)', run_id: RUN },
      { _time: Date.parse('2026-09-20T08:50:00Z'), level: 'info', _msg: 'screen complete: 1796 observation(s)', run_id: RUN },
      {
        _time: Date.parse('2026-09-20T08:58:41Z'),
        level: 'error',
        _msg: DROP_ERROR,
        run_id: RUN,
        phase: 'sweep',
        category: 'host-loss',
        host: 'pay.8x8.com',
        endpoint: '/',
        unit_id: '8x8:pay.8x8.com:/',
      },
      { _time: Date.parse('2026-09-20T09:06:59Z'), level: 'info', _msg: 'sweep complete: 1796 observation(s)', run_id: RUN },
    ],
    /**
     * THE HISTORY THE PROGRESS REGION REDUCES.
     *
     * Each step is scheduled/started/completed, and the SUMMARY IS ON THE SCHEDULED EVENT ONLY —
     * which is the shape that broke the old timeline: it keyed lanes on `summary || detail`, so one
     * activity produced two lanes and the closing half was labelled `activityType=holdFleetLease`.
     * Written out in full here so the fixture keeps testing that.
     */
    history: [
      { id: 1, type: 'WorkflowExecutionStarted', cat: 'workflow', t: 0, at: 0, detail: 'workflowType=Sweep', attempt: 1, dur: 0 },
      { id: 2, type: 'ActivityTaskScheduled', cat: 'activity', t: 0.1, at: 0, detail: 'activityType=holdFleetLease · taskQueue=kontra-datasets', attempt: 1, dur: 0, summary: 'hold c-42' },
      { id: 3, type: 'ActivityTaskStarted', cat: 'activity', t: 0.2, at: 0, detail: 'activityType=holdFleetLease · identity=1@api', attempt: 1, dur: 0 },
      { id: 4, type: 'ActivityTaskCompleted', cat: 'activity', t: 0.9, at: 0, detail: 'activityType=holdFleetLease · identity=1@api', attempt: 1, dur: 0.7 },
      { id: 5, type: 'NexusOperationScheduled', cat: 'child', t: 1.0, at: 0, detail: 'endpoint=kontra-sweep-1-0-0 · nexus=kontra.actor/run', attempt: 1, dur: 0, summary: 'sweep · sweep@1.0.0 · 3 units' },
      { id: 6, type: 'NexusOperationStarted', cat: 'child', t: 1.1, at: 0, detail: 'endpoint=kontra-sweep-1-0-0', attempt: 1, dur: 0 },
      { id: 7, type: 'NexusOperationCompleted', cat: 'child', t: 9.4, at: 0, detail: 'endpoint=kontra-sweep-1-0-0', attempt: 1, dur: 8.3 },
    ],
    // WHAT THE LAKE ATTRIBUTES TO THIS RUN, which is what makes the DATASET region draw at all.
    datasets: [{
      name: 'observations',
      kind: 'output',
      version: '1.0.0',
      dt: '2026-09-20T08-49-00',
      rows: 1796,
      bytes: 262144,
    }],
    // WHAT THE RUN WAS STARTED WITH AND WHAT IT RETURNED — deliberately NOT the declared defaults.
    // `program` was sent as `vonage` where the schema's default is `8x8`, and `tier` was not sent at
    // all: the region has to show the first as a VALUE and the second as the default it fell back
    // to, because those are different facts and a form showing both identically is the bug this
    // region was rebuilt to fix.
    io: {
      input: { program: 'vonage', machines: 4, rate_ms: 100, max_points: 40, backoff: true },
      output: {
        dataset: 'observations',
        errors: 1,
        suggested_query: "SELECT * FROM observations WHERE void_reason <> ''",
        note: 'one host refused a reproducible baseline',
      },
    },
    // Mostly-ok rows; ONE dataset-error whose void_reason column carries the whole text.
    preview: {
      columns: [
        { name: 'host', type: 'VARCHAR' },
        { name: 'endpoint', type: 'VARCHAR' },
        { name: 'signals', type: 'INTEGER' },
        { name: 'erratic', type: 'BOOLEAN' },
        { name: 'void_reason', type: 'VARCHAR' },
      ],
      rows: [
        ['vcc-eu.8x8.com', '/api/thankyou', 2, false, ''],
        ['voapi.8x8.com', '/v2/session', 1, false, ''],
        ['cc.8x8.com', '/status', 3, false, ''],
        ['pay.8x8.com', '/', 0, true, ROW_ERROR],
        ['web.8x8.com', '/login', 1, false, ''],
      ],
      truncated: true,
    },
  });

  // Reached THROUGH THE NAV — Runs is a Surface, so it must be in the rail (the bug a screenshot
  // caught that a typecheck could not: the route worked while the nav omitted it).
  await page.goto('/');
  await expect(page.getByTestId('nav-runs')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('nav-runs').click();
  await expect(page.getByTestId('runs-list')).toBeVisible();
  await expect(page.getByTestId(`run-row-${RUN}`)).toBeVisible();
  await page.screenshot({ path: 'test-results/runs-list.png', fullPage: true });

  await page.getByTestId(`run-row-${RUN}`).click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-detail-id')).toHaveText(RUN);

  // THE INPUT REGION IS THE RUN, NOT THE SCHEMA — and that is the whole change. It used to print
  // each declared field's DEFAULT, footnoted "the run's recorded values land with the snapshot
  // store", so two runs of one workflow started with different arguments rendered identically.
  await expect(page.getByTestId('run-input')).toContainText('as started');
  // SENT: the value the run actually carried, not the `8x8` the schema declares.
  await expect(page.getByTestId('input-field-program')).toContainText('vonage');
  await expect(page.getByTestId('input-field-program')).not.toContainText('8x8');
  await expect(page.getByTestId('input-field-machines')).toContainText('4');
  await expect(page.getByTestId('input-field-backoff')).toContainText('true');
  // NOT SENT: drawn as the absence it is, naming the default the workflow used instead. An empty
  // box here would be indistinguishable from a field the page failed to fill in.
  await expect(page.getByTestId('input-field-tier')).toContainText('default 1');

  // THE OUTPUT REGION IS WHAT IT RETURNED, for the same reason — it used to print field names and
  // descriptions with no values at all.
  await expect(page.getByTestId('run-output')).toContainText('as returned');
  await expect(page.getByTestId('output-field-suggested_query')).toContainText('void_reason');
  await expect(page.getByTestId('output-field-errors')).toContainText('1');
  // The author's sentence survives beside the value — it is the only thing that says what a field
  // MEANS, and a decoded payload does not carry it.
  await expect(page.getByTestId('output-field-errors')).toContainText('could not test');

  // WHEN IT STARTED, spelled out. A run id carries an epoch and nobody reads one at a glance.
  await expect(page.getByTestId('run-started')).toContainText(/\d{1,2} \w{3} \d{4}/);

  // WHAT IT DID, as steps. The history stub above is one activity and one dispatch, so the region
  // names them in kontra's words rather than printing `activityType=…`.
  await expect(page.getByTestId('run-progress')).toBeVisible();
  await expect(page.getByTestId('run-step')).toHaveCount(2);
  await expect(page.getByTestId('run-progress')).toContainText('Hold the Fleet lease');
  await expect(page.getByTestId('run-progress')).toContainText('Sweep 3 units');
  // The raw history is a PEER, not a footnote: the same events, Temporal's own names.
  await page.getByTestId('tab-temporal').click();
  await expect(page.getByTestId('run-progress')).toContainText('ActivityTaskScheduled');
  await page.getByTestId('tab-steps').click();

  // THE TWO FEEDS ARE BEHIND HANDLES, because they are the only regions that grow while a run is
  // going and in the column they pushed everything under them down for the whole run.
  await expect(page.getByTestId('run-drawer')).toHaveAttribute('aria-hidden', 'true');

  // THE WORKFLOW-LOGGED DROP: the actor's own error message, verbatim, AND which record.
  await page.getByTestId('open-logs').click();
  await expect(page.getByTestId('run-drawer')).toHaveAttribute('aria-hidden', 'false');
  const logLine = page.getByTestId('log-line').filter({ hasText: 'connection reset by peer' });
  await expect(logLine).toContainText(DROP_ERROR);
  const record = logLine.getByTestId('log-record');
  await expect(record).toContainText('host=pay.8x8.com');
  await expect(record).toContainText('phase=sweep');

  // THE ERROR, in the DATASET. Switched on the DRAWER's own tab, not the page handle: the scrim
  // covers the page while a drawer is open, which is the point of it.
  await page.getByTestId('drawer-tab-dataset').click();
  const errCell = page.getByTestId('dataset-error-cell').filter({ hasText: 'baseline not reproducible' });
  await expect(errCell).toContainText(ROW_ERROR);

  // QUERY THESE ROWS — the link off to the workbench, carrying the dataset AND the run, so what
  // opens there is this run's rows and not whichever run wrote that name last.
  const toQuery = page.getByTestId('query-dataset');
  await expect(toQuery).toBeVisible();
  const href = await toQuery.getAttribute('href');
  expect(href).toContain('/datasets/observations');
  expect(href).toContain(`run=${RUN}`);
  expect(href).toContain('q=1');

  // ESC PUTS IT AWAY, and the page behind is where it was.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('run-drawer')).toHaveAttribute('aria-hidden', 'true');

  await page.screenshot({ path: 'test-results/runs-detail.png', fullPage: true });
  expect(errors).toEqual([]);
});

/**
 * THE DRAWER IS A VIEWPORT-TALL PANEL AND EVERY CLAIM BELOW IS GEOMETRY, so it is here and not in
 * vitest: jsdom has no layout engine, `clientHeight` is 0 for every element in it, and a drawer
 * whose content is painted 900px below the fold passes every assertion a DOM-only runner can make.
 *
 * WHAT IT IS FOR. Both drawers shipped unable to scroll. `.dbody` was `flex: 1; min-height: 0` with
 * no `overflow-y`, so content taller than the panel was painted outside it and no wheel, key or
 * scrollbar reached it — measured before the fix at 1280x700 with the fixtures below: 1146px of the
 * Dataset table and 449px of the log rail hung below the bottom of the drawer, unreachable. The
 * width was `min(620px, 94vw)` with no affordance at all.
 *
 * The fixtures are deliberately bigger than the panel in BOTH axes — 60 rows, 8 wide columns, 40 log
 * lines — because a fixture that fits proves nothing about a fixture that does not.
 */
test('the Dataset and Logs drawers scroll to their last line, and the drawer resizes and remembers its width', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const RUN = 'sweep-2026-09-21T10-00-00';
  const SWEEP_RUN = {
    runId: RUN,
    type: 'Sweep',
    status: 'completed',
    tenant: 'acme',
    startedAt: Date.parse('2026-09-21T10:00:00Z'),
    closedAt: Date.parse('2026-09-21T10:11:00Z'),
    dispatches: 3,
    materialization: { total: 1, pending: 0, running: 0, complete: 1, failed: 0, rows: 60, bytes: 8192 },
    lifecycle: 'completed',
  };

  // Eight columns of long values: wider than a 620px drawer, so the table has to scroll SIDEWAYS
  // inside its own box. If it widened the page instead, `scripts/overflow.mjs`'s rule would be
  // broken by a surface that is only reachable after a click and so is never measured by it.
  const COLUMNS = ['host', 'endpoint', 'point', 'technique', 'signal', 'baseline', 'node', 'note'].map(
    (name) => ({ name, type: 'VARCHAR' })
  );
  const ROWS = Array.from({ length: 60 }, (_, i) => [
    `host-${String(i).padStart(2, '0')}.vonage.example`,
    `/api/v2/resource/${i}/detail`,
    `header:x-forwarded-for#${i}`,
    `te-cl.${i % 7}`,
    `signal-${i}`,
    `baseline-${i}-abcdefabcdef`,
    `machine-${i % 4}.fleet.internal`,
    i === 59 ? 'LAST ROW' : `note ${i}`,
  ]);
  // The rail is NEWEST FIRST (`logs.ts` sorts descending on `ts`), so the line at the BOTTOM of the
  // list — the one that needs scrolling to — is the oldest. Both ends are named so that a change to
  // that ordering fails here rather than quietly turning this into a test of the top of the list.
  const LOGS = Array.from({ length: 40 }, (_, i) => ({
    _time: Date.parse('2026-09-21T10:00:00Z') + i * 1000,
    level: 'info',
    _msg:
      i === 0
        ? 'OLDEST LINE'
        : i === 39
          ? 'NEWEST LINE'
          : `probed host-${String(i).padStart(2, '0')}.vonage.example`,
    run_id: RUN,
  }));

  await stub(page, {
    runs: [SWEEP_RUN],
    detail: { [RUN]: () => detailOf(SWEEP_RUN) },
    logs: LOGS,
    datasets: [{ name: 'observations', kind: 'output', version: '1.0.0', dt: '2026-09-21T10-00-00', rows: 60, bytes: 8192 }],
    io: { input: { program: 'vonage' }, output: { dataset: 'observations' } },
    preview: { columns: COLUMNS, rows: ROWS, truncated: false },
  });

  // 700px tall on purpose. The suite's default is 720 and a taller window hides exactly the bug
  // this test is about — the panel only fails to scroll once its content does not fit.
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(`/runs/${RUN}`);
  await expect(page.getByTestId('run-detail')).toBeVisible({ timeout: 20_000 });

  const drawer = page.getByTestId('run-drawer');
  const body = page.getByTestId('drawer-body');

  /** How far a box's content spills past its own bottom edge. Zero is the only passing answer for
   *  a fixed-height panel: anything else is painted off the panel with no way to bring it back. */
  const spill = (el: import('@playwright/test').Locator) =>
    el.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop);

  // ── DATASET ───────────────────────────────────────────────────────────────────────────────────
  await page.getByTestId('open-dataset').click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByTestId('dataset-row')).toHaveCount(60);

  // NOTHING HANGS OUT OF THE PANEL. This is the assertion that was failing: the drawer is
  // `position: fixed` at viewport height, so a positive number here is content off-screen forever.
  expect(await spill(drawer)).toBe(0);

  const table = page.getByTestId('dataset-scroller');
  // The rows are taller than the box that holds them, and that box is the one that scrolls.
  const down = await table.evaluate((n) => {
    const before = n.scrollHeight - n.clientHeight;
    n.scrollTop = n.scrollHeight;
    return { before, after: n.scrollTop };
  });
  expect(down.before).toBeGreaterThan(0);
  expect(down.after).toBeGreaterThan(0);

  // AND THE LAST ROW IS ACTUALLY ON SCREEN once you have scrolled there — the only form of this
  // claim a reader cares about. `scrollHeight > clientHeight` is satisfied by a box that scrolls
  // its content behind something else.
  const lastRow = page.getByTestId('dataset-row').last();
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toContainText('LAST ROW');
  const panel = await drawer.boundingBox();
  const seen = await lastRow.boundingBox();
  expect(panel).not.toBeNull();
  expect(seen).not.toBeNull();
  expect(seen!.y + seen!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);

  // THE HEADER STAYS PUT while the rows move under it. It is `position: sticky` against the table's
  // own scroller, which only works while that scroller is the one being scrolled.
  const head = page.locator('thead th').first();
  const stuck = await head.boundingBox();
  const wrap = await table.boundingBox();
  expect(stuck!.y).toBeLessThanOrEqual(wrap!.y + 2);

  // WIDE CONTENT SCROLLS INSIDE ITS OWN BOX, and the page does not move sideways. 320/390/1280 are
  // covered with the drawer SHUT by `scripts/overflow.mjs`; this is the open case, which that guard
  // cannot reach.
  expect(await table.evaluate((n) => n.scrollWidth - n.clientWidth)).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBe(0);
  expect(await body.evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);

  // ── LOGS ──────────────────────────────────────────────────────────────────────────────────────
  await page.getByTestId('drawer-tab-logs').click();
  await expect(page.getByTestId('log-line')).toHaveCount(40);
  expect(await spill(drawer)).toBe(0);

  const rail = page.getByTestId('log-scroller');
  const railDown = await rail.evaluate((n) => {
    const before = n.scrollHeight - n.clientHeight;
    n.scrollTop = n.scrollHeight;
    return { before, after: n.scrollTop };
  });
  expect(railDown.before).toBeGreaterThan(0);
  expect(railDown.after).toBeGreaterThan(0);

  await expect(page.getByTestId('log-line').first()).toContainText('NEWEST LINE');
  const lastLine = page.getByTestId('log-line').last();
  await lastLine.scrollIntoViewIfNeeded();
  await expect(lastLine).toContainText('OLDEST LINE');
  const railSeen = await lastLine.boundingBox();
  expect(railSeen!.y + railSeen!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);

  await page.screenshot({ path: 'test-results/drawer-logs.png' });

  // ── RESIZE ────────────────────────────────────────────────────────────────────────────────────
  const grip = page.getByTestId('drawer-resize');
  await expect(grip).toHaveAttribute('role', 'separator');
  await expect(grip).toHaveAttribute('aria-orientation', 'vertical');
  await expect(grip).toHaveAttribute('aria-valuemin', '320');
  // 94% of 1280, floored — the same share the CSS `min()` falls back to.
  await expect(grip).toHaveAttribute('aria-valuemax', '1203');

  const widthNow = async (): Promise<number> => Math.round((await drawer.boundingBox())!.width);
  expect(await widthNow()).toBe(620);

  // DRAGGING LEFT WIDENS IT, because the panel is anchored to the right edge. Driven through the
  // mouse rather than by dispatching events: pointer capture and `touch-action` are the parts most
  // likely to be wrong, and a synthetic `dispatchEvent` exercises neither.
  const gripBox = (await grip.boundingBox())!;
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2 - 260, gripBox.y + 300, { steps: 12 });
  await page.mouse.up();
  const dragged = await widthNow();
  expect(dragged).toBeGreaterThan(860);
  expect(dragged).toBeLessThan(900);

  // ARROW KEYS ON THE FOCUSED SEPARATOR — the path a reader on a keyboard has, and the reason the
  // handle is a focusable `separator` rather than a bare div with a pointer listener.
  await grip.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await widthNow()).toBe(dragged + 16);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await widthNow()).toBe(dragged - 16);
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  expect(await widthNow()).toBe(dragged + 48);

  // IT CANNOT SWALLOW THE VIEWPORT OR COLLAPSE. `End` and `Home` go to the two ends and stop there.
  await page.keyboard.press('End');
  expect(await widthNow()).toBe(1203);
  await page.keyboard.press('ArrowLeft');
  expect(await widthNow()).toBe(1203);
  await page.keyboard.press('Home');
  expect(await widthNow()).toBe(320);
  await page.keyboard.press('ArrowRight');
  expect(await widthNow()).toBe(320);
  // …and a drawer squeezed to its narrowest still does not push the page sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBe(0);

  // DOUBLE-CLICK RESTORES THE DEFAULT, which is the way back from a width you regret.
  await grip.dblclick();
  expect(await widthNow()).toBe(620);

  // ── IT IS REMEMBERED ──────────────────────────────────────────────────────────────────────────
  await page.keyboard.press('End');
  expect(await page.evaluate(() => localStorage.getItem('kontra.console.run-drawer.width'))).toBe('1203');

  // ACROSS A RELOAD, not merely across a close and re-open. A width that survives only the former
  // is a variable, not a preference.
  await page.reload();
  await expect(page.getByTestId('run-detail')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-dataset').click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  expect(await widthNow()).toBe(1203);

  // ── NARROW IS A SHEET, AND A SHEET HAS NO EDGE TO DRAG ────────────────────────────────────────
  // 1203px was stored at 1280. At 390 it must not be applied, the handle must not be there to
  // reach for, and the panel is the 94vw sheet the CSS has always described.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(grip).toHaveCount(0);
  expect(await widthNow()).toBe(Math.round(390 * 0.94));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBe(0);
  // Still scrollable there — a sheet that cannot reach its last row is the same bug in a phone.
  expect(await spill(drawer)).toBe(0);
  expect(await page.getByTestId('dataset-scroller').evaluate((n) => n.scrollHeight - n.clientHeight)).toBeGreaterThan(0);

  // AND THE PREFERENCE SURVIVES THE VISIT TO A PHONE. The stored width is the reader's CHOICE; the
  // viewport only clamps what is applied, so going back to a wide window gets it back rather than
  // silently keeping whatever fitted on the narrow one.
  await page.setViewportSize({ width: 1280, height: 700 });
  expect(await widthNow()).toBe(1203);

  // ── REDUCED MOTION ────────────────────────────────────────────────────────────────────────────
  // The drawer declares its own 200ms slide and the scrim its own 180ms fade, and NEITHER carries a
  // local `prefers-reduced-motion` block: `tokens.css` clamps every transition in the bundle to
  // 0.01ms with `!important`. That is a claim about a stylesheet two directories away, so it is
  // measured here rather than asserted in a comment. Width is not in this list because it is never
  // transitioned at any setting — a drag that eases lags the finger holding it.
  const easing = () =>
    page.evaluate(() => {
      const d = document.querySelector('[data-testid="run-drawer"]') as HTMLElement;
      const s = document.querySelector('.scrim') as HTMLElement;
      return [getComputedStyle(d).transitionDuration, getComputedStyle(s).transitionDuration];
    });
  expect(await easing()).toEqual(['0.2s', '0.18s']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await easing()).toEqual(['1e-05s', '1e-05s']);
  await page.emulateMedia({ reducedMotion: null });

  await page.screenshot({ path: 'test-results/drawer-resized.png' });
  expect(errors).toEqual([]);
});

/**
 * THE SAME HANDLE, DRAGGED WITH A FINGER.
 *
 * Its own context because `hasTouch` is a browser-launch fact, and its own test because the touch
 * path is the one that fails silently: a `pointerdown` listener alone looks correct and does
 * nothing, because without `touch-action: none` the browser claims the gesture as a scroll before
 * the first `pointermove` is ever delivered. Driven through CDP rather than `dispatchEvent` for the
 * same reason — `touch-action` applies to real touches, so a synthetic one would pass either way.
 */
test.describe(() => {
  test.use({ hasTouch: true });

  test('the drawer edge can be dragged with a finger, and the gesture is not stolen by the scroller', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const RUN = 'touch-2026-09-22T08-00-00';
    const ROW = {
      runId: RUN,
      type: 'Sweep',
      status: 'completed',
      tenant: 'acme',
      startedAt: Date.parse('2026-09-22T08:00:00Z'),
      closedAt: Date.parse('2026-09-22T08:02:00Z'),
      dispatches: 1,
      materialization: { total: 1, pending: 0, running: 0, complete: 1, failed: 0, rows: 40, bytes: 2048 },
      lifecycle: 'completed',
    };
    await stub(page, {
      runs: [ROW],
      detail: { [RUN]: () => detailOf(ROW) },
      datasets: [{ name: 'observations', kind: 'output', version: '1.0.0', dt: '2026-09-22T08-00-00', rows: 40, bytes: 2048 }],
      io: { input: {}, output: {} },
      // Taller than the panel on purpose: the scroller has to be live underneath the gesture for
      // "the scroller did not take it" to mean anything.
      preview: {
        columns: [{ name: 'host', type: 'VARCHAR' }],
        rows: Array.from({ length: 40 }, (_, i) => [`host-${i}.vonage.example`]),
        truncated: false,
      },
    });

    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/runs/${RUN}`);
    await expect(page.getByTestId('run-detail')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('open-dataset').click();

    const drawer = page.getByTestId('run-drawer');
    const table = page.getByTestId('dataset-scroller');
    expect(Math.round((await drawer.boundingBox())!.width)).toBe(620);

    const cdp = await page.context().newCDPSession(page);
    const box = (await page.getByTestId('drawer-resize').boundingBox())!;
    const x0 = box.x + box.width / 2;
    const y0 = box.y + 300;
    const at = (x: number) => [{ x, y: y0, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x0) });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x0 - i * 25) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    expect(Math.round((await drawer.boundingBox())!.width)).toBe(820);
    expect(await page.evaluate(() => localStorage.getItem('kontra.console.run-drawer.width'))).toBe('820');
    // The finger crossed 200px of a live scroller and moved it nowhere.
    expect(await table.evaluate((n) => n.scrollTop)).toBe(0);
    expect(await page.getByTestId('drawer-body').evaluate((n) => n.scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  });
});
