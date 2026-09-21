/**
 * The seven Surfaces, in the order the nav draws them.
 *
 * ── IT MUST MATCH THE ORCHESTRATOR'S LIST ───────────────────────────────────────────────────────
 *
 * `surfaces.test.ts` pins this against `SPA_SURFACES` in the server. A surface the nav offers that
 * the server does not serve is a link that 404s on a cold load — and only on a cold load, because
 * in-app navigation never leaves the document, which is what made the same bug invisible for a
 * release once already.
 *
 * ── THE `bundle` FIELD IS GONE, AND SO IS WHAT IT DESCRIBED ─────────────────────────────────────
 *
 * While the console migrated (ADR 0048) each entry said which of two bundles drew it, and a click
 * across that line was a document load. There is one bundle now; what survives is the rule for a
 * segment the nav does NOT know — a retired `/runs/<id>`, or anything else the server serves — which
 * is still a document load, because this app cannot render it.
 */
export interface Surface {
  id: string;
  label: string;
}

export const SURFACES: readonly Surface[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'actors', label: 'Actors' },
  { id: 'datasets', label: 'Datasets' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'logs', label: 'Logs' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Go to a surface.
 *
 * A MOVE THIS APP CANNOT RENDER IS A DOCUMENT LOAD, said so rather than attempted: pushing history
 * for an address the running app has no view for leaves a URL it cannot draw and a back button that
 * half-works. Everything the nav offers is the same document.
 */
export function go(
  id: string,
  from: string,
  among: readonly Surface[] = SURFACES
): { kind: 'same-bundle' | 'document-load'; href: string } {
  const known = (segment: string): boolean => among.some((s) => s.id === segment);
  return { kind: known(id) && known(from) ? 'same-bundle' : 'document-load', href: `/${id}` };
}
