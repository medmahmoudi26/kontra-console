import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cellOf,
  datasetLabel,
  fetchRunDatasets,
  fetchRunIO,
  lakeMaterialization,
  pairsOf,
} from './record';

function answer(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRunIO', () => {
  it('returns the run\'s own argument and result', async () => {
    vi.stubGlobal(
      'fetch',
      answer({ input: { steps: 5, targets: ['alpha'] }, output: { records: 10, complete: true } })
    );
    await expect(fetchRunIO('canary-1')).resolves.toEqual({
      input: { steps: 5, targets: ['alpha'] },
      output: { records: 10, complete: true },
    });
  });

  it('answers undefined for a 404, because retention is not an error', async () => {
    // Temporal drops an execution long before the Dataset it wrote expires. The page still has a
    // Dataset and a log to draw, and must not put a red box over them.
    vi.stubGlobal('fetch', answer({ error: 'no such execution' }, 404));
    await expect(fetchRunIO('gone-1')).resolves.toBeUndefined();
  });

  it('throws the server\'s own sentence on any other failure', async () => {
    vi.stubGlobal('fetch', answer({ error: 'could not read the run\'s input: broken' }, 502));
    await expect(fetchRunIO('x')).rejects.toThrow('could not read the run\'s input: broken');
  });

  it('encodes a run id containing a slash', async () => {
    const f = answer({});
    vi.stubGlobal('fetch', f);
    await fetchRunIO('kontra-fleet/dns');
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      'kontra-fleet%2Fdns'
    );
  });
});

describe('fetchRunDatasets', () => {
  it('returns the partitions the lake attributes to the run', async () => {
    vi.stubGlobal(
      'fetch',
      answer([
        {
          name: 'canary_signals',
          kind: 'output',
          version: '1.0.0',
          dt: '2026-09-23T11-34-35',
          rows: 10,
          bytes: 2308,
          contributingRuns: ['canary-1790163275'],
        },
      ])
    );
    const out = await fetchRunDatasets('canary-1790163275');
    expect(out).toHaveLength(1);
    // The four fields that ADDRESS a partition must survive, or the preview shows the newest
    // run's rows under the same Dataset name instead of this run's.
    expect(out[0]).toMatchObject({ name: 'canary_signals', version: '1.0.0', dt: '2026-09-23T11-34-35' });
  });

  it('refuses a body that is not an array rather than rendering junk', async () => {
    vi.stubGlobal('fetch', answer({ groups: [] }));
    await expect(fetchRunDatasets('x')).resolves.toEqual([]);
  });
});

describe('datasetLabel', () => {
  const base = { name: 'canary_signals', kind: 'output', rows: 10, bytes: 1 };

  it('prefers an operator rename', () => {
    expect(datasetLabel({ ...base, datasetName: 'wf-canary-…', renamedTo: 'last night' })).toBe(
      'last night'
    );
  });
  it('then the derived run-grain name', () => {
    expect(datasetLabel({ ...base, datasetName: 'wf-canary-1.0.0--…--22e944' })).toBe(
      'wf-canary-1.0.0--…--22e944'
    );
  });
  it('and never blank — the storage name is the floor', () => {
    expect(datasetLabel(base)).toBe('canary_signals');
  });
});

describe('pairsOf / cellOf', () => {
  it('renders a list as JSON rather than as [object Object]', () => {
    expect(pairsOf({ targets: ['alpha', 'beta'] })).toEqual([
      { name: 'targets', value: '["alpha","beta"]' },
    ]);
  });

  it('keeps scalars as themselves, including false and 0', () => {
    expect(pairsOf({ complete: false, records: 0, dataset: 'canary_signals' })).toEqual([
      { name: 'complete', value: 'false' },
      { name: 'records', value: '0' },
      { name: 'dataset', value: 'canary_signals' },
    ]);
  });

  it('says null as a word', () => {
    expect(cellOf(null)).toBe('null');
    expect(cellOf(undefined)).toBe('');
    expect(cellOf('')).toBe('');
  });

  it('is empty for a payload that is not an object', () => {
    // A workflow returning a bare string or a list has no pairs. The caller draws the raw value.
    expect(pairsOf('done')).toEqual([]);
    expect(pairsOf(['a'])).toEqual([]);
    expect(pairsOf(undefined)).toEqual([]);
  });
});

describe('lakeMaterialization', () => {
  const ds = (rows: number) => ({ name: 'canary_signals', kind: 'output', rows, bytes: 1 });

  it('overrides the ledger once the lake has an answer', () => {
    // THE BUG THIS PINS. `materializationOf` reads the ADR 0017 ledger, which the SDK publish path
    // never writes — so a run with ten rows in the lake showed `unrecorded`.
    const m = lakeMaterialization([ds(10)]);
    expect(m?.label).toBe('materialized');
    expect(m?.title).toContain('10 row(s) across 1 Dataset');
  });

  it('sums across the partitions one run wrote', () => {
    expect(lakeMaterialization([ds(10), ds(5)])?.title).toContain('15 row(s) across 2 Datasets');
  });

  it('does not override when the lake was not read or has nothing', () => {
    // `undefined` is "keep the ledger's word", which for an unreadable ledger is `unknown` — a
    // different and still-honest answer.
    expect(lakeMaterialization([])).toBeUndefined();
  });
});
