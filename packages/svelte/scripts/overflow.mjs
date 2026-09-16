/**
 * No route scrolls sideways. Asserted with a real browser at three widths, in CI.
 *
 * ── WHY A BROWSER AND NOT A REVIEW ──────────────────────────────────────────────────────────────
 *
 * Panel-first (ADR 0048 §4) is checkable and "it looks responsive" is not. The prototype this
 * console's design came from passed a desktop review and had 59px of horizontal overflow at 390px
 * and 129px at 320px. The four bugs behind that — an event log whose rows overlapped their own
 * text, a card table that widened the page because grid items default to `min-width: auto`, a nav
 * pushed sideways by a brand subtitle, 132px of a 390px screen spent on labels — were all invisible
 * to every other check in the repo.
 *
 * 320px is in the list because it is where a layout that merely *survives* 390px falls over.
 *
 * ── EVERY ROUTE, AND A ROUTE WITHOUT COVERAGE FAILS ─────────────────────────────────────────────
 *
 * The routes are read from the app rather than typed here, so a new surface is covered the moment
 * it is declared. The alternative — a list in this file — is a check that silently stops covering
 * the thing most likely to be broken: the newest page.
 *
 * An empty route list is a failure, not a pass: zero routes × three widths is zero assertions.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, '../../dist');
const WIDTHS = [320, 390, 1280];

/** The routes the Svelte bundle owns, read from the orchestrator's allowlist — one source. */
function routes() {
  const server = readFileSync(
    join(ROOT, '../../../kontra/control/orchestrator/src/server.ts'),
    'utf8'
  );
  // Sliced between the declaration and its closing bracket, then the quoted names taken out of
  // that. A single regex over TypeScript — with comments inside the literal — is how the first
  // version of this silently matched nothing and reported "no routes", which the empty-list guard
  // then reported as a broken check. It was right: the check WAS broken.
  const grab = (name) => {
    const start = server.indexOf(`export const ${name}`);
    if (start < 0) return [];
    const open = server.indexOf('[', start);
    const close = server.indexOf(']', open);
    if (open < 0 || close < 0) return [];
    // COMMENTS STRIPPED FIRST. An apostrophe in prose — `the fallback's clause` — pairs with the
    // next one and yields a "route" made of a comment, which this check then dutifully loaded and
    // reported as passing. Found by reading the output rather than the exit code.
    const body = server
      .slice(open, close)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  return [...grab('SVELTE_SURFACES'), ...grab('SVELTE_ROUTES')];
}

const list = routes();
if (list.length === 0) {
  console.error(
    'overflow: no Svelte routes found.\n' +
      '  Zero routes times three widths is zero assertions — a green tick over nothing.\n' +
      '  Check SVELTE_SURFACES / SVELTE_ROUTES in the orchestrator, which is where this reads them.'
  );
  process.exit(1);
}

if (!existsSync(join(DIST, 'svelte.html'))) {
  console.error(`overflow: no built document at ${join(DIST, 'svelte.html')} — run the build first.`);
  process.exit(1);
}

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = join(DIST, url);
  // Any route the server would answer with the document, this fixture answers the same way.
  const path = existsSync(file) && extname(file) ? file : join(DIST, 'svelte.html');
  res.setHeader('content-type', TYPES[extname(path)] ?? 'text/html');
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// CHROMIUM_PATH lets a machine that already has a browser use it. CI runs `playwright install`
// and needs neither; this box has a chromium from another tool's pin, and downloading a second
// 170 MB copy to measure `scrollWidth` is not a good trade on a disk this full.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const failures = [];
for (const route of list) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    // THE PAGE MUST HAVE RENDERED. A blank document never overflows, so "0px" on an app that failed
    // to mount is the most confident wrong answer this check could give.
    const painted = await page.evaluate(() => (document.body.textContent ?? '').trim().length);
    if (painted < 20) failures.push({ route, width, why: `rendered nothing (${painted} chars)` });
    else if (over > 0) failures.push({ route, width, why: `${over}px of horizontal overflow` });
    else console.log(`ok   /${route.padEnd(10)} ${String(width).padStart(4)}px`);
    await page.close();
  }
}
await browser.close();
server.close();

if (failures.length) {
  console.error('\noverflow: the page scrolls sideways.\n');
  for (const f of failures) console.error(`  /${f.route} at ${f.width}px — ${f.why}`);
  console.error(
    '\nNarrow is the PRIMARY width here (ADR 0048 §4), not a breakpoint to survive. A layout that\n' +
      'only works when there is room is a bug. Usual causes: a grid or flex child without\n' +
      '`min-width: 0`, a table without its own `overflow-x: auto`, or a fixed-px column.\n'
  );
  process.exit(1);
}
console.log(`\noverflow: ${list.length} route(s) x ${WIDTHS.length} widths, no horizontal scroll.`);
