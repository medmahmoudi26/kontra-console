/**
 * A Dataset's stable identity.
 *
 * ── WHY IT IS ITS OWN MODULE ────────────────────────────────────────────────────────────────────
 *
 * It lived in `state/store.ts`, which was the React console's zustand store. Three live modules —
 * the listing, the grid's column definitions and the run stats — needed this one function, and a
 * grid's columns must not drag a state library in behind them. The store went with React; the
 * identity is a property of a Dataset and stays.
 *
 * THE TRIPLE IS WHAT ADDRESSES IT in the catalog, and the `kind` is part of it: a standalone
 * Dataset and a run's output can share a name and are not the same thing.
 */
import type { DatasetInfo } from '../run/api';

export function datasetKey(d: Pick<DatasetInfo, 'kind' | 'name' | 'version' | 'dt'>): string {
  return `${d.kind}:${d.name}:${d.version ?? ''}:${d.dt ?? ''}`;
}

/** The two palettes the console flips between. */
export type Theme = 'light' | 'dark';
