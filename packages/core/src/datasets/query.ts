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
