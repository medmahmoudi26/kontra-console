/**
 * Nothing in this bundle polls for data (ADR 0048 §3).
 *
 * ── WHY IT NEEDS A CHECK ────────────────────────────────────────────────────────────────────────
 *
 * A poll is the easiest thing to write and it passes every test a subscription passes. The React
 * console has twelve files using `setInterval` and surfaces that refresh every 10–15 seconds; not
 * one of them was a decision, each was the obvious way to make a number update. The obvious way is
 * what this forbids.
 *
 * A polled surface is stale for the length of its interval and then JUMPS, and that jump is what
 * reads as slow — which is most of what this migration is for. Losing it to `setInterval(fetch, …)`
 * added in a hurry is the likeliest way to arrive back where we started.
 *
 * ── WHAT IS ALLOWED ─────────────────────────────────────────────────────────────────────────────
 *
 * `setTimeout` is fine: a debounce, a retry backoff and an animation frame are not polls. `.test.`
 * files are exempt because a test may legitimately drive a clock. The rule is narrow on purpose —
 * a broad one gets suppressed, and a suppressed rule is worse than none.
 *
 * An empty walk is a failure, as everywhere else here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|svelte)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(SRC);
} catch (err) {
  console.error(`no-polling: cannot read ${SRC} — ${err.message}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`no-polling: scanned ZERO files under ${SRC} — a walk that matches nothing passes.`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      // The word inside a comment is how the rule gets explained; only a CALL is a poll.
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (/\bsetInterval\s*\(/.test(code)) hits.push({ rel: relative(ROOT, file), line: i + 1 });
    });
}

if (hits.length) {
  console.error('no-polling: setInterval is used for data.\n');
  for (const h of hits) console.error(`  ${h.rel}:${h.line}`);
  console.error(
    '\nEvery surface here derives from a subscription (ADR 0048 §3). A polled surface is stale for\n' +
      'its interval and then jumps, which is the thing this console exists to stop doing. If the\n' +
      'server has no stream for what you need, that is a server change — not an interval.\n'
  );
  process.exit(1);
}

console.log(`no-polling: ${files.length} files scanned, nothing polls.`);
