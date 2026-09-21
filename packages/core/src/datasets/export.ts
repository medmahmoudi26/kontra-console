/**
 * Take what is on screen away with you — CSV, TSV, JSON, JSONL.
 *
 * ── WHY THIS IS CLIENT-SIDE ─────────────────────────────────────────────────────────────────────
 *
 * There is no export route, and adding one would mean a second path that reads the lake — with its
 * own auth, its own bounds, and its own opinion about how much a caller may pull. The workbench
 * already has the rows: they came back from `POST /api/datasets/query`, which is attached READ_ONLY
 * with a memory ceiling and a row cap. Formatting bytes a caller already holds adds no surface and
 * cannot widen what they are allowed to read.
 *
 * WHAT THIS MEANS FOR SIZE, SAID PLAINLY: an export is the QUERY's result, so it inherits the
 * query's `limit`. {@link exportName} stamps `-capped` into the filename when the engine truncated,
 * because a file called `observations.csv` that silently holds the first 200 of 12,330 rows is the
 * silent-truncation failure this codebase keeps finding, now saved to disk where it outlives the
 * banner that warned about it.
 *
 * NO PARQUET. It is the obvious fourth format and it is deliberately absent: writing real Parquet
 * needs an encoder in the bundle, and a fake one — CSV with a `.parquet` name — is worse than not
 * offering it. That belongs on the server, next to the engine that already writes Parquet.
 */

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'jsonl';

export interface ExportInput {
  columns: readonly { name: string; type?: string }[];
  rows: readonly unknown[][];
}

/** `text/csv`, etc. — what the blob is labelled as, which decides how a browser treats it. */
export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8',
  jsonl: 'application/x-ndjson;charset=utf-8',
};

/**
 * One cell, as a delimited field.
 *
 * RFC 4180 QUOTING, AND THE LEADING-CHARACTER GUARD IS NOT PARANOIA. A cell beginning `=`, `+`, `-`
 * or `@` is executed as a formula when the file is opened in Excel or Sheets — and this data comes
 * from HTTP responses on hosts we do not control, so it is exactly the kind of text an attacker
 * chooses. Prefixing a tab neutralises it without changing what the value reads as.
 */
function field(v: unknown, delim: string): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`;
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

function delimited(input: ExportInput, delim: string): string {
  const head = input.columns.map((c) => field(c.name, delim)).join(delim);
  const body = input.rows.map((r) => r.map((v) => field(v, delim)).join(delim));
  // CRLF because RFC 4180 says so and because Excel on Windows still cares.
  return [head, ...body].join('\r\n') + '\r\n';
}

/** Rows as objects, keyed by column name — the shape a reader expects from JSON. */
function objects(input: ExportInput): Record<string, unknown>[] {
  return input.rows.map((r) => {
    const o: Record<string, unknown> = {};
    input.columns.forEach((c, i) => {
      o[c.name] = r[i] ?? null;
    });
    return o;
  });
}

export function serialize(input: ExportInput, format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return delimited(input, ',');
    case 'tsv':
      return delimited(input, '\t');
    case 'json':
      return JSON.stringify(objects(input), null, 2) + '\n';
    case 'jsonl':
      return objects(input)
        .map((o) => JSON.stringify(o))
        .join('\n') + '\n';
  }
}

/**
 * `observations-2026-09-18.csv`, or `observations-2026-09-18-capped.csv` when the engine stopped at
 * the limit. See the header: the warning has to survive onto the filesystem.
 */
export function exportName(dataset: string, format: ExportFormat, opts: { truncated?: boolean; now?: Date } = {}): string {
  const d = opts.now ?? new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // COLLAPSE RUNS OF DOTS AND DASHES, do not merely substitute. Replacing `/` alone turns
  // `../../etc/passwd` into `..-..-etc-passwd`, which still carries the traversal in readable form
  // and looks deliberate in a bug report. Collapsing `[-.]+` to one `-` and trimming leaves
  // `etc-passwd`: a name, with nothing left to interpret.
  const safe =
    (dataset || 'dataset')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/[-.]{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'dataset';
  return `${safe}-${day}${opts.truncated ? '-capped' : ''}.${format}`;
}

/**
 * Hand the bytes to the browser.
 *
 * Injected `doc` so this is testable without a DOM: the suite asserts the filename and the blob's
 * type, which is the part with rules, rather than whether a browser downloads things.
 */
export function download(
  input: ExportInput,
  format: ExportFormat,
  dataset: string,
  opts: { truncated?: boolean; doc?: Document; now?: Date } = {}
): string {
  const name = exportName(dataset, format, { truncated: opts.truncated, now: opts.now });
  const doc = opts.doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) return name;
  const blob = new Blob([serialize(input, format)], { type: MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next turn: revoking synchronously races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}
