/**
 * Follow one Run as it happens.
 *
 * ── THE SECOND ENDPOINT THAT SHIPPED WITHOUT A CONSUMER ─────────────────────────────────────────
 *
 * `/api/runs/:runId/stream` was written, tested and never registered; it was wired into the server
 * earlier in this migration and this is the first thing to subscribe. With it, both of the SSE
 * endpoints the control plane publishes are consumed and the console has no data poll left.
 *
 * ── THREE NAMED EVENTS, AND `end` IS NOT AN ERROR ───────────────────────────────────────────────
 *
 * `state` carries the run view. `warn` is the server saying it could not read this time — a blip,
 * not a failure, and the last good state stays on screen. `end` means the run reached a terminal
 * status and the server is closing deliberately.
 *
 * TREATING `end` AS A DROP IS THE BUG TO AVOID. `EventSource` reconnects on its own, so a stream the
 * server closed on purpose would be reopened forever against a finished run — a poll, reinvented,
 * against the one run guaranteed never to change again. So `end` closes the source explicitly.
 */
export type Follow<T> =
  | { state: 'connecting' }
  | { state: 'live'; run: T }
  | { state: 'reconnecting'; run?: T }
  | { state: 'ended'; run?: T }
  | { state: 'unsupported' };

interface Deps {
  EventSourceImpl?: typeof EventSource;
}

export function followRun<T>(
  runId: string,
  onchange: (f: Follow<T>) => void,
  deps: Deps = {}
): () => void {
  const ES = deps.EventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
  if (!ES) {
    // Said out loud rather than silently falling back to a timer, which is the thing being removed.
    onchange({ state: 'unsupported' });
    return () => {};
  }

  let last: T | undefined;
  let closed = false;
  const source = new ES(`/api/runs/${encodeURIComponent(runId)}/stream`);

  source.addEventListener('state', (e) => {
    try {
      last = JSON.parse((e as MessageEvent<string>).data) as T;
      onchange({ state: 'live', run: last });
    } catch {
      // A frame that did not parse is not a reason to tear down a working stream; the next one
      // will almost certainly be fine, and the previous state is still true.
      onchange({ state: 'reconnecting', run: last });
    }
  });

  source.addEventListener('warn', () => {
    // The SERVER could not read the run this time. The stream is fine and the last state stands.
    onchange({ state: 'reconnecting', run: last });
  });

  source.addEventListener('end', () => {
    closed = true;
    source.close();
    onchange({ state: 'ended', run: last });
  });

  source.onerror = () => {
    // Fired on every reconnect attempt, including the ones that succeed. Only meaningful if the
    // server has not already told us it is done.
    if (!closed) onchange({ state: 'reconnecting', run: last });
  };

  return () => {
    closed = true;
    source.close();
  };
}
