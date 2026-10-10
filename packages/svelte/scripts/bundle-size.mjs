/**
 * THE BUNDLE BUDGET (ADR 0062). `dist/assets` must gzip to under 600 KB.
 *
 * ── WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL ──────────────────────────────────────────────
 *
 * This console already removed `ag-grid` for exactly this cost — measured 93 KB to 1.18 MB, recorded
 * in `App.svelte` and `DataTable.svelte` — and NOTHING IN CI WOULD HAVE CAUGHT IT. The five existing
 * guards are content checks: no framework in core, no polling, no raw HTML, type scale, overflow.
 * None of them weighs anything.
 *
 * It was added when live report mode declined `@finos/perspective` + `apache-arrow`. Declining a
 * dependency in a review comment lasts until the next review; declining it with a number in CI lasts
 * until someone argues the number up, which is a conversation rather than an accident.
 *
 * ── GZIP, BECAUSE THAT IS WHAT TRAVELS ─────────────────────────────────────────────────────────
 *
 * Raw bytes on disk are not what a browser downloads, and a dependency's raw size overstates a
 * minified-and-compressed one by enough to make a raw ceiling either useless or absurd.
 *
 * ── IT PRINTS THE TOP FILES EVEN WHEN IT PASSES ────────────────────────────────────────────────
 *
 * A budget that only speaks when it fails teaches nobody where the weight is. This one reports the
 * headroom and the five heaviest chunks on every run, so the number that eventually fails is one
 * somebody watched grow.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 600 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', '..', '..', 'dist', 'assets');

function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (/\.(js|css)$/.test(name)) out.push(full);
  }
  return out;
}

let files;
try {
  files = filesIn(assets);
} catch {
  // NOT A PASS. An absent build means this guard measured nothing, and a guard that is silently
  // vacuous is worse than one that is absent — `pnpm run build` precedes it in the test chain.
  console.error(`bundle-size: no build at ${assets}. Run \`pnpm run build\` first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`bundle-size: ${assets} holds no .js or .css. Nothing was measured.`);
  process.exit(1);
}

const sized = files
  .map((f) => ({ file: f.slice(assets.length + 1), bytes: gzipSync(readFileSync(f)).length }))
  .sort((a, b) => b.bytes - a.bytes);
const total = sized.reduce((n, f) => n + f.bytes, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(`bundle-size: ${kb(total)} gzip across ${sized.length} files (limit ${kb(LIMIT)})`);
for (const f of sized.slice(0, 5)) console.log(`  ${kb(f.bytes).padStart(10)}  ${f.file}`);

if (total > LIMIT) {
  console.error(
    `\nbundle-size: OVER BUDGET by ${kb(total - LIMIT)}.\n` +
      'A new dependency is the usual cause. This console removed ag-grid for this reason (93 KB ->\n' +
      '1.18 MB) and live report mode declined @finos/perspective and apache-arrow for it. If the\n' +
      'weight is justified, raise LIMIT in this file in the same commit that adds it, so the trade is\n' +
      'visible in one diff.'
  );
  process.exit(1);
}
console.log(`bundle-size: ${kb(LIMIT - total)} of headroom.`);
