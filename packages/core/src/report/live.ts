/**
 * The live report stream (ADR 0062) — a report that re-renders while its run is still going.
 *
 * ── WHY `fetch` + `ReadableStream` AND NOT `EventSource` ───────────────────────────────────────
 *
 * The same reason `run/logstream.ts` gives, and it applies verbatim: `/api/runs/:runId/report/live`
 * is bearer-gated, `EventSource` cannot set a header, and `session.ts` installs this console's
 * credential by WRAPPING `window.fetch` — which `EventSource` does not go through. So the
 * reconnection `EventSource` would have given us is written out by hand below. The alternative, a
 * token in the query string, lands in the orchestrator's access log.
 *
 * ── THE PATCH IS BY INDEX, AND THE SERVER DECIDES WHEN THAT IS SAFE ────────────────────────────
 *
 * A `patch` names `{index, node}` against the block list the client holds. The server sends a whole
 * `snapshot` instead whenever the block COUNT changed, because one more row in a `{% for %}` shifts
 * every block after it and an index patch would then overwrite the wrong ones. So this module never
 * has to decide whether a patch is applicable — if it arrives, it is.
 *
 * ── A `final` ENDS THE STREAM, AND THE PAGE RE-READS ───────────────────────────────────────────
 *
 * The freeze is a VISIBLE transition, not a byte-identical last frame: `result` appears and the
 * `{% if result %}` branch flips. `final` carries the stored version so the caller can read the
 * persisted report, which is the authoritative one from then on.
 */

/** One top-level block of the rendered document. `node` is mdast, as the stored snapshot holds it. */
export interface LiveBlock {
  index: number;
  node: unknown;
}

export type LiveEvent =
  | { type: 'snapshot'; blocks: LiveBlock[]; warnings?: string[]; degraded?: string }
  | { type: 'patch'; blocks: LiveBlock[] }
  | { type: 'status'; status: string }
  | { type: 'final'; version: number };

/** `closed` is terminal and means the run ended; `stopped` means the caller let go. */
export type LivePhase = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'stopped';

export interface LiveHandlers {
  /** The whole document. Replaces whatever was on screen. */
  onSnapshot: (blocks: LiveBlock[], extra: { warnings?: string[]; degraded?: string }) => void;
  /** Only the blocks that changed, by index into the list the last snapshot established. */
  onPatch: (blocks: LiveBlock[]) => void;
  onStatus: (status: string) => void;
  /** The run ended and `version` is the stored report. The stream is over. */
  onFinal: (version: number) => void;
  onPhase: (phase: LivePhase) => void;
  /** A refusal that will not resolve by retrying — 404, 409 (already finished), 503 (at capacity). */
  onRefused: (status: number, message: string) => void;
}

export interface LiveOptions {
  fetch?: typeof globalThis.fetch;
  /** Backoff schedule in ms. Short at first, because a redeploy drops every stream at once. */
  backoff?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const BACKOFF = [0, 500, 1_000, 2_000, 5_000, 10_000] as const;

/**
 * Split an SSE buffer into complete frames.
 *
 * Returns the frames and the REMAINDER, because a chunk boundary falls wherever the network put it
 * and half a frame must wait for the rest rather than parse as a broken one.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  for (;;) {
    const at = rest.indexOf('\n\n');
    if (at === -1) break;
    frames.push(rest.slice(0, at));
    rest = rest.slice(at + 2);
  }
  return { frames, rest };
}

/** Parse one frame. `undefined` for anything that is not a well-formed event we know. */
export function parseFrame(frame: string): LiveEvent | undefined {
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (!line) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice('data: '.length));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const type = (parsed as { type?: unknown }).type;
  if (type === 'snapshot' || type === 'patch' || type === 'status' || type === 'final') {
    return parsed as LiveEvent;
  }
  return undefined;
}

/** Apply a patch to the block list the client holds. Pure, so a test can assert it directly. */
export function applyPatch(blocks: readonly unknown[], patch: readonly LiveBlock[]): unknown[] {
  const next = [...blocks];
  for (const b of patch) if (b.index >= 0 && b.index < next.length) next[b.index] = b.node;
  return next;
}

/**
 * Open the stream. Returns its stop.
 *
 * STOPPING IS THE CALLER'S JOB and the component's teardown must call it: an abandoned stream holds
 * a connection and one of the run's 50 viewer slots.
 */
export function openLiveReport(runId: string, handlers: LiveHandlers, opts: LiveOptions = {}): () => void {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const backoff = opts.backoff ?? BACKOFF;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `/api/runs/${encodeURIComponent(runId)}/report/live`;

  let controller: AbortController | null = null;
  let stopped = false;
  let attempt = 0;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    controller?.abort();
    handlers.onPhase('stopped');
  };

  const run = async (): Promise<void> => {
    while (!stopped) {
      const wait = backoff[Math.min(attempt, backoff.length - 1)]!;
      if (wait > 0) await sleep(wait);
      if (stopped) return;

      controller = new AbortController();
      handlers.onPhase(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        const res = await doFetch(url, {
          signal: controller.signal,
          headers: { accept: 'text/event-stream' },
        });
        // A REFUSAL IS NOT A DROPPED CONNECTION. Retrying a 404 or a 409 forever would hammer the
        // orchestrator for a document that is never going to appear on this route.
        if (res.status === 404 || res.status === 409 || res.status === 503) {
          let message = `the live report refused with ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            /* a refusal without a body is still a refusal */
          }
          handlers.onRefused(res.status, message);
          handlers.onPhase('closed');
          return;
        }
        if (!res.ok || !res.body) throw new Error(`live report: HTTP ${res.status}`);

        handlers.onPhase('live');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // A CONNECTION IS NOT PROGRESS; A FRAME IS. Resetting the backoff on connect alone gives a
        // HOT LOOP against a server that accepts the stream and then closes it — which is exactly
        // what a redeploy looks like for a second. Only data earns a reset, and even then to the
        // first non-zero step rather than to zero.
        let gotData = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = splitFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            const event = parseFrame(frame);
            if (!event) continue;
            gotData = true;
            if (event.type === 'snapshot') {
              const extra: { warnings?: string[]; degraded?: string } = {};
              if (event.warnings) extra.warnings = event.warnings;
              if (event.degraded) extra.degraded = event.degraded;
              handlers.onSnapshot(event.blocks, extra);
            } else if (event.type === 'patch') {
              handlers.onPatch(event.blocks);
            } else if (event.type === 'status') {
              handlers.onStatus(event.status);
            } else {
              // THE RUN ENDED. Terminal: the stored version is the answer from here on.
              handlers.onFinal(event.version);
              handlers.onPhase('closed');
              stopped = true;
              return;
            }
          }
        }
        // Reset to the FIRST NON-ZERO step, not to zero: a stream that carried frames and then ended
        // is a reconnect, and a zero-delay reconnect is the hot loop this comment exists to prevent.
        attempt = gotData ? 1 : attempt + 1;
        continue;
      } catch {
        if (stopped) return;
      }
      attempt += 1;
    }
  };

  void run();
  return stop;
}
