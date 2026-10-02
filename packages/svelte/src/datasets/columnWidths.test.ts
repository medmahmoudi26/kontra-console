/**
 * The predicate that decides whether a table may switch to `table-layout: fixed`.
 *
 * Every case here is one a real dataset preview produced: the preview shares a single
 * `resizeKey` across every dataset, so the stored map routinely describes a DIFFERENT set of
 * columns than the table being rendered.
 */

import { describe, expect, it } from 'vitest';

import { MIN_COL, allColumnsSized } from './columnWidths';

const cols = (...labels: string[]) => labels.map((label) => ({ label }));

describe('deciding whether a table is fully sized', () => {
  it('is sized when every column carries a width', () => {
    expect(allColumnsSized(cols('host', 'status'), { host: 200, status: 90 })).toBe(true);
  });

  /**
   * THE ONE THAT CRUSHED THE DATASET PREVIEW. A map saved on a 6-column result, loaded against a
   * 20-column dataset, used to pass — and fixed layout then gave the fourteen unlisted columns
   * whatever was left, which was a sliver each.
   */
  it('is NOT sized when the stored map covers only some of the columns', () => {
    const stored = { url: 320, version: 90, dt: 190 };
    expect(allColumnsSized(cols('body_bytes', 'headers', 'url', 'version', 'dt'), stored)).toBe(
      false
    );
  });

  /** A map from an entirely different table must not count for even one column. */
  it('is NOT sized when no stored label matches', () => {
    expect(allColumnsSized(cols('body_bytes', 'headers'), { url: 320, dt: 190 })).toBe(false);
  });

  it('is NOT sized when nothing is stored', () => {
    expect(allColumnsSized(cols('host', 'status'), {})).toBe(false);
  });

  /**
   * `[].every(...)` is `true`, which would hand fixed layout to a table with no columns to lay
   * out. The guard is explicit rather than incidental.
   */
  it('is NOT sized when there are no columns', () => {
    expect(allColumnsSized([], { host: 200 })).toBe(false);
  });

  /** A width below the drag floor is not a width — it is a value that would render unreadable. */
  it('rejects a width under the minimum', () => {
    expect(allColumnsSized(cols('host'), { host: MIN_COL - 1 })).toBe(false);
    expect(allColumnsSized(cols('host'), { host: MIN_COL })).toBe(true);
  });

  /** A label the map holds but the table does not render is irrelevant, not disqualifying. */
  it('ignores stored labels this table does not use', () => {
    expect(allColumnsSized(cols('host'), { host: 200, gone: 400 })).toBe(true);
  });
});
