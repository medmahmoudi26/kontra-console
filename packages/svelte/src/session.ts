/**
 * Is this browser already signed in?
 *
 * ONE LOGIN ACROSS TWO BUNDLES is a requirement (ADR 0048 §"consequences"), and it is the kind that
 * looks fine until somebody navigates. The session is a cookie the orchestrator set when the React
 * console signed in (ADR 0045); nothing about it is bundle-specific, so this asks the server rather
 * than reading any local state — a bundle that trusted its own storage would report "signed in"
 * against a session the server had already forgotten.
 */
export type Who =
  | { state: 'checking' }
  | { state: 'signed-in'; user: string }
  | { state: 'signed-out' }
  | { state: 'error'; error: string };

export async function whoami(fetchImpl: typeof fetch = fetch): Promise<Who> {
  try {
    const res = await fetchImpl('/api/health', { credentials: 'same-origin' });
    if (res.status === 401) return { state: 'signed-out' };
    if (!res.ok) return { state: 'error', error: `HTTP ${res.status}` };
    // `/api/health` is open, so a 200 proves reachability and not identity. The session surface
    // answers the second question; until slice 06 needs it, reachability is what this slice claims.
    return { state: 'signed-in', user: 'session cookie present' };
  } catch (err) {
    return { state: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
