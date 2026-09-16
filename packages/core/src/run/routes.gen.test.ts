/**
 * The console must only call paths the orchestrator serves.
 *
 * THE FAILURE THIS PREVENTS. A route renamed on the server, with a call site still naming the old
 * path, does not fail loudly: the panel renders empty, or a button does nothing, and the cause is
 * in another repository. Before this, the console named paths as string literals at 45 call sites
 * and nothing connected them to the server at all.
 *
 * So this walks the source for `/api/...` literals and checks each against the generated table. It
 * is a grep with a specification behind it — not as strong as a fully typed client (which needs
 * per-route JSON schemas the server does not have yet), but it catches the failure that actually
 * happens.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { API_PATHS, ROUTES, apiPath } from './routes.gen';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sourceFiles(p, out);
    } else if (
      ['.ts', '.tsx'].includes(extname(p)) &&
      !p.endsWith('.gen.ts') &&
      // TEST FILES NAME FIXTURE PATHS ON PURPOSE — `/api/anything` in an interceptor test is the
      // point of that test, not a call the console makes.
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test.tsx')
    ) {
      out.push(p);
    }
  }
  return out;
}

/** A bare `/api/...` literal. */
const LITERAL = /['"`](\/api\/[A-Za-z0-9_\-./${}:]*)['"`]/g;

/**
 * `` `${BASE}/runs/...` `` — how `run/api.ts` actually writes every one of its calls.
 *
 * THE FIRST VERSION MISSED ALL OF THEM. It looked for literals starting `/api/` and found seven,
 * because `api.ts` sets `const BASE = '/api'` and then templates off it — so the guard was checking
 * a handful of stragglers while the forty-five calls it was written for went unexamined. A
 * coverage assertion is what surfaced that: seven, against a threshold of ten.
 *
 * Scoped to the identifier literally named BASE. `panelsClient.ts` builds an absolute base for the
 * STREAMER on another port, which is deliberately not this server (ADR 0020) and must not be
 * checked against its spec.
 */
const BASED = /`\$\{BASE\}(\/[A-Za-z0-9_\-./${}:]*)`/g;

/**
 * Code only — comments are stripped first.
 *
 * THE FIRST VERSION READ DOCUMENTATION AS CALL SITES. `rowTail.ts` says "its own SSE endpoint, not
 * `/api/events`" and `turns.ts` says "WHICH IS WHY THERE IS NO `/api/runs/:id/turns`" — both prose
 * about routes that deliberately do NOT exist, both reported as the console calling something the
 * server does not serve. A guard that flags the comment explaining why something is absent is a
 * guard people learn to ignore.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** A literal with `${…}` holes becomes the template shape the spec uses. */
function normalise(literal: string): string {
  return literal
    .replace(/\$\{[^}]*\}/g, '{p}')
    .replace(/:[A-Za-z0-9_]+/g, '{p}')
    .replace(/\/$/, '');
}

/** Every API path a file names, by either spelling, comments removed. */
function pathsIn(source: string): string[] {
  const code = codeOnly(source);
  const out: string[] = [];
  // A capture group is `string | undefined` to TypeScript even when the pattern guarantees it, so
  // the guard is real rather than a cast — a `!` here would be a lie the compiler cannot check.
  for (const [, p] of code.matchAll(LITERAL)) if (p) out.push(p);
  for (const [, p] of code.matchAll(BASED)) if (p) out.push('/api' + p);
  return out;
}

/**
 * Files that address a DIFFERENT server, named explicitly rather than inferred.
 *
 * `panelsClient.ts` holds `const API = '/api/panels'` and appends to it, but the base it prepends is
 * an absolute URL for the STREAMER on another port — deliberately a different origin (ADR 0020),
 * which this spec does not describe and must not be checked against.
 *
 * NAMED, NOT INFERRED, and that distinction was earned. The first version skipped any literal that
 * was a PREFIX of some longer path, reasoning that a prefix must be a base. `/api/runs` is both a
 * real route AND a prefix of `/api/runs/{runId}` — so the heuristic made it invisible, and a
 * mutation renaming `/api/runs` on the server passed green. A guard with a clever exemption is a
 * guard with a hole.
 */
const OTHER_ORIGIN = ['panels/panelsClient.ts'];

function specShapes(): Set<string> {
  return new Set(API_PATHS.map((p) => p.replace(/\{[A-Za-z0-9_]+\}/g, '{p}')));
}

describe('the generated route table', () => {
  it('is not empty', () => {
    // The guard on the guard: an empty table satisfies every containment check below.
    expect(Object.keys(ROUTES).length).toBeGreaterThan(30);
    expect(API_PATHS.length).toBeGreaterThan(30);
  });

  it('fills path parameters, and encodes them', () => {
    const withParam = (Object.keys(ROUTES) as Array<keyof typeof ROUTES>).find((id) =>
      ROUTES[id].path.includes('{')
    );
    expect(withParam, 'no parameterised route in the table').toBeDefined();
    const key = Object.keys(ROUTES).find((k) => ROUTES[k as keyof typeof ROUTES].path.includes('{runId}'));
    if (key) {
      // A SLASH IN AN ID IS THE POINT. `a/b` is a legal actor name in this system, and an unencoded
      // one addresses a different route entirely.
      const filled = apiPath(key as keyof typeof ROUTES, { runId: 'a/b', tag: 'x' });
      expect(filled).toContain('a%2Fb');
      expect(filled).not.toContain('a/b');
    }
  });

  it('refuses to build a path with a missing parameter', () => {
    const key = Object.keys(ROUTES).find((k) => ROUTES[k as keyof typeof ROUTES].path.includes('{'));
    if (!key) throw new Error('no parameterised route in the table; this test proves nothing');
    // Silently leaving `{runId}` in the URL would request a route that 404s, which reads as "the
    // server lost my run" rather than "this call site forgot an argument".
    expect(() => apiPath(key as keyof typeof ROUTES, {})).toThrow(/missing path parameter/);
  });
});

describe('every path the console names is served', () => {
  it('examines the calls this guard was written for', () => {
    const found = sourceFiles(SRC).flatMap((f) => pathsIn(readFileSync(f, 'utf8')));
    // `run/api.ts` alone makes ~45 calls. A threshold near that is what caught the first version
    // checking seven stragglers and missing every real one.
    // MEASURED AT 23, not guessed. The first version found SEVEN because it only matched bare
    // `/api/…` literals while `api.ts` templates off `const BASE = '/api'` — this assertion is what
    // exposed that, and the number is kept near the real one so the same mistake fails again.
    expect(found.length, 'too few API paths found; this guard is looking at the wrong shape').toBeGreaterThan(20);
  });

  it('names nothing the orchestrator does not serve', () => {
    const shapes = specShapes();
    const unknown: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if (OTHER_ORIGIN.some((o) => rel.endsWith(o))) continue;
      for (const literal of pathsIn(readFileSync(file, 'utf8'))) {
        const shape = normalise(literal);
        if (shape === '/api' || shape === '/api/') continue; // the base constant itself
        if (!shapes.has(shape)) unknown.push(`${rel}: ${literal}`);
      }
    }
    expect(
      unknown,
      'these paths are not in the orchestrator spec — a route moved, or the table is stale ' +
        '(run `node scripts/generate-routes.mjs`)'
    ).toEqual([]);
  });
});
