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
 * It imports `test` straight from `@playwright/test`. It used to come from `./fixtures` for the
 * reason `runs.spec.ts` records — the config declared a `streamerKind` option and a plain `test`
 * treats an unknown option as an error — and both went with the Monitor.
 */

import { expect, test } from '@playwright/test';

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

/**
 * THE OTHER END OF THE RUN PAGE'S "query these rows" LINK.
 *
 * The run page composes `/datasets/<name>?run=<id>&q=1` and this is what has to happen when
 * somebody follows it: the workbench opens with the query already written, and SCOPED TO THE RUN.
 * A bare `SELECT * FROM <name>` would be a plausible wrong answer — a Dataset several runs append
 * to holds everybody's rows, the columns look right, and nothing on screen would say these are not
 * the rows that were clicked through from.
 *
 * A BROWSER TEST BECAUSE THE SEAM IS THE ADDRESS. `runScopedSql` and `parseAddress` are both unit
 * tested; what this covers is that the surface reads the one and calls the other on arrival, which
 * is exactly the wiring a unit test of either half cannot see.
 */
test('arriving from a run opens the workbench with that run’s query already written', async ({ page }) => {
  await stub(page);
  await page.goto('/datasets/exchanges_8x8?run=sweep-42&q=1');

  const box = page.getByTestId('dataset-query').locator('textarea');
  await expect(box).toHaveValue(/FROM exchanges_8x8/);
  await expect(box).toHaveValue(/WHERE run_id = 'sweep-42'/);
});

test('arriving without the flag leaves the workbench on its own starter query', async ({ page }) => {
  await stub(page);
  await page.goto('/datasets/exchanges_8x8');
  // No `run_id` filter invented for somebody who just opened the Datasets surface: the run is not
  // part of what they asked for, and scoping to one would hide rows they came to see.
  await expect(page.getByTestId('dataset-query').locator('textarea')).not.toHaveValue(/run_id/);
});

/**
 * ONE WIDE TABLE, WITH COLUMNS AN OPERATOR CAN DRAG (issue 04).
 *
 * Both halves are geometric, which is why they are here and not in vitest: "how many tables are on
 * screen" is a count of rendered elements, and "did the column get wider and stay wider" is a
 * measured width across a reload. `CLAUDE.md` sets the bar — jsdom has no layout engine, so a
 * `clientWidth` assertion there reads 0 whatever the code does.
 */
test('opening a dataset leaves ONE table on the page, not two stacked ones', async ({ page }) => {
  await stub(page);
  await page.goto('/');
  await page.getByTestId('nav-datasets').click();

  // The listing is the only table before a choice is made. (The workbench below has none until it
  // has run a query.)
  await expect(page.locator('table')).toHaveCount(1);

  await page.getByText('exchanges_8x8').first().click();
  await expect(page.getByTestId('dataset-preview')).toBeVisible();

  // …and still the only one after, because the listing collapsed into the way back rather than
  // staying on screen above the rows the operator came for.
  await expect(page.locator('table')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /all 1 dataset/ })).toBeVisible();
});

test('the way back restores the listing', async ({ page }) => {
  await openTheDataset(page);
  await page.getByRole('button', { name: /all 1 dataset/ }).click();

  await expect(page.getByTestId('dataset-preview')).toHaveCount(0);
  await expect(page.locator('table')).toHaveCount(1);
  await expect(page.getByText('click a row to look inside it')).toBeVisible();
});

test('a column can be dragged wider, and the width survives a reload', async ({ page }) => {
  await openTheDataset(page);

  const header = page.locator('table thead tr').first().locator('th').first();
  const before = (await header.boundingBox())!.width;

  const grip = header.locator('.grip');
  await expect(grip).toBeVisible();
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const after = (await header.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 100);

  // THE HALF THAT MATTERS. A table an operator has to re-fit every visit reads as unfinished, so
  // the width is asserted across a full reload rather than only across a re-render.
  await page.reload();
  await page.getByText('exchanges_8x8').first().click();
  await expect(page.getByTestId('dataset-preview')).toBeVisible();
  const restored = (await page.locator('table thead tr').first().locator('th').first().boundingBox())!.width;
  expect(Math.abs(restored - after)).toBeLessThan(6);
});

test('dragging a column does not also open the cell inspector', async ({ page }) => {
  await openTheDataset(page);

  const grip = page.locator('table thead tr').first().locator('th').first().locator('.grip');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  // A grip is inside a `<th>`; a stray click reaching the table would be one click meaning two
  // things, which is the property `DataTable` spends a prop comment refusing.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the page still does not scroll sideways at 390px with a dataset open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openTheDataset(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The table is what scrolls, inside its own box — ADR 0048 §4.
  const scrolls = await page.locator('.wrap').first().evaluate((n) => n.scrollWidth > n.clientWidth);
  expect(scrolls).toBe(true);
});

/**
 * THE WORKBENCH READS A STREAM (issue 03).
 *
 * The old path asked for 200 rows and waited for one JSON body; this reads NDJSON frames. What is
 * asserted here is what a unit test cannot see: that many frames become one table, that the column
 * TYPES came off the wire rather than being re-derived from values, and that a failure arriving
 * after a 200 keeps the rows it already delivered.
 */
const NDJSON = (frames: unknown[]): string => frames.map((f) => JSON.stringify(f)).join('\n') + '\n';

async function stubStream(page: import('@playwright/test').Page, frames: unknown[]): Promise<void> {
  await page.route('**/api/datasets/query/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: NDJSON(frames) })
  );
}

test('many frames become one table, and the types come off the wire', async ({ page }) => {
  await stub(page);
  await stubStream(page, [
    { columns: [{ name: 'host', type: 'VARCHAR' }, { name: 'hits', type: 'BIGINT' }] },
    { rows: [['a.com', 1], ['b.com', 2]] },
    { rows: [['c.com', 3]] },
    { done: { rows: 3, elapsedMs: 42 } },
  ]);
  await page.goto('/');
  await page.getByTestId('nav-datasets').click();

  // THE RUN BUTTON IS DISABLED ON AN EMPTY EDITOR, and the stubbed schema is empty so no starter
  // query is seeded. Typing one is what a person does anyway.
  await page.locator('textarea').first().fill('SELECT host, hits FROM whatever');
  await page.locator('button.run').click();

  // Three rows out of two separate frames.
  await expect(page.getByText('3 rows · 42 ms')).toBeVisible();
  await expect(page.getByText('c.com')).toBeVisible();

  // The header carries DuckDB's own type. Inferring from values could not tell BIGINT from DOUBLE,
  // and could not name the type of a column that arrived empty.
  await expect(page.locator('table thead th').filter({ hasText: 'bigint' })).toBeVisible();
});

test('a failure after the first frame keeps the rows that arrived', async ({ page }) => {
  await stub(page);
  await stubStream(page, [
    { columns: [{ name: 'host', type: 'VARCHAR' }] },
    { rows: [['a.com'], ['b.com']] },
    // No `done`. This is the 94-orphaned-partition shape: the read broke once it was already
    // underway, long past the status line.
    { error: 'IO Error: No files found that match the pattern' },
  ]);
  await page.goto('/');
  await page.getByTestId('nav-datasets').click();
  await page.locator('textarea').first().fill('SELECT host FROM whatever');
  await page.locator('button.run').click();

  // Both halves on screen: what arrived, and why it stopped. Dropping the rows would turn a
  // partial answer into a blank one, which is strictly less information.
  await expect(page.getByText('a.com')).toBeVisible();
  await expect(page.getByText('b.com')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No files found');
});

test('a query rejected before any frame shows the engine sentence and no table', async ({ page }) => {
  await stub(page);
  await page.route('**/api/datasets/query/stream', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Catalog Error: Table with name nope does not exist!' }),
    })
  );
  await page.goto('/');
  await page.getByTestId('nav-datasets').click();
  await page.locator('textarea').first().fill('SELECT * FROM nope');
  await page.locator('button.run').click();

  await expect(page.getByRole('alert')).toContainText('Table with name nope does not exist');
});
