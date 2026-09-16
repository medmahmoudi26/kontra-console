/**
 * The live row tail: a dataset filling up while you watch it.
 *
 * The reducer, the labels and the degraded rule are `@kontra/console-core/datasets/rowTail` —
 * framework-free, and the half that was already tested. This is the subscription around them.
 *
 * ── A KILLED STREAM DEGRADES, IT DOES NOT FREEZE ────────────────────────────────────────────────
 *
 * `EventSource` gives reconnect and `Last-Event-ID` for free, which is the hard part of following a
 * chunked write. What it cannot do is SAY anything, so the phase goes to `degraded` and the last
 * snapshot stays on screen — a row count from four minutes ago presented as current is worse than
 * one labelled stale.
 *
 * This is the behaviour slice 11's criteria named, carried over rather than rebuilt: it is why the
 * reducer moved into core instead of being deleted with the React page.
 */
import {
  ROW_TAIL_START,
  rowTailReduce,
  type LiveRows,
  type RowTailState,
} from '@kontra/console-core/datasets/rowTail';
import { BASE } from '@kontra/console-core/run/api';

export function followRows(
  runId: string,
  onchange: (s: RowTailState) => void,
  EventSourceImpl: typeof EventSource | undefined = typeof EventSource !== 'undefined' ? EventSource : undefined
): () => void {
  let state = ROW_TAIL_START;
  const push = (ev: Parameters<typeof rowTailReduce>[1]): void => {
    state = rowTailReduce(state, ev);
    onchange(state);
  };

  if (!EventSourceImpl) {
    push({ type: 'error' });
    return () => {};
  }

  const es = new EventSourceImpl(`${BASE}/datasets/rows/stream?run=${encodeURIComponent(runId)}`);
  es.onopen = () => push({ type: 'open' });
  es.onmessage = (e) => {
    try {
      push({ type: 'snapshot', snapshot: JSON.parse((e as MessageEvent<string>).data) as LiveRows });
    } catch {
      // A frame that did not parse is not a reason to tear down a working stream.
      push({ type: 'error' });
    }
  };
  es.onerror = () => push({ type: 'error' });
  return () => es.close();
}
