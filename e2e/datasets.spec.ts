/**
 * A DATASET CELL CAN BE READ WHOLE — in a browser, against a stubbed orchestrator.
 *
 * WHY THIS IS A PLAYWRIGHT SPEC AND NOT A VITEST ONE. `CLAUDE.md` states the bar: "jsdom has no
 * layout engine, so every `clientHeight` is 0 and no layout bug is visible to it." The failure
 * this covers IS a layout bug — `white-space: nowrap; max-width: 44ch; overflow: hidden` with no
 * way to reach what was clipped — and a vitest assertion on `textContent` passes happily against
 * it, because the text is in the DOM. It is the RENDERED width that hid it. Only a real browser
 * can tell `scrollWidth > clientWidth` from a cell that fits.
 *
 * The orchestrator is `page.route`d rather than booted so the row under test can be shaped
 * exactly: one cell with two thousand characters in it, which is what a `desync` row carrying a
 * raw HTTP exchange looks like and is not reliably producible against a live cluster.
 *
 * It imports `test` from `./fixtures` for the reason `runs.spec.ts` gives — the projects set a
 * custom `streamerKind` option and a plain `test` treats an unknown option as an error. The `view`
 * fixture is never requested, so no streamer starts for these tests.
 */

import { expect, test } from './fixtures';

/** Long enough that no reasonable column width shows it whole. A real exchange is longer. */
const LONG = `GET /api/v2/accounts HTTP/1.1\r\nHost: target.example\r\n${'X-Padding: '.repeat(120)}\r\n\r\n`;

/** A MAP column. `cellText` flattens this to one line for the row; the inspector must not. */
const MAP_VALUE = { status: 200, headers: { server: 'nginx', 'content-length': '41213' }, redirects: 3 };

const DATASET = {
  name: 'exchanges_8x8',
  dataset: 'exchanges_8x8',
  kind: 'output',
  state: 'closed',
  rows: 135,
  bytes: 91_233,
  dt: '2026-09-21',
  dispatches: 8,
  runId: 'desync-1789865677',
};

const PREVIEW = {
  columns: [
    { name: 'url', type: 'VARCHAR' },
    { name: 'exchange', type: 'VARCHAR' },
    { name: 'response', type: 'MAP(VARCHAR, VARCHAR)' },
  ],
  rows: [
    ['https://target.example/a', LONG, MAP_VALUE],
    ['https://target.example/b', 'short', null],
  ],
  truncated: false,
};

async function stub(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // The streamer is not part of this test. Refusing is what the app already handles.
    if (path.startsWith('/api/panels')) return route.abort();

    if (path === '/api/datasets') return json([DATASET]);
    if (/^\/api\/datasets\/[^/]+\/preview$/.test(path)) return json(PREVIEW);
    if (/^\/api\/datasets\/[^/]+\/provenance$/.test(path)) {
      return json({ rows: 135, buckets: [] });
    }
    if (path === '/api/datasets/schema') return json([]);
    return json({});
  });
}

async function openTheDataset(page: import('@playwright/test').Page): Promise<void> {
  await stub(page);
  await page.goto('/');
  await page.getByTestId('nav-datasets').click();
  await page.getByText('exchanges_8x8').first().click();
  await expect(page.getByTestId('dataset-preview')).toBeVisible();
}

test('a long cell is clipped in the table — which is what makes the inspector necessary', async ({ page }) => {
  await openTheDataset(page);

  const cell = page.getByTestId('dataset-preview').locator('tbody td').nth(1);
  // THE BUG, MEASURED RATHER THAN DESCRIBED. The content overflows its box; before the inspector
  // there was nothing that could show the rest of it.
  const overflows = await cell.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(true);
});

test('clicking the cell shows the whole value', async ({ page }) => {
  await openTheDataset(page);

  await page.getByTestId('dataset-preview').locator('tbody td').nth(1).click();
  const inspector = page.getByTestId('cell-inspector');
  await expect(inspector).toBeVisible();

  // THE WHOLE VALUE, not a longer prefix of it. The tail is what the table destroyed.
  const shown = await inspector.locator('pre').innerText();
  expect(shown).toContain('GET /api/v2/accounts');
  expect(shown.length).toBeGreaterThan(1000);

  // And it names the column, because a value with no name is a riddle.
  await expect(inspector.locator('h2')).toHaveText(/exchange/);
});

test('a MAP is pretty-printed, not shown as the flattened line the row uses', async ({ page }) => {
  await openTheDataset(page);

  // `cellText` flattens a MAP to one line so it fits a row. Opening the inspector on THAT would
  // show the lossy rendering at full size — the shape a reader clicked to see.
  await page.getByTestId('dataset-preview').locator('tbody td').nth(2).click();
  const shown = await page.getByTestId('cell-inspector').locator('pre').innerText();
  expect(shown).toContain('"content-length": "41213"');
  expect(shown.split('\n').length).toBeGreaterThan(3);
});

test('escape closes it, because a dialog over a table has to be cheap to dismiss', async ({ page }) => {
  await openTheDataset(page);

  await page.getByTestId('dataset-preview').locator('tbody td').nth(1).click();
  await expect(page.getByTestId('cell-inspector')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cell-inspector')).toBeHidden();
});

test('a null cell opens too, and says null rather than showing nothing', async ({ page }) => {
  await openTheDataset(page);

  // A null and a blank string are different facts about a row. An inspector that opened empty for
  // one of them would erase the distinction the table goes to trouble to draw.
  await page.getByTestId('dataset-preview').locator('tbody tr').nth(1).locator('td').nth(2).click();
  await expect(page.getByTestId('cell-inspector').locator('pre')).toHaveText('null');
});

test('selecting text in a cell does not open the dialog over what is being read', async ({ page }) => {
  await openTheDataset(page);

  const cell = page.getByTestId('dataset-preview').locator('tbody td').first();
  // Drag across the cell, which is how somebody copies part of a value. A modal appearing on top
  // of the text being selected is the first way a click-to-inspect affordance becomes annoying.
  const box = await cell.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 4, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('cell-inspector')).toBeHidden();
});
