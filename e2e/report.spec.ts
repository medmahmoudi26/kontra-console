import { expect, test } from '@playwright/test';

/**
 * THE REPORT PAGE, IN A BROWSER.
 *
 * There are no component tests in this repo — logic lives in `.ts` modules tested in vitest, and
 * anything RENDERED is proven here. So this file is the only evidence that a snapshot reaches the page
 * at all: that the mdast walker emits a heading and a table, that a code block's markers are visible,
 * that `␍` appears where a CRLF was, and that a note posts.
 *
 * ONE `page.route` FOR THE WHOLE API, switched on pathname, most specific first. Playwright matches
 * handlers in reverse registration order, so a second glob would silently win for both paths —
 * `runs.spec.ts` records that trap and this file follows its shape.
 */

/** The bytes a `{% code "http" %}` block holds: CRLF endings, a tab, a NUL and a non-UTF-8 byte. */
const BLOCK_BYTES = [
  ...'POST /login HTTP/1.1\r\n'.split('').map((c) => c.charCodeAt(0)),
  ...'Authorization: [redacted]\r\n'.split('').map((c) => c.charCodeAt(0)),
  ...'X-Trace:\tabc\r\n'.split('').map((c) => c.charCodeAt(0)),
  0x00,
  0xff,
  0x0a,
];

const b64 = (bytes: number[]): string => Buffer.from(Uint8Array.from(bytes)).toString('base64');

const SNAPSHOT = {
  v: 1,
  root: {
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'enrich over catalog-eu' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: '12,480 products enriched; ' },
          { type: 'strong', children: [{ type: 'text', value: '214' }] },
          { type: 'text', value: ' had no image.' },
        ],
      },
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'products' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'missing' }] },
            ],
          },
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: '12480' }] },
              { type: 'tableCell', children: [{ type: 'text', value: '214' }] },
            ],
          },
        ],
      },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Sample request' }] },
      { type: 'code', lang: 'http', blockId: 'b1', value: 'POST /login HTTP/1.1' },
    ],
  },
  blocks: {
    b1: {
      lang: 'http',
      b64: b64(BLOCK_BYTES),
      redacted: true,
      truncated: false,
      fullBytes: BLOCK_BYTES.length,
      source: 'text',
    },
  },
};

interface Stubs {
  /** `absent` is a 404, which is a STATE and not a failure — most just-finished runs are briefly it. */
  report?: 'ok' | 'error' | 'absent' | 'broken';
  notes?: Array<Record<string, unknown>>;
  versions?: number;
  /** What `POST /feedback` answers: a note, or a refusal with a sentence. */
  post?: { status: number; body: unknown };
}

const RUN = 'enrich-1791234567';

async function stub(page: import('@playwright/test').Page, s: Stubs = {}): Promise<Array<Record<string, unknown>>> {
  const posted: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.startsWith('/api/panels')) return route.abort();

    if (path.endsWith('/feedback') && method === 'POST') {
      posted.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      const answer = s.post ?? {
        status: 201,
        body: {
          id: 'n-new',
          runId: RUN,
          workflow: 'enrich',
          author: 'mohamed',
          authorKind: 'user',
          body: 'noted',
          createdAt: Date.now(),
        },
      };
      return json(answer.body, answer.status);
    }
    if (path.endsWith('/feedback')) return json({ runId: RUN, notes: s.notes ?? [] });

    if (path.endsWith('/report/versions')) {
      const n = s.versions ?? 1;
      return json({
        runId: RUN,
        versions: Array.from({ length: n }, (_, i) => ({
          version: n - i,
          status: 'ok',
          templateHash: 'sha256:aaa',
          renderedAt: 1_791_235_030_000,
          renderedBy: 'sweep',
        })),
      });
    }

    if (path.endsWith('/report')) {
      if (s.report === 'absent') return json({ error: 'no report' }, 404);
      if (s.report === 'broken') return json({ error: 'upstream' }, 502);
      if (s.report === 'error') {
        return json({
          runId: RUN,
          version: 1,
          status: 'error',
          templateHash: 'sha256:bad',
          renderedAt: 1_791_235_030_000,
          renderedBy: 'sweep',
          error: 'undefined variable: results, line:3, col:4',
        });
      }
      return json({
        runId: RUN,
        version: s.versions ?? 1,
        status: 'ok',
        templateHash: 'sha256:aaa',
        renderedAt: 1_791_235_030_000,
        renderedBy: 'sweep',
        snapshot: SNAPSHOT,
      });
    }

    // Everything the run surface asks for on its way to mounting.
    if (path === '/api/reports') {
      if (s.report === 'absent') return json({ reports: [] });
      return json({
        reports: [
          {
            runId: RUN,
            version: 2,
            status: s.report === 'error' ? 'error' : 'ok',
            templateHash: 'sha256:aaa',
            renderedAt: Date.now() - 60_000,
            renderedBy: 'sweep',
            versions: 2,
            workflow: 'enrich',
            workspace: 'demo',
          },
        ],
      });
    }
    if (path === '/api/runs') return json([]);
    return json({});
  });
  return posted;
}

test.describe('a run report', () => {
  test('renders the snapshot the orchestrator stored', async ({ page }) => {
    await stub(page);
    await page.goto(`/reports/${RUN}`);

    const body = page.getByTestId('report-body');
    await expect(body).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'enrich over catalog-eu' })).toBeVisible();
    // The paragraph's inline nodes composed back into one sentence, strong included.
    await expect(body).toContainText('12,480 products enriched; 214 had no image.');
    await expect(body.locator('strong')).toHaveText('214');
    // A GFM table, with a header row that came from the tree's first row.
    await expect(body.locator('table thead th')).toHaveText(['products', 'missing']);
    await expect(body.locator('table tbody td')).toHaveText(['12480', '214']);
    await expect(page.getByTestId('report-status')).toHaveText('rendered');
  });

  test('shows the bytes a code block holds, with the markers that make them legible', async ({ page }) => {
    await stub(page);
    await page.goto(`/reports/${RUN}`);

    const block = page.getByTestId('report-block-b1');
    await expect(block).toBeVisible();
    const text = page.getByTestId('report-block-text');
    // ␍ ON THE CRLF LINES. This is the assertion the whole marker design exists for: a reader can see
    // which lines ended CRLF, and a renderer that normalised them would have destroyed a finding.
    await expect(text).toContainText('␍');
    // → for the tab, \x00 for the NUL, \xff for the byte that is not a character.
    await expect(text).toContainText('→');
    await expect(text).toContainText('\\x00');
    await expect(text).toContainText('\\xff');
    // And the block says it was redacted, so nobody reads `[redacted]` as what the target received.
    await expect(block).toContainText('redacted');
  });

  test('switches that block to a hex view computed in the browser', async ({ page }) => {
    await stub(page);
    await page.goto(`/reports/${RUN}`);
    await page.getByTestId('report-block-b1').getByRole('button', { name: 'hex' }).click();
    const hex = page.getByTestId('report-block-hex');
    await expect(hex).toBeVisible();
    // The first line's offset and the first bytes of `POST`.
    await expect(hex).toContainText('00000000');
    await expect(hex).toContainText('50 4f 53 54');
  });

  test('says a render FAILED without pretending the run did', async ({ page }) => {
    await stub(page, { report: 'error' });
    await page.goto(`/reports/${RUN}`);
    await expect(page.getByTestId('report-status')).toHaveText('render failed');
    await expect(page.getByTestId('report-error')).toContainText('undefined variable: results');
    await expect(page.getByTestId('report-page')).toContainText('The run itself is unaffected');
  });

  test('explains an absent report rather than drawing an empty page', async ({ page }) => {
    await stub(page, { report: 'absent' });
    await page.goto(`/reports/${RUN}`);
    await expect(page.getByTestId('report-page')).toContainText('No report yet');
    // And it does NOT claim a failed read, which is the distinction `load.ts` keeps.
    await expect(page.getByTestId('report-missing')).toHaveCount(0);
  });

  test('NAMES a failed read, so an empty page is never silent', async ({ page }) => {
    await stub(page, { report: 'broken' });
    await page.goto(`/reports/${RUN}`);
    const missing = page.getByTestId('report-missing');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('/api/runs');
    await expect(missing).toContainText('502');
  });

  test('offers a version selector only when there is more than one version', async ({ page }) => {
    await stub(page, { versions: 1 });
    await page.goto(`/reports/${RUN}`);
    await expect(page.getByTestId('report-version')).toHaveCount(0);

    await stub(page, { versions: 3 });
    await page.goto(`/reports/${RUN}`);
    await expect(page.getByTestId('report-version')).toBeVisible();
    await expect(page.getByTestId('report-version').locator('option')).toHaveCount(3);
  });

  test('links to both exports and keeps the version on them', async ({ page }) => {
    await stub(page, { versions: 2 });
    await page.goto(`/reports/${RUN}`);
    const md = page.getByTestId('report-export-md');
    await expect(md).toHaveAttribute('href', /format=md&version=2/);
  });
});

test.describe('the feedback thread', () => {
  test('shows a note, and labels one written by a token', async ({ page }) => {
    await stub(page, {
      notes: [
        { id: 'n1', runId: RUN, workflow: 'enrich', author: 'mohamed', authorKind: 'user', body: 'line one\nline two', createdAt: Date.now() - 120_000 },
        { id: 'n2', runId: RUN, workflow: 'enrich', author: 'service-token', authorKind: 'token', body: 'proposed: per-feed timeout', createdAt: Date.now() - 30_000 },
      ],
    });
    await page.goto(`/reports/${RUN}`);
    const notes = page.getByTestId('report-note');
    await expect(notes).toHaveCount(2);
    await expect(notes.first()).toContainText('mohamed');
    await expect(notes.nth(1)).toContainText('via token');
    // PRE-WRAP, NOT MARKDOWN: the newline inside a note survives.
    await expect(notes.first().locator('.text')).toHaveText('line one\nline two');
  });

  test('posts a note and shows it without a reload', async ({ page }) => {
    const posted = await stub(page, { notes: [] });
    await page.goto(`/reports/${RUN}`);
    await page.getByTestId('report-note-input').fill('retry that feed with a longer timeout');
    await page.getByTestId('report-note-save').click();
    await expect(page.getByTestId('report-note')).toHaveCount(1);
    expect(posted).toHaveLength(1);
    // THE BODY CARRIES NO AUTHOR. The server resolves it from the credential, and a composer that sent
    // one would be sending something the route refuses.
    expect(Object.keys(posted[0]!)).toEqual(['body']);
  });

  test('keeps what somebody typed when the save is refused, and says why', async ({ page }) => {
    await stub(page, { notes: [], post: { status: 400, body: { error: 'a note cannot be empty' } } });
    await page.goto(`/reports/${RUN}`);
    await page.getByTestId('report-note-input').fill('  ');
    // A blank draft disables the button, which is the first guard.
    await expect(page.getByTestId('report-note-save')).toBeDisabled();
    await page.getByTestId('report-note-input').fill('something');
    await page.getByTestId('report-note-save').click();
    await expect(page.getByTestId('report-note-error')).toContainText('a note cannot be empty');
    // The draft is NOT cleared: losing what somebody typed is the one thing a text box must not do.
    await expect(page.getByTestId('report-note-input')).toHaveValue('something');
  });
});

test.describe('the Reports surface', () => {
  test('lists every run that has a report, and opens one', async ({ page }) => {
    await stub(page);
    await page.goto('/reports');
    const list = page.getByTestId('reports-list');
    await expect(list).toBeVisible();
    const row = page.getByTestId(`report-row-${RUN}`);
    await expect(row).toContainText(RUN);
    await expect(row).toContainText('enrich');
    await expect(row).toContainText('rendered');
    // Two versions, so the row says which of how many.
    await expect(row).toContainText('v2 of 2');
    await row.click();
    await expect(page.getByTestId('report-body')).toBeVisible();
    // And back to the list, not to the run.
    await page.getByTestId('report-back').click();
    await expect(page.getByTestId('reports-list')).toBeVisible();
  });

  test('a row is a real link, so it can be pasted or opened in a new tab', async ({ page }) => {
    await stub(page);
    await page.goto('/reports');
    await expect(page.getByTestId(`report-row-${RUN}`)).toHaveAttribute('href', `/reports/${RUN}`);
  });

  test('says nothing has been rendered rather than drawing an empty list', async ({ page }) => {
    await stub(page, { report: 'absent' });
    await page.goto('/reports');
    await expect(page.getByTestId('reports-empty')).toContainText('No reports yet');
    await expect(page.getByTestId('reports-missing')).toHaveCount(0);
  });
});

test.describe('the address', () => {
  test('is reachable from the BOTTOM of the run page, and the run page keeps its own header', async ({ page }) => {
    await stub(page);
    await page.goto(`/runs/${RUN}`);
    const link = page.getByTestId('run-to-report');
    await expect(link).toBeVisible();
    // It points at the REPORTS surface, not at a tab under the run.
    await expect(link).toHaveAttribute('href', `/reports/${RUN}`);
    // The run page's header is its own: one control, `‹ Runs`.
    await expect(page.getByTestId('run-detail').locator('.back')).toHaveText('‹ Runs');
    await link.click();
    await expect(page.getByTestId('report-page')).toBeVisible();
  });

  test('refuses the old tab address, so one thing has one URL', async ({ page }) => {
    await stub(page);
    await page.goto(`/runs/${RUN}/report`);
    // `/runs/<id>/report` is not an address this app has any more; it must not render a report.
    await expect(page.getByTestId('report-body')).toHaveCount(0);
  });

  test('survives a reload, which is what makes it pasteable', async ({ page }) => {
    await stub(page);
    await page.goto(`/reports/${RUN}`);
    await expect(page.getByTestId('report-body')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('report-body')).toBeVisible();
  });
});
