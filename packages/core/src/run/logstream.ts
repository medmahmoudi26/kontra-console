/**
 * The live log stream — every actor at once, as the lines are written (kontra#17, ADR 0050 §1).
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * `run/logs.ts` is the RUN PAGE's rail: one run, filtered, newest-first, read beside the thing the
 * run did. It answers "why did it do that". This answers a different question — "what is happening
 * right now, across everything" — and the difference shows up in every design decision below:
 * oldest-first, unfiltered by default, auto-following the tail, and carrying an ACTOR IDENTITY on
 * every line because the lines are interleaved and the rail's lines are not.
 *
 * `parseRecord` is shared rather than rewritten. One wire shape, one parser; a second one is how
 * `incomplete` ends up recognised on one surface and dropped on the other.
 *
 * ── WHY `fetch` + `ReadableStream` AND NOT `EventSource` ────────────────────────────────────────
 *
 * Both other subscriptions in this console use `EventSource` (`runStream.ts`, `liveRows.ts`) and
 * get reconnection and `Last-Event-ID` for free. This one cannot: `/api/logs/tail` is FAIL-CLOSED
 * on a bearer (`routes/logs.ts::admit`, and the reason is that a log line "routinely contains
 * targets and sometimes secrets"), `EventSource` has no way to set a header, and `session.ts`
 * installs its credential by wrapping `window.fetch` — which `EventSource` does not go through.
 *
 * So the reconnection `EventSource` would have given us is written out by hand below. That is the
 * cost of the header, and it is the right trade: the alternative is a session token in a query
 * string, which lands in the orchestrator's access log.
 *
 * ── THE COLOUR IS A TRACKING AID; THE NAME IS THE IDENTITY ──────────────────────────────────────
 *
 * {@link actorStyle} is a pure function of the actor name, so one actor is the same colour in every
 * tab, after every reload, forever — which is the whole point, since the thing an operator actually
 * does with an interleaved stream is follow ONE emitter down the page. It is stateless, so two
 * actors CAN land on the same swatch; see the note on {@link SLOTS}. That is survivable precisely
 * because the name is printed on every line and the colour only helps you find it.
 */

import { type LogRecord, parseRecord } from './logs';

/**
 * A line as the stream holds it: a record plus the order it arrived in.
 *
 * `seq` EXISTS TO BE A KEY, and it exists because the obvious keys are not unique. Two machines
 * writing at the same millisecond produce two records with the same `ts`; a progress line repeats
 * its own text; `ts + msg` collides on both. A keyed list with duplicate keys is a framework error
 * in Svelte and a silently wrong diff everywhere else, and it only ever happens under load — which
 * is the moment this surface is being looked at.
 */
export interface StreamLine extends LogRecord {
  seq: number;
}

/* ── SSE FRAMING ─────────────────────────────────────────────────────────────────────────────── */

export interface Frame {
  /** The `event:` field. `log` and `error` are the two `routes/logs.ts` sends. */
  event: string;
  /** The `data:` field, joined with newlines if the frame sent several. */
  data: string;
}

/**
 * Split whatever has arrived so far into whole frames, and hand back the part that is not whole.
 *
 * THE UNTERMINATED TAIL IS RETURNED, NOT DROPPED. A chunk boundary falls mid-frame often enough
 * that discarding the remainder loses lines only under load — the worst way to lose them, because
 * the surface looks calm rather than broken. `routes/logs.ts` keeps the same partial for the same
 * reason on the hop before this one; losing it here would undo that.
 *
 * Frames are separated by a BLANK LINE, and the separator is matched as `\r?\n\r?\n` rather than as
 * `\n\n`. The orchestrator writes `\n\n` itself, so `\n\n` looks sufficient — and it is not: under
 * CRLF the separator is `\r\n\r\n`, which contains `\n\r\n` and no `\n\n` at all, so a splitter
 * looking for the latter finds ZERO frames and reports a healthy, permanently silent stream. That
 * is the shape of the bug this surface exists to stop rendering. The stray `\r` is then stripped
 * per field, so nothing arrives with an invisible character glued to the end of its JSON.
 */
export function readFrames(buffer: string): { frames: Frame[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  // The last block has no terminator yet — by definition, since the split consumed every one that
  // did. It may be the empty string, which is exactly right: nothing is pending.
  const rest = blocks.pop() ?? '';
  const frames: Frame[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue; // a comment / keep-alive
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // SSE strips ONE leading space after the colon, and only one.
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

/**
 * A `log` frame's payload → a record, or `null` if it is not one.
 *
 * A FRAME THAT DOES NOT PARSE IS NOT A REASON TO TEAR DOWN A WORKING STREAM — the same rule
 * `runStream.ts` states. The next frame will almost certainly be fine, and a stream that dies on
 * one malformed line is a stream that dies exactly when something upstream is already wrong.
 */
export function lineOf(frame: Frame): LogRecord | null {
  if (frame.event !== 'log') return null;
  try {
    return parseRecord(JSON.parse(frame.data) as Record<string, unknown>, '');
  } catch {
    return null;
  }
}

/** An `error` frame's sentence. `routes/logs.ts` writes a whole explanatory one; it is used verbatim. */
export function errorOf(frame: Frame): string | null {
  if (frame.event !== 'error') return null;
  try {
    const body = JSON.parse(frame.data) as { error?: string };
    return body.error ?? frame.data;
  } catch {
    return frame.data;
  }
}

/* ── PER-ACTOR COLOUR ────────────────────────────────────────────────────────────────────────── */

/**
 * Twelve hues, 30° apart, and three lightnesses — thirty-six swatches.
 *
 * ── WHY OKLCH AND NOT HSL ───────────────────────────────────────────────────────────────────────
 *
 * The requirement is "vary only the hue, keep every actor equally readable on `--bg`". HSL cannot
 * do that: `hsl(60 70% 65%)` is a bright yellow and `hsl(240 70% 65%)` is a murky blue-grey at the
 * same stated lightness, so a hue-only palette in HSL silently makes half the actors harder to read
 * than the other half. OKLCH's L is perceptual, so a fixed L really is a fixed readability.
 *
 * ── WHY LIGHTNESS TIERS INSTEAD OF MORE HUES ────────────────────────────────────────────────────
 *
 * Thirty-six hues are 10° apart, and 10° at this chroma is not a difference anyone can use in a
 * scrolling list. Splitting the same twelve hues across three clearly different lightnesses
 * triples the swatch count while keeping the hue separation at 30°, so a collision in hue is still
 * legible as "the pale blue one" versus "the deep blue one".
 *
 * THE THIRD TIER IS 0.62 BECAUSE THAT IS THE FLOOR, not because it looked right. Measured as WCAG
 * contrast against `--bg` (#0b0f14) across all twelve hues: L=0.85 → 10.63:1, L=0.72 → 7.28:1,
 * L=0.62 → 4.93:1, L=0.58 → 4.18:1. The last one fails the 4.5:1 minimum for body text, so 0.62 is
 * the darkest tier this palette may contain. A fourth tier would have to fail a reader to exist.
 *
 * Some hues sit outside sRGB at this chroma and the browser gamut-maps them; mapping preserves hue,
 * so the twelve stay distinguishable — but it is why the palette is specified in OKLCH and read
 * back from the DOM in the Playwright checks rather than assumed.
 *
 * ── THE COLLISIONS ARE STILL REAL, JUST RARER ───────────────────────────────────────────────────
 *
 * THIS WAS TWENTY-FOUR SLOTS AND IT COLLIDED ON THE REAL FLEET. `desync` and `probe` both landed on
 * slot 6 — three actors on screen, two colours — which defeats the one thing the colour is for. Not
 * a theoretical risk: it was found by screenshotting the actual cluster, and it is the reason for
 * the third tier. P(some pair collides) fell from 12%/36%/73% at 3/5/8 actors to 8%/25%/57%.
 *
 * It is not zero and cannot be. THAT IS THE PRICE OF STATELESSNESS and it is deliberately paid: the
 * alternatives — assigning colours in arrival order, or de-colliding against the set present — make
 * an actor's colour change when a DIFFERENT actor appears, which breaks the one property the colour
 * exists to provide. `stern` and `kubetail` make the same trade for the same reason.
 *
 * What makes it survivable: the actor's NAME is on every line and in the legend, so the colour is
 * never the only thing carrying the identity. A collision costs a little tracking speed; a colour
 * that moves costs trust.
 *
 * One of the twelve hues sits near `--bad` and one near `--warn`. The level colouring lives on the
 * message and the row's left border, never on the actor token, so the two never occupy the same
 * pixels — but it is worth knowing before wondering why an actor looks alarming.
 */
export const HUES: readonly number[] = [25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355];
const LIGHTNESS: readonly number[] = [0.85, 0.72, 0.62];
const CHROMA = 0.13;

/** How many distinct swatches exist. Exported because the collision argument above is a fact about it. */
export const SLOTS = HUES.length * LIGHTNESS.length;

/**
 * FNV-1a with a murmur3 finalizer.
 *
 * THE FINALIZER IS NOT DECORATION. FNV alone, taken modulo a small number, distributes short
 * lowercase words badly — `desync` and `nuclei` land on the same slot at both 12 and 24, because
 * the entropy in a six-character string never reaches the low bits. The avalanche step mixes the
 * high bits down, and the same two names separate. Measured, on the actor names this fleet runs.
 */
export function hashActor(actor: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < actor.length; i++) {
    h ^= actor.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export interface ActorStyle {
  /** The slot, 0…{@link SLOTS}-1. Two actors with the same slot have the same swatch. */
  slot: number;
  hue: number;
  lightness: number;
  /** The CSS colour, ready for a `style=` attribute. */
  color: string;
}

/**
 * An actor's swatch. Pure, total, and stable forever — see the header.
 *
 * AN ABSENT ACTOR IS NOT AN ERROR. A line from the control plane has no `actor` field at all, and
 * it still has to draw; it gets the empty string's slot like anything else, and the component
 * labels it rather than leaving the column blank.
 */
export function actorStyle(actor: string): ActorStyle {
  const slot = hashActor(actor) % SLOTS;
  const hue = HUES[slot % HUES.length]!;
  const lightness = LIGHTNESS[Math.floor(slot / HUES.length)]!;
  return { slot, hue, lightness, color: `oklch(${lightness} ${CHROMA} ${hue})` };
}

/* ── THE BUFFER ──────────────────────────────────────────────────────────────────────────────── */

/**
 * How many lines are kept.
 *
 * A TAIL LEFT OPEN OVERNIGHT IS THE CASE THIS IS FOR. At a few hundred lines a minute an uncapped
 * list is tens of megabytes of strings and a DOM the browser cannot scroll by morning, and the tab
 * dies in a way that looks like the console being slow.
 *
 * FIVE THOUSAND RATHER THAN A LARGER NUMBER, because this surface draws every retained line — there
 * is no virtual scroller, and adding one would be a windowing bug factory in exchange for
 * scrollback nobody reads by eye. Five thousand rows of twelve-pixel mono is about twenty screens,
 * which is the point past which the honest answer is `/api/logs/query` rather than the mouse wheel.
 */
export const MAX_LINES = 5_000;

/**
 * Append arrivals, oldest last, dropping from the FRONT when the cap is reached.
 *
 * OLDEST-FIRST, unlike the run rail, and it is not a preference: a terminal reads downward, and the
 * whole follow-the-tail behaviour is meaningless in a list whose newest line is at the top.
 *
 * Returns what was dropped so the surface can SAY so. Silently discarding the head is how a reader
 * scrolls up, finds the top, and concludes that is where the run began.
 */
export function appendLines(
  lines: readonly StreamLine[],
  arriving: readonly LogRecord[],
  nextSeq: number,
  cap: number = MAX_LINES
): { lines: StreamLine[]; nextSeq: number; dropped: number } {
  let seq = nextSeq;
  const out = lines.concat(arriving.map((r) => ({ ...r, seq: seq++ })));
  const dropped = Math.max(0, out.length - cap);
  return { lines: dropped > 0 ? out.slice(dropped) : out, nextSeq: seq, dropped };
}

/* ── FOLLOW / PAUSE ──────────────────────────────────────────────────────────────────────────── */

/** The three numbers a scroller knows about itself. Named so the rule can be tested without one. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * The distance from the bottom inside which "following" is still true.
 *
 * NOT ZERO, and not a style choice. Sub-pixel layout, a partially visible last row and a trackpad's
 * momentum all leave `scrollTop` a few pixels short of the exact bottom, so an exact test drops out
 * of follow mode at random while the user is doing nothing at all. Three rows of slack is small
 * enough that a deliberate scroll up always registers.
 */
export const FOLLOW_SLACK_PX = 48;

/** Is this scroller parked at its bottom edge? */
export function atBottom(m: ScrollMetrics, slack: number = FOLLOW_SLACK_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack;
}

/**
 * Whether the view should still be following, given where the scroller is now.
 *
 * FOLLOWING IS DERIVED FROM POSITION, NOT REMEMBERED. The tempting shape is a boolean flipped by a
 * "user scrolled" event, and it is wrong in both directions: appending rows fires a scroll event
 * that is not a user action, and scrolling back down to the bottom is unmistakably a request to
 * resume that an event-driven flag has to special-case anyway. Reading the position answers both
 * without a special case — and the surface's own scroll-to-bottom leaves the position at the
 * bottom, so it re-affirms `true` rather than fighting it.
 */
export function shouldFollow(m: ScrollMetrics, slack: number = FOLLOW_SLACK_PX): boolean {
  return atBottom(m, slack);
}

/* ── RECONNECTION ────────────────────────────────────────────────────────────────────────────── */

/**
 * The backoff `EventSource` would have provided. Exponential, capped, and RESET BY SUCCESS.
 *
 * The cap matters more than the curve: an orchestrator redeploy takes a few seconds, and a console
 * left open through one should be live again a few seconds later — not in eight minutes because an
 * uncapped doubling ran while nobody was watching.
 */
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_CAP_MS = 15_000;

export function nextBackoff(previous: number): number {
  if (previous <= 0) return BACKOFF_START_MS;
  return Math.min(previous * 2, BACKOFF_CAP_MS);
}

/* ── TRANSPORT ───────────────────────────────────────────────────────────────────────────────── */

/**
 * What the surface is doing, which is not the same as what it is showing.
 *
 * `reconnecting` KEEPS THE LINES ON SCREEN. A dropped stream does not make the last four thousand
 * lines untrue; clearing them would be the surface lying about history because it lost the future.
 */
export type Phase = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface TailHandlers {
  onlines: (records: LogRecord[]) => void;
  onphase: (phase: Phase) => void;
  /**
   * A SENTENCE, from the server where there is one.
   *
   * `routes/logs.ts::unreachable` writes an explanatory paragraph naming the compose service and
   * the command to check it, specifically so a surface does not have to guess. Paraphrasing it
   * throws away the only part of a 503 that helps.
   */
  onerror: (sentence: string) => void;
}

export interface TailDeps {
  fetchImpl?: typeof fetch;
  /** Injected so a test can drive the backoff without waiting for it. */
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

/** `/api/logs/query`'s newest-first answer, oldest-first, which is the order the stream reads in. */
export async function backfill(
  query: string,
  limit: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ lines: LogRecord[]; error: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(
      `/api/logs/query?query=${encodeURIComponent(query)}&limit=${String(limit)}`
    );
  } catch (err) {
    return { lines: [], error: `could not reach the console's own API: ${String(err)}` };
  }
  if (!res.ok) {
    // THE SERVER'S SENTENCE, NOT OURS. A 503 here names `victorialogs` and the command to check it.
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { lines: [], error: body.error ?? `${res.status} ${res.statusText}` };
  }
  const text = await res.text();
  const lines: LogRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(parseRecord(JSON.parse(line) as Record<string, unknown>, ''));
    } catch {
      /* a malformed line is not a reason to lose the rest */
    }
  }
  // Newest-first on the wire — `/select/logsql/query` answers that way — and the terminal reads
  // downward, so it is reversed here rather than in the component. Sorted rather than merely
  // reversed: the limit is applied by recency, and nothing promises the order within it.
  return { lines: lines.sort((a, b) => a.ts - b.ts), error: null };
}

/**
 * Join the backfill to the frames that arrived while it was in flight.
 *
 * ── WHY THE TWO OVERLAP AT ALL ──────────────────────────────────────────────────────────────────
 *
 * A terminal that starts empty and waits reads as broken, so the surface backfills. Doing it
 * SEQUENTIALLY — await the backfill, then open the tail — leaves every line written in between
 * permanently missing, and `/api/logs/query` is allowed ten seconds. So the tail is opened first
 * and its frames are HELD until the backfill lands.
 *
 * Which creates the opposite problem: a line written after the query was issued and before it
 * answered is in BOTH. Rendering it twice is not cosmetic here — a duplicated `baseline not
 * reproducible` reads as two failures, and counting incidents off a log is something operators do.
 *
 * THE HELD FRAMES WIN, because the tail is the authority on everything from the moment it opened.
 * Anything the backfill offers at or after the first held line's timestamp is the same event seen
 * twice, so the backfill is truncated there rather than de-duplicated by content — content matching
 * would also collapse two genuinely repeated progress lines, which is a worse error than keeping
 * one extra.
 */
export function mergeBackfill(
  backfilled: readonly LogRecord[],
  held: readonly LogRecord[]
): LogRecord[] {
  if (held.length === 0) return [...backfilled];
  const edge = held[0]!.ts;
  return [...backfilled.filter((r) => r.ts < edge), ...held];
}

/**
 * Open the tail and keep it open. Returns the teardown.
 *
 * THE RETURNED FUNCTION MUST BE CALLED. It aborts the in-flight request, which is what tells the
 * orchestrator's `req.raw.on('close')` to abort ITS request to VictoriaLogs; a surface that forgets
 * leaves an open upstream tail per navigation, and they accumulate on the server rather than here.
 */
export function openTail(query: string, h: TailHandlers, deps: TailDeps = {}): () => void {
  const doFetch = deps.fetchImpl ?? fetch;
  const setT = deps.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeoutImpl ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>));

  let stopped = false;
  let backoff = 0;
  let timer: unknown;
  let controller: AbortController | null = null;

  const schedule = (): void => {
    if (stopped) return;
    backoff = nextBackoff(backoff);
    h.onphase('reconnecting');
    timer = setT(() => void attempt(), backoff);
  };

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    controller = new AbortController();
    h.onphase(backoff === 0 ? 'connecting' : 'reconnecting');
    try {
      const res = await doFetch(`/api/logs/tail?query=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { accept: 'text/event-stream' },
      });

      // A REFUSAL IS NOT ALWAYS SSE. `admit` answers a plain JSON 401/503 through Fastify, while
      // the route's own failures answer 502/503 WITH stream headers and an error frame in the body.
      // Reading the first as a stream yields nothing and looks like a quiet backend.
      const kind = res.headers.get('content-type') ?? '';
      if (!res.ok && !kind.includes('text/event-stream')) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        h.onerror(body.error ?? `${res.status} ${res.statusText}`);
        schedule();
        return;
      }
      if (!res.body) {
        h.onerror('the log stream opened with no body — this browser cannot read a streamed response.');
        h.onphase('closed');
        return;
      }

      h.onphase('live');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { frames, rest } = readFrames(buf);
        buf = rest;
        const records: LogRecord[] = [];
        for (const frame of frames) {
          const sentence = errorOf(frame);
          if (sentence !== null) {
            h.onerror(sentence);
            continue;
          }
          const record = lineOf(frame);
          if (record) records.push(record);
        }
        if (records.length > 0) {
          // A FRAME THAT ARRIVED IS A LIVE STREAM. Resetting here rather than on connect means a
          // server that accepts the connection and then says nothing keeps backing off, which is
          // the behaviour that stops a half-open socket being retried every second forever.
          backoff = 0;
          h.onlines(records);
        }
      }
      // The server closed. On this route that is VictoriaLogs ending the tail, not a finished
      // stream — there is no such thing as a finished tail — so it is reconnected, with backoff.
      if (!stopped) schedule();
    } catch (err) {
      if (stopped || controller?.signal.aborted) return; // we left; not an error
      h.onerror(`the log stream dropped: ${String((err as Error)?.message ?? err)}`);
      schedule();
    }
  };

  void attempt();

  return () => {
    stopped = true;
    if (timer !== undefined) clearT(timer);
    controller?.abort();
  };
}
