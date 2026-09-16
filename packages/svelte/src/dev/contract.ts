/**
 * Fetch one Method's published contract.
 *
 * ── THE ACTOR IS LOOKED UP BY NAME, BECAUSE THE PANE IS OPENED WITH ONE ─────────────────────────
 *
 * The VS Code extension knows which file you are editing, so it can name the actor and the method —
 * it does not know the opaque source id the API keys on. Resolving the name here is what lets the
 * pane be opened from an editor rather than from a list.
 *
 * ── AN ERROR IS A STATE, NOT A THROW ────────────────────────────────────────────────────────────
 *
 * A pane that renders nothing because a fetch rejected is indistinguishable from a pane that is
 * still loading, and both look like the extension is broken. Every failure comes back as a value the
 * UI can say out loud.
 */
import type { JsonSchema } from '@kontra/console-core/types';

export type Contract =
  | { state: 'loading' }
  | { state: 'ready'; version: string; schema: JsonSchema | undefined }
  | { state: 'error'; error: string };

interface Operation {
  name: string;
  input?: JsonSchema;
}
interface ActorRecord {
  name: string;
  version: string;
  operations?: Operation[];
}

export async function contractFor(
  actor: string,
  method: string,
  fetchImpl: typeof fetch = fetch
): Promise<Contract> {
  if (!actor || !method) {
    return { state: 'error', error: 'open this pane from an actor file — no actor or method in the URL' };
  }
  try {
    const res = await fetchImpl('/api/actors', { credentials: 'same-origin' });
    if (!res.ok) return { state: 'error', error: `could not list actors: HTTP ${res.status}` };
    const actors = (await res.json()) as ActorRecord[];
    const found = actors.find((a) => a.name === actor);
    if (!found) {
      // NAMED, and it says what to do. "not found" against a control plane that has the actor
      // registered but not SERVED is the single most likely reason to be here and confused.
      return {
        state: 'error',
        error: `no actor named ${actor} is serving. \`kontra serve --actor <dir> --watch\` publishes its contract.`,
      };
    }
    const op = found.operations?.find((o) => o.name === method);
    if (!op) {
      const known = (found.operations ?? []).map((o) => o.name).join(', ') || 'none';
      return { state: 'error', error: `${actor} declares no method ${method}. It has: ${known}` };
    }
    return { state: 'ready', version: found.version, schema: op.input };
  } catch (err) {
    return { state: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
