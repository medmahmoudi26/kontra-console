/**
 * An ADVERSARIAL second opinion on Settings › Infra, written not to confirm `infra.spec.ts` but to
 * attack the four things it does not drive.
 *
 * WHY A SECOND SPEC RATHER THAN MORE TESTS IN THE FIRST. `infra.spec.ts` is the author's own, and its
 * stub is built to make its claims reachable: one Fleet queue carrying exactly the four ADR states,
 * one control-stack role queue serving, one absent. Four things are therefore untested BY
 * CONSTRUCTION, and each of them is a way the page could be wrong while that file stays green:
 *
 *   1. THE FIFTH STATE. `machines.ts:368` exports five — `unknown` is "we could not ask Temporal", and
 *      its header spends a paragraph on why folding it into `nothing-polling` "would draw a red Fleet
 *      for an unreachable cluster and send an operator to restart Workers that are fine".
 *      `infra.spec.ts` asserts the four are four SHAPES; nothing asserts the fifth is a fifth. Below,
 *      all five are on one page at once and the form axis is measured across all of them.
 *   2. THE COLD MOUNT WITH NO API AT ALL. Every test in that file installs a stub before `goto`, so
 *      the page has never been driven the way an operator first meets it: a control plane that is not
 *      answering. `run.mjs:78` points `VITE_API_TARGET` at a dead port precisely so this state is
 *      machine-independent, and `loadInfra`'s every part degrades — but "degrades" is a claim about
 *      `pageerror`, which only a browser reports.
 *   3. REACHABILITY. `Infra.svelte:17-36` argues at length that this is a SECTION of `/settings` and
 *      not a ninth nav Surface. That is a claim about the nav rail, and `infra.spec.ts` navigates to
 *      `/settings` directly in all fifteen tests, so it never touches it. Here the page is reached by
 *      CLICKING, from another surface, and `/infra` is checked for NOT being an address.
 *   4. THE TYPE FLOOR, AS RENDERED. `scripts/type-scale.mjs` reads stylesheets, so it cannot see a
 *      cascade: an 11px token inherited into prose passes the guard and fails the rule. Every text
 *      node the section actually paints is measured against the 12px floor here, with `--t-micro`
 *      allowed only where the element really is uppercased.
 *
 * THE STUB IS MINE AND DELIBERATELY NOT THEIRS. Two placements on one Fleet — the second's queue is
 * absent from `/api/pollers` entirely, which is how `unknown` arrives on a Machine card rather than in
 * the `declared` bucket where a missing role route puts it.
 */

import { expect, test } from '@playwright/test';

/** `POLL_FRESH_MS` (`@kontra/core/queues:55`), restated for the same reason `infra.spec.ts:49` does. */
const POLL_FRESH_MS = 120_000;

const FLEET = 'kontra-fleet/dns';
const CONTROL = 'kontra-control/local';
/** `sharedQueue('nscheck', '0.1.0')` — the queue every state below is read on. */
const Q_SEEN = 'nscheck-0.1.0';
/** `sharedQueue('dnsprobe', '0.2.0')`. ABSENT from `/api/pollers`, which is what makes it `unknown`. */
const Q_UNSEEN = 'dnsprobe-0.2.0';

const identity = (pid: number, host: string, queue: string): string => `${pid}@${host}@${queue}`;

/**
 * Four Machines on `Q_SEEN` carrying the four ADR states, plus the two pollers that belong to no box.
 *
 * `kf-dns-04` IS ABSENT, which is `nothing-polling`. `Q_UNSEEN` is absent from the whole map, which is
 * `unknown` — `pollFor` returns it with `unknown: 'this queue was not reported'` for a report that is
 * `undefined`, and that is a different sentence from a describe error.
 */
function pollers(now: number): Record<string, unknown> {
  return {
    [Q_SEEN]: {
      queue: Q_SEEN,
      pollers: 5,
      identities: [],
      workers: [
        { identity: identity(41, 'kf-dns-01', Q_SEEN), lastPoll: now - 5_000 }, // serving
        { identity: identity(41, 'kf-dns-02', Q_SEEN), lastPoll: now - POLL_FRESH_MS - 60_000 }, // stale
        { identity: identity(41, 'kf-dns-03', Q_SEEN), lastPoll: 0 }, // undated
        { identity: identity(9182, 'dev-laptop', Q_SEEN), lastPoll: now - 12_000 },
        // `identityHost` returns undefined for this: fewer than two `@`-separated parts.
        { identity: 'ci-runner-7', lastPoll: 0 },
      ],
      lastPoll: now - 5_000,
    },
  };
}

/** Two placements. The second's queue is never reported, so its rows are the fifth state. */
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
      { actorName: 'nscheck', actorVersion: '0.1.0', maxSessions: 8 },
      { actorName: 'dnsprobe', actorVersion: '0.2.0', maxSessions: 4 },
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

const CONTROL_STATE = {
  fqn: CONTROL,
  project: 'kontra-control',
  stack: 'local',
  updated: new Date().toISOString(),
  outputs: {},
  resources: [
    {
      urn: 'b',
      type: 'docker:index/container:Container',
      name: 'orchestrator-api',
      synthetic: false,
      detail: { name: 'orchestrator-api' },
    },
  ],
};

const ASSIGNMENTS = [
  {
    role: 'materializer',
    purpose: 'dataset write, paging and retention',
    queue: 'kontra-datasets',
    variable: 'KONTRA_DATASET_QUEUE',
    slots: 1,
  },
];

/**
 * The whole API, switched on pathname, most specific first — `runs.spec.ts:116` records that
 * Playwright matches handlers in REVERSE registration order.
 *
 * `describeFails` is the one knob: it makes `/api/queues/kontra-datasets/pollers` answer with an
 * `error` field, which is the OTHER road to `unknown` — a report that exists and says the cluster
 * could not be asked, as opposed to a report that is not there at all.
 */
async function stub(
  page: import('@playwright/test').Page,
  opts: { describeFails?: boolean } = {}
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const now = Date.now();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.startsWith('/api/panels')) return route.abort();

    const state = /^\/api\/infra\/stacks\/([^/]+)\/state$/.exec(path);
    if (state) {
      const fqn = decodeURIComponent(state[1]!);
      if (fqn === CONTROL) return json(CONTROL_STATE);
      if (fqn === FLEET) return json(FLEET_STATE);
      return json({ error: 'no such stack' }, 404);
    }
    if (/^\/api\/infra\/stacks\/([^/]+)\/history$/.test(path)) return json({ records: [] });
    if (path === '/api/infra/stacks') return json({ stacks: [CONTROL, FLEET] });
    if (path === '/api/infra/registry/resolve') return json({ error: 'not found' }, 404);
    if (path === '/api/infra/roles') {
      return json({ roles: ['api', 'materializer'], assignments: ASSIGNMENTS });
    }

    const queue = /^\/api\/queues\/([^/]+)\/pollers$/.exec(path);
    if (queue) {
      const q = decodeURIComponent(queue[1]!);
      if (opts.describeFails === true) {
        // `routes/pollers.ts` shape for a cluster it could not describe. NOT an HTTP error: the route
        // answered, and what it said was "I could not ask".
        return json({ queue: q, error: 'connection refused describing task queue' });
      }
      return json({
        queue: q,
        pollers: 1,
        identities: [],
        workers: [{ identity: identity(9, 'orchestrator-api', q), lastPoll: now - 3_000 }],
        lastPoll: now - 3_000,
      });
    }

    if (path === '/api/pollers') return json(pollers(now));
    return json({});
  });
}

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.stack ?? String(err)));
  return errors;
}

const pollRow = (page: import('@playwright/test').Page, machine: string, queue: string) =>
  page.getByTestId(`poll-${machine}::${queue}`);

/**
 * Everything about one row a reader without colour vision still has.
 *
 * THE GLYPH AND THE WORD ARE PART OF THE FORM, not decoration. A border style shared between two
 * states is only a defect if nothing else separates them, so the tuple has to carry all three or the
 * verdict is unfair in either direction.
 */
async function formOf(locator: import('@playwright/test').Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const flag = el.querySelector('.flag');
    const glyph = flag?.querySelector('.glyph');
    return {
      state: el.getAttribute('data-state'),
      border: `${cs.borderLeftStyle} ${cs.borderLeftWidth}`,
      colour: cs.borderLeftColor,
      glyph: (glyph?.textContent ?? '').trim(),
      word: (flag?.textContent ?? '').replace((glyph?.textContent ?? '').trim(), '').trim(),
      flagColour: flag === null ? '' : getComputedStyle(flag).color,
      title: flag?.getAttribute('title') ?? '',
    };
  });
}

test('the Surface is reached the way an operator reaches it: by clicking Settings in the nav', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);

  // FROM ANOTHER SURFACE, not from `/settings`. `infra.spec.ts` only ever deep-links, so nothing there
  // proves the section survives a same-bundle move — and `lib/surfaces.ts:go` makes that move a
  // different code path from a document load.
  await page.goto('/catalog');
  // `Shell.svelte:56-65` — one `<nav aria-label="Surfaces">` of BUTTONS, not links: a move inside this
  // bundle never leaves the document, and an `<a href>` that calls `preventDefault` is a promise of a
  // navigation it does not make.
  const nav = page.getByRole('navigation', { name: 'Surfaces' });
  await expect(nav).toBeVisible();
  await expect(nav.getByTestId('nav-settings')).toBeVisible();

  // INFRA IS NOT A NINTH NAV ENTRY, and `Infra.svelte:17-36` says why: a segment the orchestrator's
  // `SPA_SURFACES` does not carry 404s on a COLD load and only on a cold load. Asserted, so a later
  // edit that adds the nav entry without the server's list trips here.
  await expect(nav.getByTestId('nav-infra')).toHaveCount(0);
  await expect(nav).not.toContainText('Infra');

  await nav.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(nav.getByTestId('nav-settings')).toHaveAttribute('data-active', 'true');

  // And the section is there, with its own heading, after a click rather than a load.
  const infra = page.getByTestId('infra');
  await expect(infra).toBeVisible();
  await expect(infra.getByRole('heading', { name: 'Infra', level: 2 })).toBeVisible();
  // Not still on its loading line: the mount read actually resolved.
  await expect(page.getByTestId('infra-facts')).toBeVisible();

  expect(errors).toEqual([]);
});

test('all FIVE poll states are on one page and no two share a form', async ({ page }) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');
  await expect(page.getByTestId(`stack-${FLEET}`)).toBeVisible();

  // Four on the reported queue; the fifth on the queue `/api/pollers` never mentioned.
  const rows = [
    pollRow(page, 'kf-dns-01', Q_SEEN),
    pollRow(page, 'kf-dns-02', Q_SEEN),
    pollRow(page, 'kf-dns-03', Q_SEEN),
    pollRow(page, 'kf-dns-04', Q_SEEN),
    pollRow(page, 'kf-dns-01', Q_UNSEEN),
  ];
  for (const r of rows) await expect(r).toBeVisible();

  const forms = [];
  for (const r of rows) forms.push(await formOf(r));

  expect(forms.map((f) => f.state)).toEqual([
    'serving',
    'stale',
    'undated',
    'nothing-polling',
    'unknown',
  ]);

  // THE WORD AND THE GLYPH ARE FIVE OF EACH. These are the two axes that survive greyscale AND a
  // border style collision, so they are the floor for "distinct in form".
  expect(new Set(forms.map((f) => f.word)).size).toBe(5);
  expect(new Set(forms.map((f) => f.glyph)).size).toBe(5);
  expect(forms.map((f) => f.word)).toEqual([
    'serving',
    'stale',
    'undated',
    'nothing polling',
    'unknown',
  ]);

  // THE FOUR ADR STATES ARE FOUR BORDERS, which is the claim `infra.spec.ts` makes and this confirms
  // independently on a different fixture.
  expect(new Set(forms.slice(0, 4).map((f) => f.border)).size).toBe(4);
  expect(new Set(forms.slice(0, 4).map((f) => f.colour)).size).toBe(4);

  // AND THE FIFTH, WHOSE BORDER IS NOT ITS OWN. Recorded as a measurement rather than asserted as a
  // pass: `unknown` reuses `dashed`, so against `nothing-polling` it is separated by colour, glyph and
  // word but NOT by border style. Both of the states it must never be confused with per
  // `machines.ts:43-48` are therefore one axis short of the four. If a future edit fixes it, this
  // assertion is the one to flip.
  const unknown = forms[4]!;
  const nothing = forms[3]!;
  expect(unknown.border).toBe(nothing.border);
  expect(unknown.colour).not.toBe(nothing.colour);
  expect(unknown.glyph).not.toBe(nothing.glyph);

  // The hint is the sentence that makes the distinction actionable, and it is on the element.
  expect(unknown.title).toContain('not the same as nothing polling');

  // The row says WHICH ask failed, in its own words, rather than leaving a bare `?`.
  await expect(rows[4]!).toContainText('this queue was not reported');

  expect(errors).toEqual([]);
});

test('a describe error is unknown too, and it quotes the error rather than inventing nothing-polling', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // THE OTHER ROAD TO `unknown`: the report exists and carries an error. `pollers.ts` records what
  // conflating this with "nobody is polling" cost — a red Fleet for a cluster that is fine.
  await stub(page, { describeFails: true });
  await page.goto('/settings');

  const declared = page.getByTestId(`declared-${CONTROL}`);
  await expect(declared).toBeVisible();
  const row = declared.getByTestId('poll-::kontra-datasets');
  await expect(row).toHaveAttribute('data-state', 'unknown');
  // VERBATIM. A status code would send the reader to the control plane; this sends them to Temporal.
  await expect(row).toContainText('connection refused describing task queue');
  // And it is NOT drawn as the red state.
  await expect(row).not.toHaveAttribute('data-state', 'nothing-polling');

  expect(errors).toEqual([]);
});

test('the unattributed bucket keeps the poller it cannot parse, and says why in prose that wraps', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');
  await page.setViewportSize({ width: 390, height: 900 });

  const group = page.getByTestId('group-unattributed');
  await expect(group).toContainText('2 pollers');

  // The one `identityHost` reads a host out of, and the one it cannot.
  await expect(page.getByTestId(`unattributed-9182@dev-laptop@${Q_SEEN}`)).toContainText(
    'host dev-laptop'
  );
  const odd = page.getByTestId('unattributed-ci-runner-7');
  await expect(odd).toContainText('identity is not <pid>@<host>@<queue>');
  await expect(odd).toContainText('names no host at all');

  // IT WRAPS RATHER THAN CLIPPING, at the width the sentence is longest relative to the card. An
  // ellipsised "identity is not …" is the half that carries no information — `Infra.svelte:622-624`
  // makes this the one prose line in the card that is allowed to be multi-line, and only layout can
  // say whether it worked.
  const lines = await odd.locator('.m-meta.wrap').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      whiteSpace: cs.whiteSpace,
      overflow: cs.overflow,
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(cs.lineHeight),
    };
  });
  expect(lines.whiteSpace).toBe('normal');
  expect(lines.overflow).not.toBe('hidden');
  // Genuinely more than one line at 390px, which is the whole point of letting it wrap.
  expect(lines.height).toBeGreaterThan(lines.lineHeight * 1.5);

  // The unparsed row still carries a poll state, so it is not a text-only footnote.
  await expect(odd.locator('[data-state]')).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('nothing on this page reads below the 12px floor except a genuinely uppercased label', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);
  await page.goto('/settings');
  await expect(page.getByTestId('infra-facts')).toBeVisible();

  // MEASURED AFTER THE CASCADE, which is the half `scripts/type-scale.mjs` structurally cannot see: it
  // reads declarations out of stylesheets, so an 11px token INHERITED into a sentence is invisible to
  // it. `tokens.css:10` states the rule this checks — "nothing a person READS goes below 12px;
  // `--t-micro` at 11px exists for uppercase labels only".
  const offenders = await page.getByTestId('infra').evaluate((root) => {
    const bad: Array<{ tag: string; cls: string; size: number; transform: string; text: string }> = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (text === '') continue;
      const el = n.parentElement;
      if (el === null || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (size >= 12) continue;
      // `--t-micro` is legal on an uppercased label. `aria-hidden` glyphs are not read as prose.
      if (cs.textTransform === 'uppercase') continue;
      if (el.closest('[aria-hidden="true"]') !== null) continue;
      bad.push({
        tag: el.tagName,
        cls: el.className.toString(),
        size,
        transform: cs.textTransform,
        text: text.slice(0, 60),
      });
    }
    return bad;
  });

  // Reported with the offending text so a failure names the line, not a count.
  expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);

  expect(errors).toEqual([]);
});

test('with the control plane not answering at all, the section renders and says so instead of throwing', async ({
  page,
}) => {
  const errors = watchErrors(page);

  // NO STUB. `run.mjs:78` points `VITE_API_TARGET` at a port this run allocated and nothing is
  // listening on, so every `/api/*` read fails at the transport — which is exactly what an operator
  // sees when the control plane is down, and the one state `infra.spec.ts` never drives because all
  // fifteen of its tests install a route first.
  await page.goto('/settings');

  const infra = page.getByTestId('infra');
  await expect(infra).toBeVisible();
  await expect(infra.getByRole('heading', { name: 'Infra', level: 2 })).toBeVisible();

  // IT IS NOT STUCK ON ITS LOADING LINE. `loadInfra` resolves — every part degrades to its empty
  // value — so the facts list renders with zeroes rather than the page hanging.
  await expect(page.getByTestId('infra-facts')).toBeVisible();
  await expect(page.getByTestId('infra-facts')).toContainText('machines');

  // AND IT NAMES WHAT IT COULD NOT ASK, ONE ROW PER READ. A silently empty page here is the failure
  // `load.ts:11-18` records: "every actor on the page rendered UNKNOWN while its worker was polling
  // happily."
  //
  // THE SENTENCE IS `HTTP 500`, NOT "did not answer", AND THAT IS THE DEV SERVER AND NOT A DEFECT.
  // `load.ts:why(0)` words a request that never got a response; vite's proxy DOES answer for a dead
  // upstream — it synthesises a 500 — so `why` correctly falls through to its last line. Against a real
  // unreachable control plane (no proxy in front) the same read yields status 0 and the other sentence.
  // Both are named reads rather than a blank page, which is the claim under test; asserting one
  // wording would be asserting which HTTP stack is in front of the console.
  const missing = page.getByTestId('infra-missing');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('/api/infra/stacks');
  await expect(missing).toContainText('/api/pollers');
  await expect(missing).toContainText(/did not answer|HTTP 5\d\d/);

  // The two empty halves say which emptiness they are, rather than drawing nothing.
  await expect(page.getByTestId('group-control')).toContainText('no control stack in either state root');
  await expect(page.getByTestId('group-fleets')).toContainText('no Fleet has been converged');
  await expect(page.getByTestId('group-unattributed')).toContainText('every poller attributes to a Machine');

  // NO UNCAUGHT EXCEPTION. This is the claim `CLAUDE.md` says cannot be made without a browser: a view
  // that throws on mount passes `pnpm typecheck` and every vitest suite.
  expect(errors).toEqual([]);
});

test('no horizontal scroll at 320, 360 and 390px with five states, two placements and a full strip', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await stub(page);

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(pollRow(page, 'kf-dns-01', Q_SEEN)).toBeVisible();
    await expect(pollRow(page, 'kf-dns-01', Q_UNSEEN)).toBeVisible();

    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      text: document.body.textContent?.trim().length ?? 0,
    }));
    expect(m.doc, `document overflows at ${width}px`).toBeLessThanOrEqual(0);
    expect(m.body, `body overflows at ${width}px`).toBeLessThanOrEqual(0);
    // An empty page has no overflow either — `overflow.mjs:121` refuses to let emptiness pass as clean.
    expect(m.text, `nothing rendered at ${width}px`).toBeGreaterThan(400);

    // ONE COLUMN OF CARDS, which is the layout the page claims below 680px. Two cards side by side at
    // 320px is how a mono digest starts pushing the document sideways.
    const lefts = await page
      .getByTestId(`stack-${FLEET}`)
      .locator('.machines > .m')
      .evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts.length, `cards are not in one column at ${width}px`).toBe(1);
  }

  expect(errors).toEqual([]);
});
