import { describe, expect, it } from 'vitest';

import { cellText, fetchSchema, runQuery, runScopedSql, starterSql } from './query';

const res = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body }) as Response;

describe('running a query', () => {
  it('sends the sql and a limit, and returns what the engine measured', async () => {
    let sent: unknown;
    const out = await runQuery('SELECT 1', { limit: 50 }, (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return res(200, { columns: [{ name: 'x', type: 'INTEGER' }], rows: [[1]], elapsedMs: 3, truncated: false });
    }) as unknown as typeof fetch);
    expect(sent).toEqual({ sql: 'SELECT 1', limit: 50 });
    expect(out.ok && out.result.elapsedMs).toBe(3);
  });

  /**
   * A BAD QUERY IS THE OPERATOR'S INPUT, NOT A SERVER FAULT — and the two have to be told apart or
   * a typo reads as an outage. The route answers 400 with the ENGINE's sentence precisely so the
   * editor can print it underneath; swallowing it for a generic "query failed" throws away the line
   * and column the engine already worked out.
   */
  it('separates a REJECTED query from an unreachable server', async () => {
    const bad = await runQuery('SELEC 1', {}, (async () =>
      res(400, { error: 'Parser Error: syntax error at or near "SELEC"' })) as unknown as typeof fetch);
    expect(bad).toEqual({
      ok: false,
      rejected: true,
      detail: 'Parser Error: syntax error at or near "SELEC"',
    });

    const off = await runQuery('SELECT 1', {}, (async () =>
      res(503, { error: 'disabled: set one of KONTRA_EXPLORE_TOKEN or KONTRA_STATE_TOKEN' })) as unknown as typeof fetch);
    expect(off.ok).toBe(false);
    expect(off).toMatchObject({ rejected: false });
    // THE SENTENCE SURVIVES. 503 here means the surface is switched OFF and it names the variable
    // that turns it on — an operator can act on that, and cannot act on "request failed".
    expect(off.ok === false && off.detail).toContain('KONTRA_EXPLORE_TOKEN');
  });

  it('treats a network failure as unreachable, not as a rejection', async () => {
    const out = await runQuery('SELECT 1', {}, (async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, rejected: false, detail: 'Failed to fetch' });
  });

  it('refuses an empty query without a round trip', async () => {
    let called = false;
    const out = await runQuery('   ', {}, (async () => {
      called = true;
      return res(200, {});
    }) as unknown as typeof fetch);
    expect(called).toBe(false);
    expect(out).toMatchObject({ ok: false, rejected: true });
  });
});

describe('the schema', () => {
  /**
   * THE ENVELOPE IS `{datasets: […]}` AND READING IT WRONG IS THE BUG kontra-console#4 RECORDS:
   * `Datasets.svelte` read `body.groups` off a response that is a bare array, so the fallback fired
   * on every load and the surface rendered EMPTY on a 56-dataset catalog, with no error. The `?? []`
   * is what made it silent.
   */
  it('reads the datasets envelope', async () => {
    const out = await fetchSchema((async () =>
      res(200, { datasets: [{ kind: 'standalone', name: 'lame', columns: [{ name: 'domain', type: 'VARCHAR' }] }] })) as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    expect(out[0]!.columns[0]!.name).toBe('domain');
  });

  it('does not mistake a bare array for the envelope', async () => {
    const out = await fetchSchema((async () => res(200, [{ name: 'lame' }])) as unknown as typeof fetch);
    expect(out).toEqual([]);
  });

  it('answers empty when the surface is off, rather than throwing into the editor', async () => {
    expect(await fetchSchema((async () => res(503, { error: 'disabled' })) as unknown as typeof fetch)).toEqual([]);
  });
});

describe('the starter query', () => {
  it('names the dataset, so the box is never an empty prompt', () => {
    expect(starterSql('lame')).toContain('FROM lame');
    expect(starterSql('lame')).toContain('LIMIT');
  });
});

describe('the query for one run’s rows', () => {
  it('scopes to the run, because a Dataset several runs append to holds everybody’s rows', () => {
    const sql = runScopedSql('canary_signals', 'canary-1790191378');
    expect(sql).toContain('FROM canary_signals');
    expect(sql).toContain("WHERE run_id = 'canary-1790191378'");
    expect(sql).toContain('LIMIT');
  });

  it('is the plain starter when there is no run — a standalone Dataset has no run_id', () => {
    expect(runScopedSql('loaded')).toBe(starterSql('loaded'));
    expect(runScopedSql('loaded', '')).toBe(starterSql('loaded'));
  });

  /**
   * A run id is whatever `--id` was. Nothing in the console constrains it, so a quote in one must
   * close as a literal rather than as the string it was pasted into.
   */
  it('escapes a quote in the run id rather than ending the literal on it', () => {
    const sql = runScopedSql('t', "it's-1");
    expect(sql).toContain("run_id = 'it''s-1'");
    expect(sql).not.toContain("'it's-1'");
  });
});

describe('rendering one cell', () => {
  /**
   * THE BUG THIS EXISTS FOR: `exchanges_8x8.header` is `MAP(VARCHAR, VARCHAR)` and the workbench
   * rendered every row of it as `[object Object],[object Object],…`. Not a truncation — the cell's
   * entire content was destroyed by `String(v)` on the way to the screen, in the one column an
   * operator opens that dataset to read.
   */
  it('renders a DuckDB MAP as key=value, not [object Object]', () => {
    const header = [
      { key: 'server', value: 'cloudflare' },
      { key: 'cf_ray', value: 'a36e07a9a8fded38-SJC' },
    ];
    const out = cellText(header);
    expect(out).toContain('server=cloudflare');
    expect(out).toContain('cf_ray=a36e07a9a8fded38-SJC');
    expect(out).not.toContain('[object Object]');
  });

  it('falls back to compact JSON for other composites, which is lossless if not pretty', () => {
    expect(cellText({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
    expect(cellText([1, 2, 3])).toBe('[1,2,3]');
    expect(cellText([{ nope: 1 }])).toBe('[{"nope":1}]'); // not key/value-shaped
  });

  it('leaves scalars exactly as they are', () => {
    expect(cellText('plain')).toBe('plain');
    expect(cellText(0)).toBe('0');
    expect(cellText(false)).toBe('false');
    // AN EMPTY STRING IS NOT A NULL. The caller draws `null` as a word before reaching here, so
    // this must not invent one.
    expect(cellText('')).toBe('');
    expect(cellText(null)).toBe('');
  });
});
