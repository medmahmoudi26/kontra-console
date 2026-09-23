/**
 * Tell me when a workflow's CONTRACT changes.
 *
 * ── THE CATALOG WRITE IS THE EVENT, NOT THE SAVE ────────────────────────────────────────────────
 *
 * The first version of this watched the folder: the server pushed on every filesystem change and
 * this re-read the descriptor. It never worked, and the reason is the whole lesson — a save is not
 * a new contract. The worker has to notice the change, re-import the module and re-register, which
 * takes seconds. Measured live: the file event arrived, this re-read twice within 1.2s, and both
 * reads returned the OLD descriptor because the worker was still importing. The form stayed stale
 * and nothing anywhere said why.
 *
 * `POST /api/workflows/catalog` is the moment the contract actually changed, and the orchestrator
 * now announces it. One read per event, and the read cannot be early because the write happened
 * first.
 *
 * ── ONE STREAM FOR THE SURFACE, NOT ONE PER FOLDER ──────────────────────────────────────────────
 *
 * The event carries the workflow TYPE, so a single subscription serves every folder a person
 * clicks through — and the server holds no file watcher for it at all.
 */
import { BASE } from '@kontra/console-core/run/api';

export interface WatchDeps {
  EventSourceImpl?: typeof EventSource;
}

/**
 * Subscribe to descriptor changes. `onchange` is called with the workflow type that moved.
 *
 * Returns the teardown. Nothing here is a timer: between saves this costs one idle connection.
 */
export function watchDescriptors(
  onchange: (name: string) => void,
  deps: WatchDeps = {}
): () => void {
  const ES = deps.EventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
  // NO POLLING FALLBACK. A browser without EventSource would otherwise get a timer, which is the
  // thing this console does not do; the surface still re-reads when the tab regains focus.
  if (!ES) return () => {};

  const source = new ES(`${BASE}/workflows/stream`);
  source.addEventListener('descriptor', (e) => {
    try {
      const said = JSON.parse((e as MessageEvent<string>).data) as { name?: unknown };
      onchange(typeof said.name === 'string' ? said.name : '');
    } catch {
      // A frame that did not parse still means SOMETHING was registered; re-read rather than
      // ignore it. The cost of being wrong here is one fetch.
      onchange('');
    }
  });
  return () => source.close();
}
