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
 * It imports `test` from `./fixtures` rather than from `@playwright/test` — the projects set a
 * custom `streamerKind` option and a plain `test` treats an option it does not know as an ERROR,
 * not a no-op. The `view` fixture is never requested, so no streamer is started for these tests.
 */

import { expect, test } from './fixtures';

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
    if (/^\/api\/runs\/[^/]+\/history$/.test(path)) {
      return json({ events: [], scanned: 0, elided: 0, truncated: false });
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
    // The newest KNOWN run is `completed`. Reading its status while the new run has no detail yet
    // is the measured bug: `completed` printed under an id one second old.
    runs: [CRAWL],
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

  // THE HAND-OFF, AT ITS NEW ADDRESS. This asserted `watching-run` and then that `nav-runs` had
  // become active — and the second half is now wrong ON PURPOSE. Pressing Run used to call
  // `openRun`, which switched the view to Runs; that took the author's code, their input, the
  // worker's pane and the run off screen at the exact moment they wanted all four. The run is
  // watched HERE now, in `RunTail`, and the Runs surface is one deliberate click away. So the
  // invariant is unchanged — the id comes with the hand-off — and what carries it moved.
  await expect(page.getByTestId('run-tail-id')).toHaveText(NEW);
  await expect(page.getByTestId('nav-workflows')).toHaveAttribute('data-active', 'true');

  // THE TRAP, which is what this test is really for and which has not moved at all. In the gap
  // there is no detail for the new run, and whatever is shown then must not be the verdict of the
  // run above it in the list — `completed`, printed under an id one second old, is the measured
  // bug. The honest placeholder used to be the word `starting`; `RunTail` spells it `…`. Either is
  // fine and the assertion below is the one that matters: never a verdict it has not been told.
  await expect(page.getByTestId('run-tail-execution')).not.toHaveText('completed');
  await expect(page.getByTestId('run-tail-execution')).toHaveText('…');

  // …and once the run answers for itself, it says what IT is doing.
  await expect(page.getByTestId('run-tail-execution')).toHaveText('running', { timeout: 15_000 });
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

  // THE WORKFLOW-LOGGED DROP: the actor's own error message, verbatim, AND which record.
  const logLine = page.getByTestId('log-line').filter({ hasText: 'connection reset by peer' });
  await expect(logLine).toContainText(DROP_ERROR);
  const record = logLine.getByTestId('log-record');
  await expect(record).toContainText('host=pay.8x8.com');
  await expect(record).toContainText('phase=sweep');

  // THE ERROR, in the DATASET: the void_reason column carries the whole text on the failing record.
  const errCell = page.getByTestId('dataset-error-cell').filter({ hasText: 'baseline not reproducible' });
  await expect(errCell).toContainText(ROW_ERROR);

  await page.screenshot({ path: 'test-results/runs-detail.png', fullPage: true });
  expect(errors).toEqual([]);
});
