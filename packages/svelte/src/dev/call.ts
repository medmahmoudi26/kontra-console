/**
 * Call a Method from the form, and follow what it did.
 *
 * ── THE FORM HAS A NAME; THE ROUTE WANTS A FOLDER ───────────────────────────────────────────────
 *
 * `/dev` is opened by the editor with an actor NAME, because that is what an editor knows. A probe
 * runs a registered FOLDER — `POST /api/sources/actor/:id/probe` — so the Actor and the version a
 * call uses are the folder's and cannot be aimed by anything a client sends. Resolving name → folder
 * is therefore a real step, and it is the step that fails: two checkouts of one actor are two
 * folders with one name, and picking either silently would run somebody else's code.
 *
 * ── NOTHING POLLS ───────────────────────────────────────────────────────────────────────────────
 *
 * A probe IS a Run, so it has a run stream. The call subscribes to it and reads the probe's return
 * value ONCE, when the stream says the run reached a terminal status. A timer here would be the
 * console's last data poll, reintroduced on the newest surface.
 *
 * ── `isolated` IS SHOWN, NOT FOLDED IN ──────────────────────────────────────────────────────────
 *
 * ADR 0028 §4: a Method that dropped every Unit and one that legitimately found nothing both return
 * zero rows. The reading carries both counts and the pane prints both, because the alternative is
 * how a 15,814-target run once reported `completed` in seven minutes having scanned almost nothing.
 */
import { fetchSources, readProbe, runProbe, type ProbeReading } from '@kontra/console-core/run/api';

import { followRun } from '../workflows/runStream';

export type Call =
  | { state: 'idle' }
  | { state: 'starting' }
  /** Started. `status` is Temporal's own word once the stream has said one. */
  | { state: 'running'; runId: string; status: string }
  | { state: 'done'; runId: string; reading: ProbeReading }
  | { state: 'error'; error: string };

interface Deps {
  sources?: typeof fetchSources;
  start?: typeof runProbe;
  read?: typeof readProbe;
  follow?: typeof followRun;
}

/**
 * Which registered folder is this actor.
 *
 * AMBIGUITY IS AN ERROR, NOT A PICK. Two registrations with one name and one version are a question
 * only the operator can answer, and answering it with `[0]` runs a checkout they did not choose.
 */
export async function folderFor(
  actor: string,
  version: string,
  list: typeof fetchSources = fetchSources
): Promise<{ id: string } | { error: string }> {
  let sources;
  try {
    sources = (await list('actor')).sources;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const named = sources.filter((s) => s.name === actor && !s.absent);
  if (named.length === 0) {
    return {
      error: `no registered folder holds ${actor}. \`kontra actor register <dir>\` adds one.`,
    };
  }
  // The version narrows it where the folders differ by version — which is the ordinary case for a
  // checkout of an older release beside the current one.
  const exact = named.filter((s) => s.version === version);
  const candidates = exact.length > 0 ? exact : named;
  if (candidates.length > 1) {
    return {
      error: `${candidates.length} registered folders are called ${actor}: ${candidates
        .map((s) => s.path)
        .join(', ')}. Forget the one you are not working on.`,
    };
  }
  return { id: candidates[0]!.id };
}

/**
 * Start the call and report every step.
 *
 * Returns the unsubscribe for the run stream, so a pane that closes mid-call stops listening — an
 * `EventSource` left open against a finished run reconnects forever.
 */
export function callMethod(
  actor: string,
  version: string,
  method: string,
  units: readonly unknown[],
  onchange: (c: Call) => void,
  deps: Deps = {}
): () => void {
  const list = deps.sources ?? fetchSources;
  const start = deps.start ?? runProbe;
  const read = deps.read ?? readProbe;
  const watch = deps.follow ?? followRun;

  let stop = (): void => {};
  let abandoned = false;

  onchange({ state: 'starting' });
  void (async () => {
    const folder = await folderFor(actor, version, list);
    if ('error' in folder) return onchange({ state: 'error', error: folder.error });
    if (abandoned) return;

    let runId: string;
    try {
      ({ runId } = await start(folder.id, method, [...units]));
    } catch (err) {
      // The server's own sentence, verbatim. These 400s each name their fix — no Nexus endpoint, a
      // queue whose pollers are stale, no probe worker — and rewording them loses the fix.
      return onchange({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    if (abandoned) return;
    onchange({ state: 'running', runId, status: 'RUNNING' });

    stop = watch<{ status?: string }>(runId, (f) => {
      if (f.state === 'live' && f.run?.status) onchange({ state: 'running', runId, status: f.run.status });
      if (f.state !== 'ended') return;
      void read(runId)
        .then((reading) => onchange({ state: 'done', runId, reading }))
        // The run finished and the READING failed — a different thing from a failed call, and
        // saying "call failed" here would blame the operator's Method for the console's fetch.
        .catch((err) =>
          onchange({
            state: 'error',
            error: `${runId} finished but its result could not be read: ${err instanceof Error ? err.message : String(err)}`,
          })
        );
    });
  })();

  return () => {
    abandoned = true;
    stop();
  };
}
