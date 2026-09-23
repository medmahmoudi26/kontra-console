/**
 * THE FIRST RUN ANYBODY DOES, driven end to end against a RUNNING stack.
 *
 * It presses Run on the canary WITHOUT TYPING ANYTHING and then asserts every link in the chain the
 * run page is made of: the form was prefilled from the schema, the workflow's own description
 * reached the screen, the run completed, the INPUT region shows the values that were actually sent,
 * the DATASET region fills from the lake, the log rail carries the ACTOR's lines, the OUTPUT region
 * shows what the workflow returned, and the Machines are gone afterwards.
 *
 *     KONTRA_CONSOLE_USER=… KONTRA_CONSOLE_PASS=… node e2e/canary.mjs
 *     SHOTS=/tmp/canary  …                        # …and photograph each stage
 *
 * ── IT PRESSES RUN, AND `live.mjs` DELIBERATELY DOES NOT ────────────────────────────────────────
 *
 * That file's header states the rule this one breaks: "It never presses Serve or Run — starting a
 * workflow from a verification script is how a check becomes a fleet." The rule is right, and the
 * exception is narrow and stated rather than assumed:
 *
 *   • The canary EXISTS to be started. It is the one workflow whose whole purpose is to be run by
 *     somebody who has just installed this, so "can it be run" is the property under test and
 *     there is no way to check it without running it.
 *   • It provisions ONE Machine on the `docker` provider — Warden containers on the Compose
 *     network, no cloud credential, no money. A run with `provider: cloud` is a different thing and
 *     this script never asks for one.
 *   • It asserts the teardown. A check that leaves a Fleet standing is the failure the rule is
 *     about, so the last assertion is that nothing is left.
 *
 * It is OPT-IN for the same reason: not collected by `pnpm test:e2e`, which is hermetic and stubs
 * the orchestrator. This one needs a real control plane, a real registry and ~90 seconds.
 *
 * ── WHY NOT A `.spec.ts` ────────────────────────────────────────────────────────────────────────
 *
 * `playwright.config.ts` boots a vite dev server against stub streamers and a stubbed orchestrator,
 * and every spec under `e2e/` is collected by it. A spec that needs :8088 would fail in CI for a
 * reason that has nothing to do with the code under test — which is how a suite gets an ignored
 * failure in it. A script, like `live.mjs`, is the shape this repo already uses for "against a
 * running stack".
 *
 * ── NO DEFAULT CREDENTIAL ───────────────────────────────────────────────────────────────────────
 *
 * `kontra init` mints the console login once and prints it once. A baked-in username is useless to
 * every other reader and a hint about an account on somebody's box, so both variables are required.
 */

import { mkdirSync } from 'node:fs';
// From `@playwright/test`, which is what this package actually depends on — a bare `playwright` is
// a transitive package and does not resolve under pnpm's strict layout.
import { chromium } from '@playwright/test';

const BASE = process.env.KONTRA_UI ?? 'http://localhost:8088';
const USER = process.env.KONTRA_CONSOLE_USER;
const PASS = process.env.KONTRA_CONSOLE_PASS;
const SHOTS = process.env.SHOTS ?? '';
/** How long a docker-provider canary may take. Measured at 69–89s; this is the ceiling, not the
 *  expectation, and a run that needs more than this has a problem worth failing for. */
const RUN_BUDGET_MS = Number(process.env.CANARY_BUDGET_MS ?? 240_000);

if (!USER || !PASS) {
  console.error('set KONTRA_CONSOLE_USER and KONTRA_CONSOLE_PASS (kontra init prints them once)');
  process.exit(2);
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let total = 0;
let failures = 0;
function check(name, ok, detail = '') {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});

const started = Date.now();
const json = async (path) => (await page.request.get(`${BASE}${path}`)).json();

// ── SIGN IN ─────────────────────────────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const userBox = page.locator('input[name="user"]');
if (await userBox.count()) {
  await userBox.fill(USER);
  await page.locator('input[name="password"]').fill(PASS);
  await page.locator('button[type="submit"]').click();
}
await page.waitForSelector('[data-testid^="nav-"]', { timeout: 30_000 });

// ── THE FORM, BEFORE ANYTHING IS TYPED ──────────────────────────────────────────────────────────
await page.getByTestId('nav-workflows').click();
await page.getByText('canary', { exact: true }).first().click();
await page.waitForSelector('[data-testid="run-button"]', { timeout: 30_000 });
await page.waitForTimeout(1500);
await shot('1-form');

const about = await page.getByTestId('workflow-about').textContent().catch(() => '');
check(
  "the workflow's own description is on screen",
  (about ?? '').includes('Provisions a Fleet'),
  (about ?? '').slice(0, 60)
);
// MARKDOWN IS STRIPPED, NOT RENDERED — `description.md` is markdown and this slot is a `<p>`, so
// the asterisks used to reach the screen. See `packages/core/src/panels/prose.ts`.
check('…as prose, with no markdown markers left in it', !/[*_`]/.test(about ?? ''), about ?? '');

const filled = await page.locator('.form input[type="text"]').evaluateAll((els) => els.map((e) => e.value));
check(
  'every text field is prefilled from its declared default',
  filled.length >= 7 && filled.filter((v) => v !== '').length >= 6,
  JSON.stringify(filled)
);
// THE LIST FIELD IS DRAWN AT ALL, which it was not: the form filtered to leaf nodes, so
// `targets: list[str]` — the FIRST field the workflow declares, with a default and a description —
// rendered nothing whatsoever. It is one JSON box rather than repeatable rows for now.
check('the list field is drawn, holding its default as JSON',
  filled.some((v) => v === '["alpha","beta"]'), JSON.stringify(filled));
// `fail_on` DECLARES `""`, so a blank box here is the author's answer and not a gap. The assertion
// above allows exactly one blank for that reason.
check('the Run button is enabled with nothing typed', await page.getByTestId('run-button').isEnabled());

// ── RUN ─────────────────────────────────────────────────────────────────────────────────────────
await page.getByTestId('run-button').click();

let run;
for (let waited = 0; waited < RUN_BUDGET_MS; waited += 3000) {
  const rows = await json('/api/runs?limit=20');
  // BY START TIME, NOT ROW ORDER: `/api/runs` puts OPEN runs first, so one wedged run from an
  // earlier session outranks the one this script just started.
  const mine = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.startedAt >= started)
    .sort((a, b) => b.startedAt - a.startedAt);
  run = mine[0];
  if (run?.closedAt) break;
  if (waited === 12_000) await shot('2-running');
  await page.waitForTimeout(3000);
}

check('a run started', Boolean(run), run?.runId ?? 'none');
if (!run) {
  await browser.close();
  console.log(`\n${total - failures}/${total} checks passed`);
  process.exit(1);
}

const seconds = run.closedAt ? (run.closedAt - run.startedAt) / 1000 : 0;
check('it closed inside the budget', Boolean(run.closedAt), `${seconds.toFixed(1)}s`);
check('it completed', run.status === 'completed', `${run.runId} → ${run.status}`);

// ── WHAT THE RUN RECORDED ───────────────────────────────────────────────────────────────────────
const io = await json(`/api/runs/${encodeURIComponent(run.runId)}/io`);
// THE FORM'S OWN VALUES, COERCED. An HTML input holds a string; `steps` is declared `int`, so a
// `"5"` here would be the bug `payloadOf`'s type coercion exists to prevent.
check('the run was started with the form\'s values', io?.input?.steps === 5 && io?.input?.every === 2,
  JSON.stringify(io?.input));
// …AND THE LIST SURVIVED THE ROUND TRIP. The box holds JSON text; `coerceField` parses it back, so
// what reaches the workflow is the list it declared and not the string the input held.
check('…including the list, parsed back from its box',
  Array.isArray(io?.input?.targets) && io.input.targets.join() === 'alpha,beta',
  JSON.stringify(io?.input?.targets));
check('it returned a complete result', io?.output?.complete === true,
  JSON.stringify(io?.output).slice(0, 160));
check('it produced every record it expected', io?.output?.records === io?.output?.expected,
  `${io?.output?.records} of ${io?.output?.expected}`);

const datasets = await json(`/api/runs/${encodeURIComponent(run.runId)}/datasets`);
// FROM THE LAKE, NOT THE LEDGER. `materializationRecords` is empty for every v2 Run, which is why
// the run page said "no output Dataset" over ten rows that were sitting there.
check('the lake attributes a Dataset to this run', Array.isArray(datasets) && datasets.length > 0,
  JSON.stringify((datasets ?? []).map((d) => `${d.name}:${d.rows}`)));
check('…holding the rows the sweep pushed', (datasets?.[0]?.rows ?? 0) === io?.output?.expected,
  `${datasets?.[0]?.rows} rows`);

// ── THE RUN PAGE ────────────────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/runs/${encodeURIComponent(run.runId)}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="run-dataset"]', { timeout: 60_000 });
await page.waitForTimeout(4000);
await shot('3-run-top');

const inputRegion = await page.getByTestId('run-input').textContent();
check('the INPUT region shows the run, not the schema', /as started/.test(inputRegion ?? ''));
check('…with a value the form sent', /\b5\b/.test(inputRegion ?? ''));

const datasetRegion = await page.getByTestId('run-dataset').textContent();
check('the DATASET region is not the empty state',
  !/recorded no output Dataset|wrote no rows/.test(datasetRegion ?? ''));
check('…and names the columns the actor emits',
  /target/.test(datasetRegion ?? '') && /phase/.test(datasetRegion ?? ''));
check('…with one row per record', /of \d+ rows/.test(datasetRegion ?? ''),
  (datasetRegion ?? '').match(/\d+ of \d+ rows/)?.[0] ?? '');

const logRegion = await page.getByTestId('run-log').textContent();
// THE ACTOR'S OWN LINES, which is the whole substitution for the typed stream that was removed:
// `canary: <target> <phase> (step n/m, …)` is emitted by the Method on a Machine, once every
// `every` seconds, and is what a reader watches instead of a progress pane.
check('the log rail carries the ACTOR\'s narration', /canary:/.test(logRegion ?? ''));
check('…including a per-phase line', /resolve|connect|handshake|probe|settle/.test(logRegion ?? ''));

await page.mouse.wheel(0, 1300);
await page.waitForTimeout(1500);
await shot('4-run-bottom');
const outputRegion = await page.getByTestId('run-output').textContent();
check('the OUTPUT region shows what was returned', /as returned/.test(outputRegion ?? ''));
check('…including the Dataset it wrote', /canary_signals/.test(outputRegion ?? ''));

// ── AND THE FLEET IS GONE ───────────────────────────────────────────────────────────────────────
//
// THE RULE THIS SCRIPT BREAKS IS THE ONE IT MUST PROVE IT KEPT. The scope exiting drops the Lease
// and the Machines die with it; a check that starts a Fleet and does not assert the teardown is the
// thing `live.mjs`'s header refuses to do.
const fleet = await json('/api/fleet').catch(() => null);
const machines = Array.isArray(fleet?.machines) ? fleet.machines : [];
check('the Fleet tore down with the run', machines.length === 0,
  machines.map((m) => m.name ?? m).join(', '));

// `dimensions` is the known xterm dispose race this repo already documents; a `ResizeObserver loop`
// notice is the browser's own throttling notice and is not an error in the page.
const real = pageErrors.filter((e) => !/dimensions|ResizeObserver loop/.test(e));
check('no page errors', real.length === 0, real.slice(0, 2).join(' ;; ').slice(0, 240));

await browser.close();
console.log(`\n${run.runId} — ${seconds.toFixed(1)}s`);
console.log(`${total - failures}/${total} checks passed`);
process.exit(failures > 0 ? 1 : 0);
