/**
 * demo.mjs — the whole first-run story, driven the way a person would drive it.
 *
 * Sign in, open the canary workflow, press Run WITHOUT TYPING ANYTHING, and photograph the run
 * while it is going and again when it is done. The "without typing anything" is the point: the
 * form is prefilled from the schema's declared defaults, so a reader whose first instinct is to
 * press the blue button gets the run the author described.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.KONTRA_CONSOLE_URL || 'http://localhost:8088';
const OUT = process.env.OUT || '/tmp/shots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const userBox = page.locator('input[name="user"]');
if (await userBox.count()) {
  await userBox.fill(process.env.KONTRA_CONSOLE_USER || 'shotbot');
  await page.locator('input[name="password"]').fill(process.env.KONTRA_CONSOLE_PASS || '');
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-testid^="nav-"]', { timeout: 20_000 });
}

await page.getByTestId('nav-workflows').click();
await page.getByText('canary', { exact: true }).first().click();
await page.waitForSelector('[data-testid="run-button"]', { timeout: 20_000 });
await page.waitForTimeout(1500);

// WHAT IS ON SCREEN BEFORE ANYTHING IS TYPED — the description, and every field already filled.
await page.screenshot({ path: `${OUT}/1-form.png` });
console.log(`${at()} form photographed`);

const filled = await page.locator('.form input[type="text"]').evaluateAll((els) =>
  els.map((e) => e.value)
);
console.log(`${at()} prefilled values: ${JSON.stringify(filled)}`);

const runButton = page.getByTestId('run-button');
console.log(`${at()} Run button says: ${JSON.stringify(await runButton.innerText())}`);
await runButton.click();
console.log(`${at()} pressed Run`);

// The run id appears on the watch strip and in the run list.
await page.waitForTimeout(12_000);
await page.screenshot({ path: `${OUT}/2-running.png` });
console.log(`${at()} running photographed`);

// THE NEWEST RUN BY START TIME, not the first row: `/api/runs` puts OPEN runs first, so a single
// wedged run from a previous session outranks the one this script just started — which is exactly
// how the first pass photographed somebody else's run.
let runId = '';
for (let i = 0; i < 60; i++) {
  const res = await page.request.get(`${BASE}/api/runs?limit=50`);
  const rows = await res.json();
  const row = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.startedAt >= t0)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (row) runId = row.runId;
  if (row && row.closedAt) {
    console.log(`${at()} ${row.runId} → ${row.status} in ${((row.closedAt - row.startedAt) / 1000).toFixed(1)}s`);
    break;
  }
  await page.waitForTimeout(3000);
}
if (!runId) throw new Error('no run started after this script did');

// The run page for it — the record, once the rows have landed.
await page.goto(`${BASE}/runs/${encodeURIComponent(runId)}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="run-dataset"]', { timeout: 30_000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/3-run-top.png` });
await page.mouse.wheel(0, 1300);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/4-run-bottom.png` });
console.log(`${at()} run page photographed`);

const io = await (await page.request.get(`${BASE}/api/runs/${encodeURIComponent(runId)}/io`)).json();
console.log(`input:  ${JSON.stringify(io.input)}`);
console.log(`output: ${JSON.stringify(io.output)}`);

await browser.close();
if (errors.length) process.stderr.write(`page errors:\n${errors.join('\n')}\n`);
console.log(`runId=${runId}`);
