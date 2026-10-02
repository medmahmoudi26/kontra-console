/**
 * Whether a table's stored column widths are complete enough to switch it to fixed layout.
 *
 * ── WHY THIS IS A MODULE AND NOT AN INLINE `$derived` ───────────────────────────────────────────
 *
 * It is the predicate that broke the dataset preview, and it is pure — so it is the one part of
 * that bug a unit test can actually hold. `jsdom` has no layout engine (every `clientHeight` is 0),
 * so a vitest suite cannot see a crushed column; it can see this boolean come out wrong, which is
 * what produced the crushed column.
 *
 * ── THE BUG IT ENCODES ──────────────────────────────────────────────────────────────────────────
 *
 * `DataTable` keys stored widths by column LABEL and the dataset preview uses ONE `resizeKey`
 * (`dataset-preview`) for every dataset. So a map saved while looking at a 7-column result is
 * loaded intact when a 20-column dataset is opened next.
 *
 * The old test was `Object.keys(widths).length > 0`. That is true for the 7-column map, so the
 * 20-column table switched to `table-layout: fixed` with fourteen columns having no width at all —
 * and under fixed layout a column with no width gets whatever is left after the sized ones take
 * theirs. Measured on `http_events_shutterfly` (20 columns) against a 6-entry map: every column
 * came out 88px wide, the headers unreadable.
 *
 * Requiring EVERY column to carry a width means a map that does not describe this table is ignored
 * and auto layout — which sizes to content — stays in charge. The map is never deleted, so the
 * other dataset still finds its widths when you go back.
 */

/** Narrowest a column may be dragged, and the floor a stored width must clear to count. */
export const MIN_COL = 56;

/**
 * True when every column has a usable stored width.
 *
 * A table with no columns is NOT sized: `[].every(...)` is `true`, which would hand fixed layout to
 * a table that has nothing to lay out.
 */
export function allColumnsSized(
  columns: readonly { label: string }[],
  widths: Readonly<Record<string, number>>
): boolean {
  if (columns.length === 0) return false;
  return columns.every((c) => (widths[c.label] ?? 0) >= MIN_COL);
}
