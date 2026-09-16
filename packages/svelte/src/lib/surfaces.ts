/**
 * The seven Surfaces, and which bundle draws each.
 *
 * ── THE NAV IS THE SAME WHICHEVER BUNDLE RENDERED IT ────────────────────────────────────────────
 *
 * A person navigating should not be able to tell which console they are on except by its speed.
 * So this lists all seven, and `bundle` decides whether a click is a client-side change or a
 * document load — which is the route split's sharp edge and the thing most likely to feel broken.
 *
 * MUST MATCH THE ORCHESTRATOR'S TWO SETS. `surfaces.test.ts` pins it: a surface this file calls
 * `svelte` while the server still serves it from React would be a link that navigates to itself and
 * renders the other console, forever, with no error anywhere.
 */
export interface Surface {
  id: string;
  label: string;
  bundle: 'svelte' | 'react';
}

export const SURFACES: readonly Surface[] = [
  { id: 'catalog', label: 'Catalog', bundle: 'svelte' },
  { id: 'workflows', label: 'Workflows', bundle: 'svelte' },
  { id: 'actors', label: 'Actors', bundle: 'svelte' },
  { id: 'datasets', label: 'Datasets', bundle: 'svelte' },
  { id: 'monitor', label: 'Monitor', bundle: 'react' },
  { id: 'secrets', label: 'Secrets', bundle: 'svelte' },
  { id: 'settings', label: 'Settings', bundle: 'svelte' },
];

/**
 * Go to a surface.
 *
 * A CROSS-BUNDLE MOVE IS A DOCUMENT LOAD AND IS SAID SO. `location.assign` rather than a history
 * push: the other bundle is a different document, and pushing state for it leaves a URL the current
 * app cannot render and a back button that half-works.
 */
export function go(id: string, from: string): { kind: 'same-bundle' | 'document-load'; href: string } {
  const target = SURFACES.find((s) => s.id === id);
  const here = SURFACES.find((s) => s.id === from);
  const href = `/${id}`;
  const kind = target && here && target.bundle === here.bundle ? 'same-bundle' : 'document-load';
  return { kind, href };
}
