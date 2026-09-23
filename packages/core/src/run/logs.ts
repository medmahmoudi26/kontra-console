/**
 * The log records the run page's side rail reads (ADR 0050 §1; kontra-console#6, kontra#17).
 *
 * ── OWN THE CONTRACT, STUB THE TRANSPORT ────────────────────────────────────────────────────────
 *
 * `GET /api/logs/tail` and `/api/logs/query` are built in kontra#17. This file does not wait for
 * them: it fixes the SHAPE now and reads a fixture, so landing the route is a change to `fetchLogs`
 * and to nothing else. The alternative — waiting — is how a surface and the route it needs end up
 * designed against different assumptions by two people who never spoke.
 *
 * ── `incomplete` IS THE FIELD THE WHOLE SLICE TURNS ON ──────────────────────────────────────────
 *
 * ADR 0050 §2 removes `speak` on the argument that a completeness claim is more useful as a
 * queryable log record than as narration — **provided it does not get lost**. About a third of the
 * 37 `speak` call sites are claims that the RESULT is not what a reader would assume:
 *
 *     splitting axis ABANDONED … everything past this point in url order is UNSCANNED, not clean
 *     seed_limit 200 reached — the crawl is PARTIAL by request
 *     exchanges_8x8 is still open — this reads a partial crawl as whole
 *
 * A record carrying `incomplete: true` is one of those. It is a SEPARATE FIELD and not a log level
 * because the two say different things: `warn` is "this looks wrong", `incomplete` is "the answer
 * you are about to act on is smaller than it appears". A reader filtering to `error` must still be
 * able to find every incomplete result, which is why the rail filters on it independently.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  /** Epoch ms. */
  ts: number;
  level: Level;
  msg: string;
  runId: string;
  /** The Machine, e.g. `kf-desync-01`. Absent for a line from the control plane. */
  machine?: string;
  /** The systemd unit, e.g. `kontra-actor-desync`. */
  unit?: string;
  actor?: string;
  /** ADR 0050 §2 — the result is not what a reader would assume. See the module note. */
  incomplete?: boolean;
  fields?: Record<string, unknown>;
}

/** Ordered weakest-first, so a minimum-level filter is an index comparison. */
export const LEVELS: readonly Level[] = ['debug', 'info', 'warn', 'error'] as const;

/** Is `level` at or above `floor`? */
export function atLeast(level: Level, floor: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(floor);
}

/**
 * The rail's filter, in one place because it is asserted in tests and applied in the component.
 *
 * THE `incomplete` TOGGLE IGNORES THE LEVEL FLOOR, deliberately. It answers "show me every claim
 * that the result is partial", and a completeness claim emitted at INFO must not be hidden by a
 * reader who raised the floor to `warn` — that is precisely the demotion ADR 0050 §2 warns the
 * migration away from `speak` could cause.
 *
 * GENERIC IN THE RECORD, so a caller that carries more than a `LogRecord` gets it back. The live
 * stream's lines carry a `seq` that is their render key (`logstream.ts`), and a filter typed to
 * return the base shape would have widened them back — leaving the one field a keyed list cannot
 * do without to be re-attached by a cast at the call site.
 */
export function filterLogs<T extends LogRecord>(
  records: readonly T[],
  opts: { text?: string; floor?: Level; onlyIncomplete?: boolean }
): T[] {
  const needle = (opts.text ?? '').trim().toLowerCase();
  const floor = opts.floor ?? 'info';
  return records.filter((r) => {
    if (opts.onlyIncomplete) {
      if (!r.incomplete) return false;
    } else if (!atLeast(r.level, floor)) {
      return false;
    }
    if (!needle) return true;
    return (
      r.msg.toLowerCase().includes(needle) ||
      (r.unit ?? '').toLowerCase().includes(needle) ||
      (r.machine ?? '').toLowerCase().includes(needle) ||
      (r.actor ?? '').toLowerCase().includes(needle)
    );
  });
}

/** How many of these records are completeness claims — the count the `incomplete N` toggle shows. */
export function incompleteCount(records: readonly LogRecord[]): number {
  return records.reduce((n, r) => n + (r.incomplete ? 1 : 0), 0);
}

/** Newest first, which is how the rail reads. Stable for equal timestamps. */
export function newestFirst(records: readonly LogRecord[]): LogRecord[] {
  return [...records].sort((a, b) => b.ts - a.ts);
}

/**
 * One `/api/logs/query` response line → a record.
 *
 * VictoriaLogs answers line-delimited JSON with `_time` and `_msg` plus whatever stream fields were
 * stamped. Levels arrive as a field rather than as structure, and ANYTHING UNRECOGNISED BECOMES
 * `info` rather than being dropped: a line whose level nobody set is still a line somebody wrote,
 * and silently discarding it is the failure mode this rail exists to replace.
 */
export function parseRecord(line: Record<string, unknown>, runId: string): LogRecord {
  const raw = String(line.level ?? line.LEVEL ?? 'info').toLowerCase();
  const level = (LEVELS as readonly string[]).includes(raw) ? (raw as Level) : 'info';
  const t = line._time ?? line.ts;
  // THE EMITTER'S OWN STREAM FIELDS — WHICH RECORD a line is about (kontra-console#6). A dropped or
  // errored unit is only debuggable if the reader sees both the full message AND the record it
  // happened on; a workflow that logs a drop stamps `host`/`endpoint`/`point`/`record`… as ordinary
  // stream fields, and VictoriaLogs carries them verbatim beside `_time`/`_msg`. Everything that is
  // neither structural (parsed above) nor a VL internal (`_`-prefixed) IS the record, so it is
  // collected here and the rail renders it under the message. Dropped before: `fields` was in the
  // type and nothing filled it, so "which record" was unanswerable from a line.
  // STRUCTURAL: parsed above. AMBIENT: on every line and NOT the record — the Temporal/runtime
  // envelope (`node_id`, `actor_id`, `logger`, `task_queue`…). Skipping both leaves `fields` holding
  // only what the emitter stamped with `extra={...}` (say.py) — the host/endpoint/point/record it is
  // ABOUT, plus `error` (the full exception, JsonFormatter puts exc_info there). That is the record.
  const SKIP = new Set([
    'level', 'LEVEL', 'ts', 'msg', 'run_id', 'machine', 'unit', 'actor', 'incomplete',
    'node_id', 'actor_id', 'actor_version', 'logger', 'task_queue', 'namespace',
    'workflow_id', 'workflow_type', 'attempt',
  ]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) {
    if (SKIP.has(k) || k.startsWith('_')) continue;
    fields[k] = v;
  }
  return {
    ts: typeof t === 'number' ? t : Date.parse(String(t ?? '')) || 0,
    level,
    msg: String(line._msg ?? line.msg ?? ''),
    runId: String(line.run_id ?? runId),
    ...(line.machine ? { machine: String(line.machine) } : {}),
    ...(line._stream_unit || line.unit ? { unit: String(line._stream_unit ?? line.unit) } : {}),
    ...(line.actor ? { actor: String(line.actor) } : {}),
    // The string "true" as well as the boolean: it arrives as a stream field, and stream fields are
    // strings on the wire.
    ...(line.incomplete === true || line.incomplete === 'true' ? { incomplete: true } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

/**
 * Read a Run's logs.
 *
 * THE ONE LINE kontra#17 CHANGES. Today it answers from the fixture below so the rail can be built,
 * reviewed and screenshotted against real density; when the route lands this becomes a fetch of
 * `/api/logs/query?query=run_id:"<id>"` and nothing above it moves.
 */
export async function fetchLogs(
  runId: string,
  fetchImpl: typeof fetch = fetch
): Promise<LogRecord[]> {
  try {
    const res = await fetchImpl(
      `/api/logs/query?query=${encodeURIComponent(`run_id:${JSON.stringify(runId)}`)}&limit=500`
    );
    // EMPTY, NEVER INVENTED. All three of these returned `fixtureLogs(runId)` — a route failure, a
    // parse that yielded nothing, and a throw — so a Run whose logs were unreachable rendered a
    // plausible, detailed, ENTIRELY FICTIONAL rail: `upstream reset after 8 exchanges; abandoning
    // axis`, attributed to a run id that does not exist in Temporal.
    //
    // It cost real diagnostic time twice in one session. An operator cannot tell invented lines
    // from recorded ones, and the fiction is convincing precisely because it was written from real
    // output. A blank rail says "nothing here"; a fabricated one says something false about
    // production, which is the failure this whole rail was built to replace.
    //
    // `fixtureLogs` stays exported — it is the density the design was reviewed against, and the
    // suites use it. What it must never be is a FALLBACK.
    if (!res.ok) return [];
    const text = await res.text();
    const out: LogRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(parseRecord(JSON.parse(line) as Record<string, unknown>, runId));
      } catch {
        /* a malformed line is not a reason to lose the rest */
      }
    }
    return newestFirst(out);
  } catch {
    return [];
  }
}

/**
 * REAL LINES, off `kf-desync-01` and `kf-webcrawl-01` during the 2026-09-17 campaign.
 *
 * Invented sample data would have made the rail look calm. The density here is the density to design
 * against — and the point of the design is that the `splitting axis ABANDONED` line stays findable
 * with the floor dropped to `debug`, among exactly this much progress noise. If it does not, the
 * design has re-created the thing it replaced.
 */
export function fixtureLogs(runId: string, now = 1789660000000): LogRecord[] {
  const at = (secondsAgo: number): number => now - secondsAgo * 1000;
  const d = (ts: number, level: Level, msg: string, extra: Partial<LogRecord> = {}): LogRecord => ({
    ts,
    level,
    msg,
    runId,
    machine: 'kf-desync-01',
    unit: 'kontra-actor-desync',
    actor: 'desync',
    ...extra,
  });
  return newestFirst([
    d(at(612), 'info', 'actor host up — desync@1.0.0, 8 sessions, queue kontra-desync-1-0-0'),
    d(at(604), 'info', 'opened session 4f2a on kf-desync-01'),
    d(at(590), 'debug', 'probe 8x8: frame CL.TE, 200 OK, 41ms'),
    d(at(588), 'debug', 'probe 8x8: frame TE.CL, 200 OK, 38ms'),
    d(at(585), 'debug', 'probe 8x8: frame TE.TE, 400 Bad Request, 44ms'),
    d(at(561), 'info', 'batch 1/12 — 200 units resolved from ref sha256:9b1c…'),
    d(at(540), 'debug', 'probe 8x8: frame CL.CL, 200 OK, 39ms'),
    d(at(533), 'warn', 'exchanges_8x8 is still open — this reads a partial crawl as whole', {
      incomplete: true,
      fields: { axis: 'exchanges_8x8', phase: 'read' },
    }),
    d(at(500), 'info', 'batch 4/12 — 200 units resolved'),
    d(at(487), 'debug', 'probe 8x8: frame CL.TE, connection reset, retry 1/3'),
    d(at(455), 'error', 'upstream reset after 8 exchanges; abandoning axis', {
      fields: { axis: 'url-order', attempts: 3 },
    }),
    d(at(454), 'warn', 'splitting axis ABANDONED — everything past this point in url order is UNSCANNED, not clean', {
      incomplete: true,
      fields: { axis: 'url-order', scanned: 4118, total: 19004 },
    }),
    d(at(430), 'info', 'batch 7/12 — 200 units resolved'),
    d(at(399), 'debug', 'probe 8x8: frame TE.CL, 200 OK, 51ms'),
    d(at(361), 'warn', 'seed_limit 200 reached — the crawl is PARTIAL by request', {
      machine: 'kf-webcrawl-01',
      unit: 'kontra-actor-webcrawl',
      actor: 'webcrawl',
      incomplete: true,
      fields: { seed_limit: 200 },
    }),
    d(at(340), 'info', 'batch 10/12 — 200 units resolved'),
    d(at(300), 'debug', 'heartbeat: 12 in flight, 0 queued'),
    d(at(266), 'warn', 'crawl batch voided: that scope page has no surface', {
      machine: 'kf-webcrawl-01',
      unit: 'kontra-actor-webcrawl',
      actor: 'webcrawl',
      incomplete: true,
    }),
    d(at(240), 'info', 'batch 12/12 — 147 units resolved (short batch, end of dataset)'),
    d(at(180), 'debug', 'session 4f2a closing, 1,204 exchanges'),
    d(at(120), 'error', 'handler: Nexus operation timed out after 600s', {
      fields: { op: 'run', timeout_s: 600 },
    }),
    d(at(96), 'warn', 'screen skipped — the framing axis is not being re-run', { incomplete: true }),
    d(at(30), 'info', 'published 1,043 verdicts into lame'),
  ]);
}
