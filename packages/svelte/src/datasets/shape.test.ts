import { describe, expect, it } from 'vitest';

import { groupDatasets } from '@kontra/console-core/datasets/grouped';
import { listingRows } from '@kontra/console-core/datasets/listing';
import type { DatasetInfo } from '@kontra/console-core/run/api';

/**
 * `/api/datasets` ANSWERS WITH A BARE ARRAY, and this pins that.
 *
 * The surface used to read `body.groups ?? []`. An array has no `groups`, so the fallback fired
 * on every load and the Datasets page rendered empty on an install holding 56 datasets — no
 * error, no empty-state explanation, just nothing. It is the second time this console has trusted
 * a shape off the wire and answered politely when it was wrong (the workspace picker read
 * `body.names.length` off `{}`), so the shape gets a test rather than a comment.
 */
const WIRE: DatasetInfo[] = [
  {
    kind: 'output', name: 'obs_paypal_v1', state: 'open', version: '1.0.0',
    dt: '2026-09-17T02-36-28', rows: 63, bytes: 107840, updatedAt: 1789612832389,
    contributingRuns: ['hunt-1789612588'], runId: 'hunt-1789612588', datasetName: 'obs_paypal_v1',
  } as DatasetInfo,
  {
    kind: 'standalone', name: 'scope_paypal', state: 'open', version: '', dt: '',
    rows: 31, bytes: 4096, updatedAt: 1789612000000, contributingRuns: [], runId: '',
    datasetName: 'scope_paypal',
  } as DatasetInfo,
];

describe('the datasets listing reads what the server actually sends', () => {
  it('turns the wire array into rows', () => {
    const rows = listingRows(groupDatasets(WIRE, Date.now()), {
      series: {}, columns: null, now: Date.now(),
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.name)).toContain('obs_paypal_v1');
  });

  it('the OLD spelling would have produced nothing — which is the bug', () => {
    const body = WIRE as unknown as { groups?: [] };
    expect(body.groups).toBeUndefined();
    expect(listingRows(body.groups ?? [], { series: {}, columns: null, now: Date.now() })).toEqual([]);
  });

  it('keeps two same-named datasets in different schemas apart', () => {
    const both: DatasetInfo[] = [
      { ...WIRE[0], kind: 'output', name: 'exchanges_8x8', datasetName: 'exchanges_8x8' } as DatasetInfo,
      { ...WIRE[1], kind: 'standalone', name: 'exchanges_8x8', datasetName: 'exchanges_8x8' } as DatasetInfo,
    ];
    expect(groupDatasets(both, Date.now())).toHaveLength(2);
  });
});
