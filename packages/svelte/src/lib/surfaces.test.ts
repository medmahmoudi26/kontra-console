import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SURFACES, go } from './surfaces';

/**
 * The nav and the orchestrator must agree about who serves what.
 *
 * A surface this file calls `svelte` while the server still serves it from React is a link that
 * navigates to itself and renders the other console — no error, no 404, just a page that does not
 * change. It is the exact failure the split makes possible and the one nothing else would catch.
 */
const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(
  join(here, '../../../../../kontra/control/orchestrator/src/server.ts'),
  'utf8'
);

function setOf(name: string): Set<string> {
  const start = server.indexOf(`export const ${name}`);
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
  const svelte = setOf('SVELTE_SURFACES');
  const react = setOf('SPA_SURFACES');

  it('read both sets', () => {
    // The guard on the guard: two empty sets make every assertion below vacuous.
    expect(react.size).toBeGreaterThan(0);
    expect(SURFACES.length).toBe(7);
  });

  it('every surface the nav claims for svelte is served by the svelte bundle', () => {
    for (const s of SURFACES.filter((x) => x.bundle === 'svelte')) {
      expect(svelte.has(s.id), `${s.id} is nav-svelte but not in SVELTE_SURFACES`).toBe(true);
      expect(react.has(s.id), `${s.id} is in BOTH sets`).toBe(false);
    }
  });

  it('every surface the nav claims for react is served by the react bundle', () => {
    for (const s of SURFACES.filter((x) => x.bundle === 'react')) {
      expect(react.has(s.id), `${s.id} is nav-react but not in SPA_SURFACES`).toBe(true);
      expect(svelte.has(s.id), `${s.id} is in BOTH sets`).toBe(false);
    }
  });

  it('a move within one bundle is not a document load, and across is', () => {
    expect(go('catalog', 'catalog').kind).toBe('same-bundle');
    expect(go('datasets', 'catalog').kind).toBe('document-load');
    expect(go('datasets', 'catalog').href).toBe('/datasets');
  });
});
