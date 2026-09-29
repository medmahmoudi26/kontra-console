/**
 * The Datasets SQL workbench's wire contract (kontra-console#4's follow-up slice).
 *
 * ── THE ROUTE ALREADY EXISTED ───────────────────────────────────────────────────────────────────
 *
 * kontra-console#4 said "**No SQL route exists.** `kontra dataset query` is the only SQL path and it
 * does not go through a `/api/…` endpoint the console could call." That is not true of this build:
 * `control/orchestrator/src/routes/query.ts` registers `POST /api/datasets/query`, and
 * `GET /api/datasets/schema` beside it for the column list. Both are live. The workbench was
 * missing, not the route.
 *
 * ── WHAT BOUNDS A QUERY IS THE ENGINE, NOT THIS FILE ────────────────────────────────────────────
 *
 * Worth knowing before anyone adds validation here: the orchestrator attaches the connection
 * READ_ONLY with LocalFileSystem disabled and the configuration locked, so no statement reaching it
 * can write to the lake, touch a local file, fetch an extension, or raise its own memory ceiling.
 * A SQL allowlist in the browser would be security theatre over a boundary that is already real —
 * and it would reject valid DuckDB the engine is happy to run.
 *
 * ── A BAD QUERY IS INPUT, NOT A FAULT ───────────────────────────────────────────────────────────
 *
 * The route answers 400 with the engine's own message so the editor can print it underneath. That
 * is the difference between "you have a typo on line 2" and "502 Bad Gateway", and it is why
 * {@link runQuery} separates a rejected query from an unreachable server.
 */

const BASE = '/api';

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  /** Positional, matching `columns`. A cell may be any JSON scalar, or null. */
  rows: unknown[][];
  /** What the engine measured, not what the browser timed — the network is not the query. */
  elapsedMs: number;
  /** The engine stopped at the limit. Drawn, never swallowed: a capped result that reads as
   *  complete is the silent-truncation shape this repo keeps finding. */
  truncated: boolean;
}

export type QueryRun =
  | { ok: true; result: QueryResult }
  /** The query was rejected — `detail` is the ENGINE's sentence, meant to be shown verbatim. */
  | { ok: false; rejected: true; detail: string }
  /** The server could not be reached or refused admission. A different failure, a different say. */
  | { ok: false; rejected: false; detail: string };

/** One dataset's columns, for the schema sidebar and for writing a query without guessing. */
export interface SchemaEntry {
  kind: 'output' | 'standalone';
  name: string;
  columns: QueryColumn[];
}

export async function fetchSchema(fetchImpl: typeof fetch = fetch): Promise<SchemaEntry[]> {
  const res = await fetchImpl(`${BASE}/datasets/schema`, { credentials: 'same-origin' });
  if (!res.ok) return [];
  // THE ENVELOPE IS `{datasets: […]}`, NOT A BARE ARRAY, and reading it wrong is exactly the bug
  // kontra-console#4 records: `Datasets.svelte` read `body.groups` off a bare array and rendered
  // empty on a 56-dataset catalog with no error. Narrow explicitly; never `?? []` past the shape.
  const body = (await res.json()) as { datasets?: SchemaEntry[] };
  return Array.isArray(body?.datasets) ? body.datasets : [];
}

export async function runQuery(
  sql: string,
  opts: { limit?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<QueryRun> {
  if (!sql.trim()) return { ok: false, rejected: true, detail: 'Write a query first.' };
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/datasets/query`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, limit: opts.limit ?? 200 }),
    });
  } catch (e) {
    return { ok: false, rejected: false, detail: String((e as Error)?.message ?? e) };
  }

  if (res.status === 400) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    return { ok: false, rejected: true, detail: (body as { error?: string }).error ?? 'rejected' };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    // 503 here is the surface saying it is switched OFF, and it names the variable that turns it
    // on. Passing that sentence through is the whole point — an operator can act on it.
    return {
      ok: false,
      rejected: false,
      detail: (body as { error?: string }).error ?? `${res.status} ${res.statusText}`,
    };
  }
  return { ok: true, result: (await res.json()) as QueryResult };
}

/** A starter query for a dataset, so the box is never an empty prompt. */
export function starterSql(dataset: string): string {
  return `SELECT *\nFROM ${dataset}\nLIMIT 100`;
}

/**
 * The query for ONE RUN's rows of a Dataset — what the run page's "query these rows" button means.
 *
 * A Dataset several runs append to holds everybody's rows, so `starterSql` reached from a run
 * answers with whichever run wrote last. That is a plausible wrong answer rather than an obvious
 * one, which is the worst kind: the columns are right, the run id column is even there, and
 * nothing on screen says the rows are not the ones you clicked through from.
 *
 * COMPOSED HERE AND NOWHERE ELSE. The button and the Datasets surface both need this string, and
 * the address between them carries a FLAG rather than the text (`address.ts`, `DatasetFocus.query`)
 * so there is one spelling of the query and a short URL instead of two spellings and a long one.
 */
export function runScopedSql(dataset: string, runId?: string): string {
  if (!runId) return starterSql(dataset);
  return `SELECT *\nFROM ${dataset}\nWHERE run_id = ${sqlText(runId)}\nLIMIT 100`;
}

/**
 * A SQL string literal.
 *
 * A run id is whatever `--id` was — the console never constrains it — so it is escaped rather than
 * interpolated. The query route is `READ_ONLY` hardened server-side, which makes this defence in
 * depth rather than the only defence, and that is the right order for both to exist in.
 */
function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * ONE CELL, AS TEXT — and the reason this is a function rather than `String(v)` at the call site.
 *
 * `String(v)` is correct for every scalar and catastrophic for everything else. DuckDB's composite
 * types arrive as JSON structures, so a `MAP(VARCHAR, VARCHAR)` column — every response header of
 * every crawled exchange — rendered as:
 *
 *     [object Object],[object Object],[object Object],[object Object]
 *
 * which is not a truncation or a styling problem: the row's entire content was destroyed on the way
 * to the screen, in the one column an operator opens `exchanges_<prog>` to read.
 *
 * A MAP ARRIVES AS `[{key, value}, …]`, which is worth special-casing rather than dumping as JSON:
 * `server=cloudflare` is what the reader came for and `{"key":"server","value":"cloudflare"}` makes
 * them parse punctuation to find it. Everything else composite falls through to compact JSON, which
 * is lossless and at least legible — a LIST of structs is rare enough that being merely correct is
 * the right trade against inventing a notation per shape.
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (isKeyValueList(v)) {
    return (v as Array<{ key: unknown; value: unknown }>)
      .map((e) => `${cellText(e.key)}=${cellText(e.value)}`)
      .join('  ');
  }
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    // A cycle cannot come off the wire, but a cell must never be the thing that throws.
    return String(v);
  }
}

function isKeyValueList(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (e) => typeof e === 'object' && e !== null && 'key' in (e as object) && 'value' in (e as object)
    )
  );
}

/**
 * ── THE STREAMING RUN (issue 03) ────────────────────────────────────────────────────────────────
 *
 * {@link runQuery} asks for a page and waits for the whole body. `POST /api/datasets/query/stream`
 * answers newline-delimited JSON with NO ROW CEILING, one frame per DuckDB chunk, so the table can
 * paint while the result is still arriving.
 *
 * WHAT THE MEASUREMENT ACTUALLY SAID, because the issue was drafted expecting Arrow. Arrow is not
 * smaller — 198 bytes/row of Arrow buffers against 180 of JSON — so payload size was never the
 * case for it. The case was TIME TO FIRST ROW, and that comes from framing rather than from the
 * encoding: measured on the live install, `injection_points_h1` arrives as 9,159 rows in 349 ms
 * across 5 frames, where the buffered route returned 5,000 rows and a `truncated` flag.
 *
 * So this reads NDJSON and not Arrow IPC, and the two things Arrow was wanted for are both here:
 * the result paints incrementally, and the COLUMN TYPES come off the wire from DuckDB rather than
 * being re-derived from values. The remaining reason to want Arrow — handing the buffers to a
 * zero-copy consumer — is not something a `<table>` does.
 *
 * ── THE ERROR FRAME IS WHY THE SHAPE IS WHAT IT IS ──────────────────────────────────────────────
 *
 * A read that fails after ten chunks has already sent a 200 and ten thousand rows, so it cannot
 * become a 400 — the status line is long gone. It arrives as `{"error"}` instead, and the caller
 * keeps what landed and says why it stopped. A malformed query still 400s before any frame, so
 * `rejected` keeps its old meaning.
 */
export interface QueryStreamSink {
  /** Exactly once, first. The schema — types from the engine, not inferred from values. */
  head: (columns: QueryColumn[]) => void;
  /** Zero or more, one per chunk. Positional rows, matching `columns`. */
  rows: (rows: unknown[][]) => void;
  /** Exactly once on success, last. */
  done: (summary: { rows: number; elapsedMs: number }) => void;
  /**
   * The run failed. `rejected` separates "fix your query" from "the server is gone", exactly as
   * {@link QueryRun} does — and `partial` says whether rows had already been handed over, because
   * a table that must keep what arrived renders differently from one that never started.
   */
  fail: (detail: string, opts: { rejected: boolean; partial: boolean }) => void;
}

export async function streamQuery(
  sql: string,
  sink: QueryStreamSink,
  opts: { offset?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!sql.trim()) {
    sink.fail('Write a query first.', { rejected: true, partial: false });
    return;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/datasets/query/stream`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, ...(opts.offset ? { offset: opts.offset } : {}) }),
    });
  } catch (e) {
    sink.fail(String((e as Error)?.message ?? e), { rejected: false, partial: false });
    return;
  }

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    sink.fail(body.error ?? `${res.status} ${res.statusText}`, {
      rejected: res.status === 400,
      partial: false,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let started = false;

  /** One frame. Unparseable lines are skipped rather than fatal — a truncated last line is what a
   *  connection dropped mid-write looks like, and the rows before it are still good. */
  const frame = (line: string): void => {
    if (line.trim() === '') return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (Array.isArray(obj.columns)) {
      started = true;
      sink.head(obj.columns as QueryColumn[]);
    } else if (Array.isArray(obj.rows)) {
      sink.rows(obj.rows as unknown[][]);
    } else if (obj.done && typeof obj.done === 'object') {
      sink.done(obj.done as { rows: number; elapsedMs: number });
    } else if (typeof obj.error === 'string') {
      sink.fail(obj.error, { rejected: false, partial: started });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SPLIT ON THE LAST COMPLETE LINE. A chunk boundary lands mid-object routinely, and parsing
      // the tail as if it were whole is how a streamed reader drops one row in every few thousand.
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        frame(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    frame(buffer);
  } catch (e) {
    sink.fail(String((e as Error)?.message ?? e), { rejected: false, partial: started });
  }
}
