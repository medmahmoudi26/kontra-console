/**
 * Look inside one Dataset.
 *
 * ── THE SHAPE IS GUARDED, DELIBERATELY ──────────────────────────────────────────────────────────
 *
 * The listing surface read `body.groups` from a response that is a bare array, so it rendered
 * empty on a 56-dataset catalog — no error, nothing to debug, because `?? []` had a polite answer
 * for the wrong shape. This module refuses instead: a response that is not `{columns, rows}` is an
 * error with a sentence, not an empty table.
 *
 * ── ROWS ARE POSITIONAL ─────────────────────────────────────────────────────────────────────────
 *
 * `/api/datasets/:name/preview` answers `{columns: [{name, type}], rows: [[…], […]]}` — each row is
 * an ARRAY aligned to `columns`, not an object. That is worth stating because a 31-column
 * observation row as an object would repeat every key per row, and because a renderer that assumed
 * objects would silently draw nothing.
 */
import { BASE } from '../run/api';

export interface PreviewColumn {
  name: string;
  type: string;
}

export interface DatasetPreview {
  columns: PreviewColumn[];
  /** One entry per column, in `columns` order. `null` is a real value, not a missing one. */
  rows: unknown[][];
  /** True when the server capped the sample — so "12 rows" is not "this dataset has 12 rows". */
  truncated: boolean;
}

/** Narrow an unknown body into a preview, or say why it is not one. */
export function readPreview(body: unknown): DatasetPreview {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('the preview did not answer with an object');
  }
  const b = body as { columns?: unknown; rows?: unknown; truncated?: unknown };
  if (!Array.isArray(b.columns) || !Array.isArray(b.rows)) {
    throw new Error('the preview answered without columns and rows');
  }
  const columns: PreviewColumn[] = b.columns.map((c) => {
    const col = (c ?? {}) as { name?: unknown; type?: unknown };
    return { name: String(col.name ?? ''), type: String(col.type ?? '') };
  });
  // A row that is not an array is dropped rather than rendered as one cell of junk — but the drop
  // is not silent: `truncated` already tells a reader the sample is partial, and a malformed row
  // would otherwise shift every column after it.
  const rows = b.rows.filter((r): r is unknown[] => Array.isArray(r));
  return { columns, rows, truncated: Boolean(b.truncated) || rows.length !== b.rows.length };
}

export interface PreviewQuery {
  /** The STORAGE name — what `SELECT * FROM <it>` names. */
  dataset: string;
  kind?: string;
  version?: string;
  dt?: string;
  limit?: number;
}

/** The URL a preview is read from. Exported so a test can assert it without a network. */
export function previewUrl(q: PreviewQuery): string {
  const p = new URLSearchParams();
  if (q.kind) p.set('kind', q.kind);
  if (q.version) p.set('version', q.version);
  if (q.dt) p.set('dt', q.dt);
  p.set('limit', String(q.limit && q.limit > 0 ? q.limit : 50));
  return `${BASE}/datasets/${encodeURIComponent(q.dataset)}/preview?${p.toString()}`;
}

export async function fetchPreview(
  q: PreviewQuery,
  fetchImpl: typeof fetch = fetch
): Promise<DatasetPreview> {
  const res = await fetchImpl(previewUrl(q), { credentials: 'same-origin' });
  if (!res.ok) {
    // The server's own sentence where it has one — a 404 for a Dataset that is not there reads
    // differently from a 502 for a lake that would not open, and a reader needs to tell them apart.
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error ?? `could not preview this dataset: HTTP ${res.status}`);
  }
  return readPreview(await res.json());
}
