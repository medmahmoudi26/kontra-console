/**
 * `@kontra/console-core` may not import a UI framework. This fails the build when it does.
 *
 * ── WHY A SCRIPT AND NOT A CONVENTION ───────────────────────────────────────────────────────────
 *
 * The whole migration (ADR 0048) rests on this package staying framework-free: it is what lets two
 * consoles share one brain, and what makes a permanent React+Svelte split survivable if the
 * Datasets checkpoint goes that way. A single `import { useState } from 'react'` ends that quietly —
 * the code still compiles, the tests still pass, and the package is now React's.
 *
 * ── IT REPORTS AN EMPTY WALK AS A FAILURE ───────────────────────────────────────────────────────
 *
 * A guard that finds no files passes. That is how this check would stop working: a directory
 * rename, a glob that no longer matches, and from then on it is a green tick over nothing. So zero
 * scanned files is an error, and the count is printed on success — a number a reader can sanity
 * check against the package they can see.
 *
 * ── IT READS TEXT, NOT AN AST ───────────────────────────────────────────────────────────────────
 *
 * Deliberately blunt. An AST pass would be exact about `import` and would still miss
 * `await import('react')` built from a template string, and the cost of a false positive here is
 * ten seconds of a human reading one line. The patterns below cover static imports, dynamic
 * imports, `require`, and the JSX pragma — the ways a framework actually arrives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** What may not appear. `svelte` is here too: core is framework-free, not React-free. */
const BANNED = [
  { name: 'react', re: /from\s+['"]react(\/[^'"]*)?['"]|require\(\s*['"]react(\/[^'"]*)?['"]|import\(\s*['"]react(\/[^'"]*)?['"]/ },
  { name: 'react-dom', re: /['"]react-dom(\/[^'"]*)?['"]/ },
  { name: 'svelte', re: /from\s+['"]svelte(\/[^'"]*)?['"]|require\(\s*['"]svelte(\/[^'"]*)?['"]|import\(\s*['"]svelte(\/[^'"]*)?['"]/ },
  { name: 'a JSX pragma', re: /@jsx(Runtime|ImportSource)?\s/ },
  { name: 'a .tsx module', re: /from\s+['"][^'"]+\.tsx['"]/ },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mts|cts|js|mjs)$/.test(entry)) out.push(p);
  }
  return out;
}

let files = [];
try {
  files = walk(SRC);
} catch (err) {
  console.error(`no-framework: cannot read ${SRC} — ${err.message}`);
  process.exit(1);
}

// THE GUARD ON THE GUARD. Zero files is not "clean", it is "this check is not looking at anything".
if (files.length === 0) {
  console.error(
    `no-framework: scanned ZERO files under ${SRC}.\n` +
      '  That is a broken check, not a clean package — a walk that matches nothing passes every\n' +
      '  assertion. Fix the path before trusting this result.'
  );
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of BANNED) {
    const line = text.split('\n').findIndex((l) => re.test(l));
    if (line >= 0) hits.push({ file: relative(ROOT, file), line: line + 1, name });
  }
}

if (hits.length > 0) {
  console.error('no-framework: @kontra/console-core imports a UI framework.\n');
  for (const h of hits) console.error(`  ${h.file}:${h.line} — ${h.name}`);
  console.error(
    '\nThis package is shared by the React console and the Svelte one (ADR 0048 §2). A framework\n' +
      'import here makes it one framework\'s, silently: everything still compiles and the tests\n' +
      'still pass. Move the code that needs a framework into the app that has one.'
  );
  process.exit(1);
}

console.log(`no-framework: ${files.length} files scanned, no framework imports.`);
