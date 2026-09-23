/**
 * A Run's RECORD: what it was started with, what it returned, and what it wrote.
 *
 * ── WHY THIS IS NOT PART OF `fetchRun` ─────────────────────────────────────────────────────────
 *
 * `GET /api/runs/:runId` is the two-authority STATUS read (ADR 0017) — Temporal for execution,
 * the ledger for materialization. It is what the run list polls, and it must stay cheap. These
 * two reads are neither cheap nor status: one decodes payloads, the other joins the lake's
 * catalog metadata. They are issued once, when a run is OPENED.
 *
 * ── AND WHY THE RUN PAGE COULD NOT BE WRITTEN WITHOUT THEM ─────────────────────────────────────
 *
 * The page used to draw the workflow's declared SCHEMA and call it the run: the Input region
 * printed each field's DEFAULT, the Output region printed field names with no values, and the
 * Dataset region printed "This run recorded no output Dataset" — because it was reading
 * `materializationRecords`, which is EMPTY for every v2 Run (`publishBatch` writes lake rows and
 * no ledger record). Measured on a live install: `/api/runs/canary-…` answered
 * `materializationRecords: []` while `/api/datasets` listed `canary_signals` with that run's id
 * and ten rows.
 *
 * So two runs of one workflow rendered identically and neither showed its own output. Three
 * regions, three placeholders. These are the two routes that make it a record.
 */
import { BASE } from './api';

/** What the workflow was called with and what it gave back — `GET /api/runs/:runId/io`. */
export interface RunIO {
  /**
   * The single `@workflow.run` argument, decoded.
   *
   * ABSENT IS NOT EMPTY. `undefined` means the payload could not be read — Temporal dropped the
   * execution at retention, or a claim-check blob has expired — where `{}` means the run really
   * was started with no arguments, which is what pressing Run on a form of optionals produces.
   */
  input?: unknown;
  /** The return value. Absent while the run is still going: there is no close event yet. */
  output?: unknown;
  /** Why there is no output — `failed`, `canceled`, `terminated`, `timed out`. */
  closedAs?: string;
}

/**
 * One Dataset partition this Run wrote — `GET /api/runs/:runId/datasets`.
 *
 * The server's row verbatim, not the Datasets page's flattened listing row: this surface needs the
 * four fields that ADDRESS a partition (`name`, `kind`, `version`, `dt`) so the preview it fetches
 * is THIS run's rows and not the newest run's under the same name.
 */
export interface RunDataset {
  name: string;
  kind: string;
  version?: string;
  dt?: string;
  rows: number;
  bytes: number;
  state?: string;
  /** The ADR 0029 §2 run-grain name, or the operator's rename when the record holds one. */
  datasetName?: string;
  renamedTo?: string;
  /** Every Run whose rows are in this partition. More than one means it is shared. */
  contributingRuns?: string[];
}

/** What a reader should see as the Dataset's name: the rename, then the derived name, then the
 *  storage name. Never a hash, and never blank. */
export function datasetLabel(d: RunDataset): string {
  return d.renamedTo || d.datasetName || d.name;
}

/**
 * The MATERIALIZATION word a run page shows, from the LAKE rather than the ledger.
 *
 * `materializationOf` (`runState.ts`) reads the ADR 0017 ledger and answers `unrecorded` for every
 * v2 Run, because the SDK publish path writes lake rows and no ledger record. On the run LIST that
 * has to stand — resolving it there would cost a catalog join on every poll. On the run PAGE the
 * join has already been paid for the Dataset region, so the page can say the true thing.
 *
 * `undefined` means DO NOT OVERRIDE: the lake was not read, or it agrees there is nothing, and in
 * both cases the ledger's own word (`unknown` / `unrecorded`) is still the best answer available.
 */
export function lakeMaterialization(
  datasets: readonly RunDataset[]
): { label: string; title: string } | undefined {
  if (datasets.length === 0) return undefined;
  const rows = datasets.reduce((n, d) => n + (d.rows || 0), 0);
  const n = datasets.length;
  return {
    label: 'materialized',
    title:
      `materialization — the lake holds ${rows.toLocaleString()} row(s) across ` +
      `${n} Dataset${n === 1 ? '' : 's'} stamped with this run's id. Read from the catalog's own ` +
      `per-file run_id statistics, not from the ledger.`,
  };
}

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * The run's two payloads. `undefined` for a 404, which is ORDINARY: Temporal drops an execution
 * long before the Dataset it wrote expires, so a run page for an old run still has a Dataset and a
 * log to show and must not render an error over them.
 */
export async function fetchRunIO(runId: string): Promise<RunIO | undefined> {
  const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/io`, {
    credentials: 'same-origin',
  });
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as RunIO;
}

/** Every Dataset partition the lake attributes to this Run, newest first as the server ordered it. */
export async function fetchRunDatasets(runId: string): Promise<RunDataset[]> {
  const body = await readJson(`${BASE}/runs/${encodeURIComponent(runId)}/datasets`);
  // A SHAPE GUARD, for `preview.ts`'s reason: the listing surface once read `body.groups` off a
  // bare array and rendered empty on a 56-dataset catalog, with no error to debug.
  return Array.isArray(body) ? (body as RunDataset[]) : [];
}

/**
 * A decoded payload as the `name → value` pairs a record draws.
 *
 * SCALARS STAY SCALARS AND EVERYTHING ELSE BECOMES JSON. A list or a nested object rendered with
 * `String(v)` is `[object Object]`, which is the single most common way a value region says
 * nothing while looking like it said something.
 */
export function pairsOf(value: unknown): { name: string; value: string }[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([name, v]) => ({
    name,
    value: cellOf(v),
  }));
}

/** One value as the string a cell holds. `null` is a WORD, because a null and a blank are
 *  different facts and a reader must be able to tell. */
export function cellOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
