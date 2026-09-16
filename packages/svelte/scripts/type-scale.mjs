/**
 * No arbitrary type sizes. Sizes come from the scale in `tokens.css` or the build fails.
 *
 * ── WHY A CHECK AND NOT A CONVENTION ────────────────────────────────────────────────────────────
 *
 * The React console has 336 arbitrary sizes against 48 scale tokens. Nobody decided that; it
 * accumulated one `text-[11px]` at a time, each one locally reasonable. A convention is what
 * produced it. ADR 0048 §5 sets a scale, and the only thing that keeps a scale is a check.
 *
 * ── AND A 9px LABEL IS THE ONE IT IS REALLY FOR ─────────────────────────────────────────────────
 *
 * The rule that matters is the FLOOR, not the tidiness: 27 declarations in the React console are
 * 9px, which is unreadable in an IDE panel and is what this migration exists to fix. A size below
 * the floor is reported differently from a size that is merely off-scale, because they are
 * different mistakes.
 *
 * ── IT REPORTS AN EMPTY WALK AS A FAILURE ───────────────────────────────────────────────────────
 *
 * Zero files scanned is not a clean result, it is a check that has stopped looking — one directory
 * rename away, and green forever after. The count is printed on success so a reader can compare it
 * with the package they can see.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const TOKENS = join(SRC, 'lib', 'tokens.css');

/** The scale, read from the stylesheet rather than restated — two lists drift, one cannot. */
function allowedSizes() {
  const css = readFileSync(TOKENS, 'utf8');
  const sizes = [...css.matchAll(/--t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  if (sizes.length === 0) {
    throw new Error(`type-scale: no --t-* sizes found in ${TOKENS}. The scale is the authority; without it this check has nothing to check against.`);
  }
  return new Set(sizes);
}

/** Anything a person reads must be at least this. `--t-micro` is the documented exception. */
const FLOOR = 12;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(svelte|css)$/.test(entry)) out.push(p);
  }
  return out;
}

const allowed = allowedSizes();
let files;
try {
  files = walk(SRC);
} catch (err) {
  console.error(`type-scale: cannot read ${SRC} — ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `type-scale: scanned ZERO files under ${SRC}.\n` +
      '  A walk that matches nothing passes every assertion. Fix the path before trusting this.'
  );
  process.exit(1);
}

const offscale = [];
const belowFloor = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  // `tokens.css` DEFINES the scale, so its own declarations are the one exemption.
  if (file === TOKENS) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        const px = Number(m[1]);
        if (px < FLOOR) belowFloor.push({ rel, line: i + 1, px });
        else if (!allowed.has(px)) offscale.push({ rel, line: i + 1, px });
      }
    });
}

if (belowFloor.length || offscale.length) {
  if (belowFloor.length) {
    console.error(`type-scale: ${belowFloor.length} size(s) below the ${FLOOR}px floor.\n`);
    for (const h of belowFloor) console.error(`  ${h.rel}:${h.line} — ${h.px}px`);
    console.error(
      '\nNothing a person reads goes below 12px (ADR 0048 §5). This console is designed for a\n' +
        '400px IDE panel and a phone; the React one has 27 declarations at 9px and that is the\n' +
        'thing being fixed. `var(--t-micro)` is 11px and is for UPPERCASE labels only.\n'
    );
  }
  if (offscale.length) {
    console.error(`type-scale: ${offscale.length} size(s) off the scale.\n`);
    for (const h of offscale) console.error(`  ${h.rel}:${h.line} — ${h.px}px`);
    console.error(`\nUse a token: ${[...allowed].sort((a, b) => a - b).join('px, ')}px. See src/lib/tokens.css.`);
  }
  process.exit(1);
}

console.log(`type-scale: ${files.length} files scanned, every size on the scale.`);
