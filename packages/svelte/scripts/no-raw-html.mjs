/**
 * Nothing in this bundle renders untrusted text as HTML.
 *
 * ── THE RULE CAME WITH THE PORT ─────────────────────────────────────────────────────────────────
 *
 * The React console guards its widget path with `untrusted.test.ts`, which scans every widget
 * source for `rehype-raw`, `dangerouslySetInnerHTML`, `innerHTML` and `outerHTML`. What renders
 * there is text a MACHINE wrote — a Terminal's output, a `speak()` line, a run summary — and none
 * of it is ours to trust.
 *
 * Replacing `react-markdown` would have quietly removed that boundary while the tests guarding it
 * stayed green in a package nobody was looking at. So the rule moved with the code, as a check on
 * the whole bundle rather than on one directory: the next person to reach for `innerHTML` will not
 * be editing a widget.
 *
 * ── `{@html}` IS SVELTE'S SPELLING OF THE SAME THING, AND IT IS ALLOWED IN ONE PLACE ────────────
 *
 * `markdown.ts` escapes every byte before it formats anything, and its output is the only string in
 * this bundle that may be rendered as HTML. The exemption is by PATH, so reaching for `{@html}`
 * anywhere else fails — including in another file that also promises to escape.
 *
 * An empty walk fails, as everywhere else here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** The one file whose output is safe by construction. Everything else is refused. */
const ALLOWED = new Set(['src/monitor/Markdown.svelte']);

const BANNED = [
  { name: 'innerHTML', re: /\.innerHTML\s*=/ },
  { name: 'outerHTML', re: /\.outerHTML\s*=/ },
  { name: 'insertAdjacentHTML', re: /insertAdjacentHTML\s*\(/ },
  { name: 'document.write', re: /document\.write\s*\(/ },
  { name: '{@html}', re: /\{@html\s/ },
  { name: 'rehype-raw', re: /rehype-raw|rehypeRaw/ },
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|svelte)$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(SRC);
} catch (err) {
  console.error(`no-raw-html: cannot read ${SRC} — ${err.message}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`no-raw-html: scanned ZERO files under ${SRC} — a walk that matches nothing passes.`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (ALLOWED.has(rel)) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      for (const { name, re } of BANNED) if (re.test(code)) hits.push({ rel, line: i + 1, name });
    });
}

if (hits.length) {
  console.error('no-raw-html: untrusted text can reach the DOM as markup.\n');
  for (const h of hits) console.error(`  ${h.rel}:${h.line} — ${h.name}`);
  console.error(
    '\nWhat renders in this console is written by MACHINES — terminal output, speak() lines, run\n' +
      'summaries — and none of it is ours to trust. `markdown.ts` escapes before it formats and is\n' +
      'the one path allowed to produce markup. If you need more of it, widen THAT, not this.\n'
  );
  process.exit(1);
}

console.log(`no-raw-html: ${files.length} files scanned, no raw-HTML path.`);
