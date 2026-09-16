/**
 * Read a console source file by its repo-relative path, wherever that file currently lives.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * A dozen tests here assert things ABOUT SOURCE rather than about behaviour — that a component
 * reaches its terminal options through one helper, that a module does not import a second HTTP
 * client, that every widget has a parser. Those are good tests and the only way to write them is to
 * read the file.
 *
 * It also makes them the tests a MOVE breaks. Extracting `@kontra/console-core` (ADR 0048 §2) moved
 * 77 modules one directory up and out, and fourteen suites failed with `ENOENT` on a path that had
 * been correct for a year. Not one of them was about the thing that changed.
 *
 * ── IT SEARCHES, AND IT THROWS ──────────────────────────────────────────────────────────────────
 *
 * Both roots are tried — the app's `src/` and the core package's — so a module can move between
 * them without touching a test. That is the whole point: the next move is coming, because the
 * migration has eight more surfaces in it.
 *
 * A MISS IS AN ERROR, NEVER AN EMPTY STRING. A reader that answered `''` would turn every
 * `expect(src).toContain(...)` into a silent pass, and a `not.toContain` into a permanent one — a
 * suite that goes green precisely when it has stopped looking at anything. The throw names both
 * roots it tried, because "file not found" without the search path is the least useful error there
 * is.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Where a console module may live. Ordered: the app first, since most still do. */
const ROOTS = [
  resolve(here, '..'), //                    kontra-console/src
  resolve(here, '../../packages/core/src'), // @kontra/console-core
] as const;

/**
 * The source of `rel` — a path relative to a source root, e.g. `run/api.ts` or `panels/Foo.tsx`.
 *
 * @throws if no root holds it. See the header: an empty string here would make assertions vacuous.
 */
export function sourceOf(rel: string): string {
  for (const root of ROOTS) {
    const p = join(root, rel);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(
    `consoleSource: no such module ${rel}.\n` +
      ROOTS.map((r) => `  looked in ${r}`).join('\n') +
      '\nIf it moved to a new package, add that package here rather than editing every test.'
  );
}

/** Where `rel` actually is, for a test that needs the path rather than the bytes. */
export function pathOf(rel: string): string {
  for (const root of ROOTS) {
    const p = join(root, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`consoleSource: no such module ${rel}`);
}

/**
 * Every source file under `rel`, as `{name, text}` — for the tests that assert a DIRECTORY's
 * contents, such as "every widget has a parser beside it".
 *
 * AN EMPTY RESULT THROWS, for the same reason a miss does. A directory listing that found nothing
 * satisfies `every()` and `not.toContain()` without reading a byte.
 */
export function sourcesUnder(rel: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const root of ROOTS) {
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    for (const name of readdirSyncSafe(dir)) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      out.push({ name, text: readFileSync(join(dir, name), 'utf8') });
    }
  }
  if (out.length === 0) {
    throw new Error(
      `consoleSource: nothing under ${rel} in either root — an empty listing passes every ` +
        'assertion, so this is a failure rather than a clean result.'
    );
  }
  return out;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return []; // an unreadable root is not a result; `sourcesUnder` throws on an empty total
  }
}
