import { describe, expect, it, vi } from 'vitest';

import { fetchPreview, previewUrl, readPreview } from './preview';

/** The exact body the live orchestrator answered for `obs_paypal_v1`. */
const WIRE = {
  columns: [
    { name: 'host', type: 'VARCHAR' },
    { name: 'port', type: 'BIGINT' },
    { name: 'erratic', type: 'BOOLEAN' },
  ],
  rows: [
    ['voapi.8x8.com', 443, false],
    ['sso.8x8.com', 443, null],
  ],
};

describe('readPreview', () => {
  it('reads the wire shape, rows positional', () => {
    const p = readPreview(WIRE);
    expect(p.columns.map((c) => c.name)).toEqual(['host', 'port', 'erratic']);
    expect(p.rows[0]).toEqual(['voapi.8x8.com', 443, false]);
    expect(p.truncated).toBe(false);
  });

  it('keeps null as a value rather than dropping the cell', () => {
    expect(readPreview(WIRE).rows[1][2]).toBeNull();
  });

  // THE BUG THIS MODULE EXISTS TO NOT REPEAT: the listing surface answered a wrong shape with an
  // empty table and no error. A preview refuses instead.
  it('refuses a bare array', () => {
    expect(() => readPreview([])).toThrow(/did not answer with an object/);
  });

  it('refuses an object without columns and rows', () => {
    expect(() => readPreview({ groups: [] })).toThrow(/without columns and rows/);
  });

  it('marks the sample truncated when a malformed row was dropped', () => {
    const p = readPreview({ columns: WIRE.columns, rows: [WIRE.rows[0], 'nope'] });
    expect(p.rows).toHaveLength(1);
    expect(p.truncated).toBe(true);
  });
});

describe('previewUrl', () => {
  it('always bounds the sample', () => {
    expect(previewUrl({ dataset: 'obs_8x8_v1' })).toContain('limit=50');
  });

  it('encodes a name and carries the kind', () => {
    const u = previewUrl({ dataset: 'a/b', kind: 'standalone', limit: 5 });
    expect(u).toContain('a%2Fb');
    expect(u).toContain('kind=standalone');
    expect(u).toContain('limit=5');
  });
});

describe('fetchPreview', () => {
  it("surfaces the server's own sentence on a refusal", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: 'no such dataset: nope' }),
    } as unknown as Response);
    await expect(fetchPreview({ dataset: 'nope' }, f as unknown as typeof fetch))
      .rejects.toThrow('no such dataset: nope');
  });

  it('falls back to the status when there is no sentence', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({}),
    } as unknown as Response);
    await expect(fetchPreview({ dataset: 'x' }, f as unknown as typeof fetch))
      .rejects.toThrow(/HTTP 502/);
  });
});
