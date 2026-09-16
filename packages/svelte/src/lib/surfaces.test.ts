import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SURFACES, go } from './surfaces';

/**
 * The nav and the orchestrator must agree about what exists.
 *
 * A surface in the nav that the server does not serve 404s on a cold load — and ONLY on a cold
 * load, because in-app navigation never leaves the document. That is what let the same bug ride a
 * release once: every click worked, and every pasted link was broken.
 */
const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(
  join(here, '../../../../../kontra/control/orchestrator/src/server.ts'),
  'utf8'
);

function setOf(name: string): Set<string> {
  const start = server.indexOf(`export const ${name}`);
  // NOT FOUND IS AN ERROR, NOT AN EMPTY SET. `indexOf` answers -1 and a slice from there reads the
  // whole file, which parsed as a set of every quoted string in it — and the assertions below then
  // passed against nonsense. A renamed export must fail here, loudly.
  if (start === -1) throw new Error(`${name} is not exported by the orchestrator's server.ts`);
  const open = server.indexOf('[', start);
  const close = server.indexOf(']', open);
  const body = server
    .slice(open, close)
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')) // an apostrophe in prose pairs with the next quote
    .join('\n');
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!));
}

describe('the nav agrees with the orchestrator', () => {
  const served = setOf('SPA_SURFACES');
  const routes = setOf('SVELTE_ROUTES');

  it('read the server', () => {
    // The guard on the guard: an empty set makes every assertion below vacuous.
    expect(served.size).toBeGreaterThan(0);
    expect(routes.size).toBeGreaterThan(0);
    expect(SURFACES.length).toBe(7);
  });

  it('every surface the nav offers is served', () => {
    for (const s of SURFACES) {
      expect(served.has(s.id), `${s.id} is in the nav and not in SPA_SURFACES`).toBe(true);
    }
  });

  it('everything the server serves is either a surface or a retired address', () => {
    const nav = new Set(SURFACES.map((s) => s.id));
    // `runs` and `scratch` are retired: served so the shell can load and REDIRECT them, and
    // deliberately absent from the nav. Anything else the server serves and the nav omits is a
    // surface nobody can reach.
    const retired = new Set(['runs', 'scratch']);
    for (const id of served) {
      expect(nav.has(id) || retired.has(id), `${id} is served and unreachable`).toBe(true);
    }
  });

  it('a move between surfaces is client-side; a move off them is a document load', () => {
    expect(go('catalog', 'catalog').kind).toBe('same-bundle');
    expect(go('datasets', 'catalog').kind).toBe('same-bundle');
    expect(go('datasets', 'catalog').href).toBe('/datasets');

    // A retired address still resolves — the server serves it and the shell redirects — and it is
    // not a view this app can mount, so going there leaves the document.
    expect(go('runs', 'catalog').kind).toBe('document-load');
    expect(go('runs', 'catalog').href).toBe('/runs');
  });
});
