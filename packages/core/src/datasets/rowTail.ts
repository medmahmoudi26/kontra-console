/**
 * The live row tail on the client (live-datasets slice 05): watch a Run's rows land while its
 * Dataset is still `open`, read from the ONE durable path the server LISTs — `/api/datasets/rows/
 * stream`, its own SSE endpoint, not `/api/events`.
 *
 * GRANULARITY IS CHUNK, NOT ROW, AND THIS SAYS SO. The server reports `{rows, lastChunkAt}` per
 * poll of the durable path, so the readout is "1,203 rows · last chunk 4s ago" — a count and the age
 * of the newest blob, never an animated per-row trickle. Apify's storage is row-append; this one is
 * chunked blobs, and pretending otherwise is the same category of lie as a merged status field.
 *
 * A KILLED STREAM DEGRADES, IT DOES NOT FREEZE. `EventSource` fires `onerror` when the socket drops
 * (server gone, network blip); the phase goes `degraded` and the readout SAYS the stream was lost
 * while still showing the last count it knew — the operator must be able to tell "1,203 and still
 * live" from "1,203 and the pipe is dead", which a frozen number cannot.
 */


/**
 * One chunk of the window: the stored object and a stable id for it.
 *
 * The id is what makes the tail ACCUMULATE. The server re-sends its whole window every poll, so a
 * client that appended blindly would repeat every chunk once per poll; keyed by id, a re-sent chunk
 * is recognised and the tail only grows at the new end.
 */
export interface RowChunk {
  id: string;
  row: unknown;
}

/** One reading of the durable path, as the SSE `data:` payload carries it. */
export interface LiveRows {
  /** Committed rows: the object count of `units/run=<id>/`. One blob is one pushed record. */
  rows: number;
  /** Epoch ms of the newest chunk, or `null` when the store reported no mtime. */
  lastChunkAt: number | null;
  /** When the server took the reading (epoch ms). */
  at: number;
  /**
   * A BOUNDED WINDOW OF THE ROWS THEMSELVES (issue 05) — the newest first few, oldest-first.
   *
   * "1,203 rows" and "1,203 rows of the same 403 page" are the same number, and telling them apart
   * is most of "is this run doing the right thing". The server bounds this by count AND by bytes
   * (`ROW_TAIL_WINDOW` / `ROW_TAIL_WINDOW_BYTES`), reads it from the same durable path the count
   * comes from, and never sends a row its store does not hold.
   *
   * ABSENT ON A REPLAYED SNAPSHOT, and that is deliberate rather than incidental: the server keeps
   * the window out of its per-run ring, so a client that reconnects and replays gets the counts it
   * missed and the rows on the next poll. `undefined` therefore means "this snapshot is not
   * carrying rows", which is a different claim from `[]` — "the window was empty" — and a readout
   * must not render the second when it was handed the first.
   */
  recent?: RowChunk[];
  /** The byte budget cut the window short of its row count, so a reader knows why a wide-rowed Run
   *  shows three rows where a narrow one shows five. */
  clipped?: boolean;
}

/**
 * `connecting` — the socket is up but no count has arrived yet.
 * `live`       — a snapshot has landed and the stream is healthy.
 * `degraded`   — the socket dropped; the last count is shown but is no longer trusted to be current.
 */
export type RowTailPhase = 'connecting' | 'live' | 'degraded';

/**
 * How many chunks the accumulated tail keeps.
 *
 * A tail that grows without bound is a leak on a Run that emits for hours, so this is the point at
 * which the oldest end is dropped. It is far above the server's 50-chunk window, so the limit a
 * reader meets in practice is what the stream delivered, not this.
 */
export const ROW_TAIL_KEEP = 500;

export interface RowTailState {
  snapshot: LiveRows | null;
  phase: RowTailPhase;
  /**
   * Every chunk this client has seen, oldest-first — the tail itself.
   *
   * Accumulated rather than replaced, because the server's `recent` is a 50-chunk WINDOW re-sent
   * whole on every poll: rendering it directly shows the same few rows forever while the count
   * climbs past them. Deduped by {@link RowChunk.id} and capped at {@link ROW_TAIL_KEEP}.
   *
   * It is what this client SAW, which on a Run producing faster than the poll is a sample rather
   * than the whole log — `rows` on the snapshot stays the authority on how many exist.
   */
  tail: RowChunk[];
}

export const ROW_TAIL_START: RowTailState = { snapshot: null, phase: 'connecting', tail: [] };

export type RowTailInbound =
  | { type: 'open' }
  | { type: 'snapshot'; snapshot: LiveRows }
  | { type: 'error' };

/**
 * Fold one stream event into the readout state. A snapshot is FULL STATE (the server sends a count,
 * not a delta), so it simply replaces the last one and marks the stream live. An error degrades the
 * phase but KEEPS the snapshot — a degraded readout that lost its number would be no better than a
 * frozen one. An `open` after a degrade returns to `connecting` until the next snapshot confirms it.
 */
export function rowTailReduce(state: RowTailState, ev: RowTailInbound): RowTailState {
  switch (ev.type) {
    case 'snapshot':
      return { snapshot: ev.snapshot, phase: 'live', tail: merge(state.tail, ev.snapshot.recent) };
    case 'error':
      return { ...state, phase: 'degraded' };
    case 'open':
      return state.phase === 'degraded' ? { ...state, phase: 'connecting' } : state;
    default:
      return state;
  }
}

/**
 * Fold a window into the tail: append what is new, in arrival order, and drop the oldest past the
 * cap.
 *
 * A snapshot with NO `recent` leaves the tail alone. That is the replay case — a reconnecting
 * client is handed the counts it missed and no rows — and clearing on it would blank a tail that
 * is still correct every time the socket blinked.
 */
function merge(tail: RowChunk[], incoming: RowChunk[] | undefined): RowChunk[] {
  if (!Array.isArray(incoming) || incoming.length === 0) return tail;
  const seen = new Set(tail.map((c) => c.id));
  const fresh = incoming.filter((c) => c && typeof c.id === 'string' && !seen.has(c.id));
  if (fresh.length === 0) return tail;
  const next = tail.concat(fresh);
  return next.length > ROW_TAIL_KEEP ? next.slice(next.length - ROW_TAIL_KEEP) : next;
}

/** The age of the newest chunk, at the coarse grain the tail actually knows it. `null` in means the
 *  store reported no mtime, which is an honest "unknown", not "just now". */
export function formatChunkAge(lastChunkAt: number | null, now: number): string | null {
  if (lastChunkAt === null) return null;
  const ms = Math.max(0, now - lastChunkAt);
  if (ms < 1_500) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

/**
 * The readout string. Built to be honest at every phase:
 *
 *   - live, with an age:     `1,203 rows · last chunk 4s ago`
 *   - live, age unknown:     `1,203 rows` (the store gave no mtime — no fabricated age)
 *   - connecting, no count:  `watching for rows…`
 *   - degraded:              `stream lost · last known 1,203 rows` (or `stream lost` before any count)
 */
export function rowTailLabel(state: RowTailState, now: number): string {
  const rows = state.snapshot ? state.snapshot.rows.toLocaleString() : null;
  if (state.phase === 'degraded') {
    return rows ? `stream lost · last known ${rows} rows` : 'stream lost';
  }
  if (!state.snapshot) return 'watching for rows…';
  const age = formatChunkAge(state.snapshot.lastChunkAt, now);
  return age ? `${rows} rows · last chunk ${age}` : `${rows} rows`;
}

/** Whether the readout should read as degraded — for the caller to style (a dimmed/warning colour)
 *  rather than the healthy live one. Extracted so the styling decision has one source. */
export function rowTailDegraded(state: RowTailState): boolean {
  return state.phase === 'degraded';
}

/**
 * Subscribe to a Run's live row count over SSE. Returns the readout state; the caller renders it.
 *
 * `EventSource` is deliberate: it gives reconnect and `Last-Event-ID` for free, which is the hard
 * part of resume, and the server's seq rides the `id:` field so a blip resumes rather than reseeds.
 * The subscription is torn down on unmount or when `runId`/`enabled` changes — an idle Dataset opens
 * no socket, so the server polls nothing for a Run nobody is watching.
 */

/**
 * The rows a readout should draw, and nothing it should infer.
 *
 * `null` means DO NOT DRAW THE WINDOW AT ALL — either nothing has arrived, or this snapshot is a
 * replay that carries counts only. A component that treated that as an empty window would flash
 * "no rows yet" over a Run whose count says otherwise, every time a client reconnected.
 */
export function rowTailWindow(state: RowTailState): { rows: unknown[]; clipped: boolean } | null {
  if (state.tail.length === 0) return null;
  return {
    rows: state.tail.map((c) => c.row),
    // `clipped` is a property of the LAST reading, not of the accumulated tail: it says the byte
    // budget cut that window short, which is why a wide-rowed Run grows more slowly.
    clipped: state.snapshot?.clipped === true,
  };
}

/** True once the tail has reached {@link ROW_TAIL_KEEP} and is dropping its oldest end, so a reader
 *  is told the top of the list is no longer the beginning of the Run. */
export function rowTailTrimmed(state: RowTailState): boolean {
  return state.tail.length >= ROW_TAIL_KEEP;
}
