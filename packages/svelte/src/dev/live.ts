/**
 * Keep a Method's contract current while its author edits it.
 *
 * ── THE MACHINERY EXISTED AND HAD NO CONSUMER ───────────────────────────────────────────────────
 *
 * `kontra serve --actor <dir> --watch` re-registers the contract on every save and
 * `/api/sources/actor/:id/schema/stream` publishes a notification. Both have shipped for a while;
 * this is the first thing to subscribe. That is the whole of "reactive to code changes"
 * (`CONTEXT.md`) — the operator's code, at runtime, not the console's at build time.
 *
 * ── A NOTIFICATION, NOT A PAYLOAD ───────────────────────────────────────────────────────────────
 *
 * The server sends `data: changed`. It does not send the schema, so this refetches — which is the
 * right shape: the stream says WHEN, the API says WHAT, and there is one representation of a
 * contract rather than two that can disagree.
 *
 * ── A DROPPED STREAM DEGRADES; IT DOES NOT FREEZE ───────────────────────────────────────────────
 *
 * `EventSource` reconnects on its own, which is most of why it is used here rather than a socket.
 * What it cannot do is TELL anyone, and a pane showing a contract from four minutes ago with no
 * indication is worse than one that says it is stale. So the connection state is a value the UI
 * renders, and the last good contract stays on screen while it reconnects — losing the form because
 * the network blinked is not an improvement.
 *
 * ── NO `setInterval` ────────────────────────────────────────────────────────────────────────────
 *
 * ADR 0048 §3. A poll would work and would reintroduce the thing being removed: a surface that is
 * stale for its interval and then jumps.
 */
import { withWorkspace } from '@kontra/console-core/run/session';

import { contractFor, type Contract } from './contract';

export type Link = 'connecting' | 'live' | 'reconnecting' | 'unsupported';

export interface LiveContract {
  contract: Contract;
  link: Link;
  /** How many times the contract has been re-read. The evidence that it is live, for a person. */
  revisions: number;
}

interface Deps {
  fetchImpl?: typeof fetch;
  /** Injected so a test can drive the stream without a server. */
  EventSourceImpl?: typeof EventSource;
}

/**
 * Subscribe, and call `onchange` whenever the contract is re-read.
 *
 * Returns a stop function. Always call it: an EventSource left open holds a connection the server
 * counts, and `/api/sources/:id/schema/stream` refuses past a limit with "close a runner tab".
 */
export function watchContract(
  actor: string,
  method: string,
  onchange: (state: LiveContract) => void,
  deps: Deps = {}
): () => void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ES = deps.EventSourceImpl ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);

  let state: LiveContract = { contract: { state: 'loading' }, link: 'connecting', revisions: 0 };
  const emit = (patch: Partial<LiveContract>): void => {
    state = { ...state, ...patch };
    onchange(state);
  };

  let stopped = false;
  let source: EventSource | undefined;

  const reread = async (): Promise<void> => {
    const next = await contractFor(actor, method, fetchImpl);
    if (stopped) return;
    // THE LAST GOOD CONTRACT SURVIVES A FAILED RE-READ. A save that briefly leaves the file
    // unparseable should not blank a form somebody is halfway through filling in.
    if (next.state === 'error' && state.contract.state === 'ready') {
      emit({ revisions: state.revisions + 1 });
      return;
    }
    emit({ contract: next, revisions: state.revisions + 1 });
  };

  void (async () => {
    await reread();
    if (stopped) return;
    if (!ES) {
      // Said out loud rather than silently falling back to a poll, which is the thing being removed.
      emit({ link: 'unsupported' });
      return;
    }
    const id = await sourceId(actor, fetchImpl);
    if (stopped || !id) {
      emit({ link: 'unsupported' });
      return;
    }
    source = new ES(withWorkspace(`/api/sources/actor/${encodeURIComponent(id)}/schema/stream`));
    source.onopen = () => emit({ link: 'live' });
    source.onmessage = () => void reread();
    // NOT AN ERROR STATE. EventSource fires `onerror` on every reconnect attempt, including the
    // ones that succeed; reporting it as a failure would make a blip look like a broken pane.
    source.onerror = () => emit({ link: 'reconnecting' });
  })();

  return () => {
    stopped = true;
    source?.close();
  };
}

/** The registered folder's id, which is what the stream is keyed by — the pane only knows a name. */
async function sourceId(actor: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl('/api/sources/actor', { credentials: 'same-origin' });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { sources?: { id: string; name: string }[] };
    return body.sources?.find((s) => s.name === actor)?.id;
  } catch {
    return undefined;
  }
}
