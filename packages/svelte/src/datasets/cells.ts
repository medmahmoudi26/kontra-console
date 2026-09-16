/**
 * The grid's cell renderers, as plain DOM.
 *
 * ── WHY NOT SVELTE COMPONENTS ───────────────────────────────────────────────────────────────────
 *
 * ag-grid's vanilla API asks a renderer for an `HTMLElement`, and mounting a component per cell
 * means a component instance per visible row per column — hundreds, recreated on every scroll, for
 * cells that are a span and a class. The React console did that and `DatasetPage.tsx` is 1,978 lines
 * with an 11-renderer tail.
 *
 * These are functions from a row to an element. Each one is three lines because the DECISIONS —
 * what a state badge says, when a dataset expires, how a dispatch count reads — already live in
 * `@kontra/console-core` and are shared with the React console for as long as it exists.
 *
 * ── EVERY RENDERER TAKES `unknown` AND NARROWS ──────────────────────────────────────────────────
 *
 * ag-grid hands a renderer whatever is in the row. Typing the parameter as the row shape would be a
 * lie the compiler cannot check, and a cell that throws takes the grid's render loop with it.
 */
import { accrualWords, accrualPhase } from '@kontra/console-core/datasets/accrual';
import { datasetBadge } from '@kontra/console-core/datasets/state';
import { untilText } from '@kontra/console-core/datasets/expiry';
import { dispatchCell, type DatasetListingRow } from '@kontra/console-core/datasets/listing';

type Row = Partial<DatasetListingRow>;

function el(tag: string, cls: string, text: string, title?: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  if (title) n.title = title;
  return n;
}

/** The dataset's name, with a marker when the displayed name is not the stored one. */
export function nameCell(row: Row): HTMLElement {
  const wrap = el('span', 'cell-name', '');
  wrap.append(el('span', 'mono', row.nameLocal || row.name || row.dataset || ''));
  // RENAMED IS A FACT ABOUT THE ROW, not decoration: the name on screen is an override and the
  // stored one is what a query must use. Hiding that makes a copied name fail somewhere else.
  if (row.renamed) wrap.append(el('span', 'tag', 'renamed', `stored as ${row.dataset ?? ''}`));
  if (row.temporary) wrap.append(el('span', 'tag warn', 'temp', 'dropped when its run ends'));
  return wrap;
}

/** open / sealed / abandoned, with the sentence core attaches to each. */
export function stateCell(row: Row): HTMLElement {
  const badge = datasetBadge(row.state ?? 'open');
  return el('span', `badge ${row.state ?? 'open'}`, badge.label, badge.title);
}

/** Rows, and whether they are still arriving. */
export function rowsCell(row: Row): HTMLElement {
  const phase = accrualPhase({ state: row.state ?? 'open', runId: row.runId });
  const words = accrualWords(phase);
  const n = (row.rows ?? 0).toLocaleString();
  return el('span', `cell-rows ${phase}`, n, words.title);
}

/** How long until retention takes it. */
export function expiryCell(row: Row & { expiresAt?: number }, now: number): HTMLElement {
  if (!row.expiresAt) return el('span', 'dim', '—', 'kept until something says otherwise');
  const ms = row.expiresAt - now;
  return el('span', ms < 0 ? 'cell-expiry gone' : 'cell-expiry', untilText(ms));
}

/** The run that produced it — blank for a standalone dataset, which is a real answer. */
export function runCell(row: Row): HTMLElement {
  if (!row.runId) return el('span', 'dim', 'loaded', 'a standalone dataset, not a run output');
  return el('span', 'mono cell-run', row.runId);
}

/** Dispatches, formatted by core so the grid and the CLI agree. */
export function dispatchesCell(row: Row): HTMLElement {
  return el('span', 'mono', dispatchCell({ dt: row.dt ?? '', dispatches: row.dispatches ?? 0, kind: row.kind ?? 'output' }));
}

/** Bytes, at the scale a person reads. */
export function bytesCell(row: Row): HTMLElement {
  const b = row.bytes ?? 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return el('span', 'mono', `${i === 0 ? v : v.toFixed(1)} ${units[i]}`, `${b.toLocaleString()} bytes`);
}
