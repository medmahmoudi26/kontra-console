/**
 * The subscription behind the Logs surface. One object, owned by the view, torn down with it.
 *
 * ── EVERYTHING DECIDABLE IS DECIDED IN `@kontra/console-core/run/logstream` ─────────────────────
 *
 * Framing, colour, the cap, the follow rule, the backoff and the backfill merge are all pure
 * functions there, with a suite. What is left here is the part that genuinely needs reactive state:
 * holding the lines, and starting and stopping the transport. The split is not tidiness — jsdom has
 * no layout engine and a runes class is awkward to drive from a test, so anything that lives here
 * is effectively only checked by a browser.
 *
 * ── THE TAIL OPENS FIRST AND ITS FRAMES ARE HELD ────────────────────────────────────────────────
 *
 * A terminal that starts empty and waits reads as broken, so this backfills. Awaiting the backfill
 * before subscribing would lose every line written in between — `/api/logs/query` is allowed ten
 * seconds — so the tail is opened immediately and its frames are held in `#held` until the backfill
 * lands. `mergeBackfill` then joins the two without rendering the overlap twice.
 */
import {
  MAX_LINES,
  appendLines,
  backfill,
  mergeBackfill,
  openTail,
  type Phase,
  type StreamLine,
} from '@kontra/console-core/run/logstream';
import type { LogRecord } from '@kontra/console-core/run/logs';

/** How much history a cold open shows. Enough to look like a running system, not enough to stall. */
export const BACKFILL_LINES = 300;

export class LogStream {
  lines = $state<StreamLine[]>([]);
  phase = $state<Phase>('connecting');
  /** A SENTENCE — the server's own where there is one. Never a bare status code, never a blank list. */
  error = $state('');
  /**
   * Did `/api/logs/query` answer? Which is to say: IS THE BACKEND UP, independently of the tail.
   *
   * ── WHY THIS FIELD EXISTS, AND THE BUG THAT PUT IT HERE ─────────────────────────────────────
   *
   * `/api/logs/tail` SENDS NO RESPONSE HEADERS UNTIL THE FIRST LINE IS WRITTEN. VictoriaLogs'
   * `/select/logsql/tail` withholds them, and `routes/logs.ts` calls `reply.raw.writeHead` only
   * after awaiting that upstream fetch — so on a QUIET fleet the whole chain stalls and the
   * browser's `fetch()` promise never resolves. Measured: 20 seconds, zero bytes of header.
   *
   * `openTail` is then telling the truth when it reports `connecting` forever. The SURFACE is not:
   * it drew three hundred backfilled lines under the word "connecting", which reads as broken on a
   * system that is perfectly healthy and merely idle. That is precisely the confusion this whole
   * surface was built to end, reproduced by the surface itself.
   *
   * The backfill is the evidence that settles it. A `/api/logs/query` that answered proves the
   * logs backend is reachable RIGHT NOW; a tail that has said nothing on top of that means the
   * fleet is quiet, not that anything is wrong. The component reads the two together.
   *
   * THE REAL FIX IS IN THE ROUTE — write the SSE head before awaiting upstream, and report an
   * upstream failure as an `event: error` frame rather than as a 502 status. That is a change to a
   * shared API's status-code contract, so it is not made here.
   */
  reachable = $state(false);
  /**
   * The BACKFILL's failure, kept apart from the tail's.
   *
   * "The past is missing" and "the future has stopped" are different sentences about different
   * halves of the surface, and an operator acts on them differently. See where it is set.
   */
  historyError = $state('');
  /** How many lines the cap has discarded, so the top of the scrollback is not read as the start. */
  dropped = $state(0);

  #seq = 0;
  /** Tail frames that arrived before the backfill answered. `null` once the backfill has landed. */
  #held: LogRecord[] | null = [];

  #push(records: readonly LogRecord[]): void {
    const out = appendLines(this.lines, records, this.#seq, MAX_LINES);
    this.lines = out.lines;
    this.#seq = out.nextSeq;
    this.dropped += out.dropped;
  }

  /** Start. Returns the teardown — `$effect` takes it directly. */
  start(query: string = '*'): () => void {
    const stop = openTail(query, {
      onlines: (records) => {
        if (this.#held) this.#held.push(...records);
        else this.#push(records);
        // A FRAME IS PROOF THE BACKEND IS ANSWERING. A stale sentence from a drop five minutes ago
        // sitting above a stream that is plainly live is the surface disagreeing with itself.
        if (this.error) this.error = '';
      },
      onphase: (phase) => (this.phase = phase),
      onerror: (sentence) => (this.error = sentence),
    });

    void backfill(query, BACKFILL_LINES).then(({ lines, error }) => {
      const held = this.#held ?? [];
      this.#held = null;
      this.#push(mergeBackfill(lines, held));
      // An answer — even an EMPTY one — proves the backend is reachable. Only an error does not.
      this.reachable = error === null;
      /*
       * A FAILED BACKFILL IS ALWAYS SAID, AND SAID SEPARATELY. This read
       * `if (error && this.lines.length === 0)` — report it only when nothing else arrived — and
       * that was wrong in the one case it mattered.
       *
       * Caught in a browser: `/api/logs/query` answered 503, the tail was healthy and had already
       * delivered sixteen lines, so `lines.length !== 0` and THE 503 WAS DISCARDED. The surface
       * drew sixteen lines under a green `live`, with three hundred lines of history missing and
       * nothing at all on screen to say so. A reader would have concluded the fleet had just
       * started.
       *
       * It is its own field because it is its own fact. A failed backfill means THE PAST is
       * missing while the present keeps arriving; a failed tail means the past on screen is still
       * true and THE FUTURE has stopped. Folding them into one string lets the tail's recovery
       * clear a message about history it knows nothing about — which is exactly what `onlines`
       * does to `error`, correctly, and must not do to this.
       */
      this.historyError = error ?? '';
    });

    return () => {
      stop();
      this.phase = 'closed';
    };
  }

  /** Empty the scrollback. The stream stays open — this is `clear`, not `disconnect`. */
  clear(): void {
    this.lines = [];
    this.dropped = 0;
  }
}
