import { describe, expect, it, vi } from 'vitest';

import { ago, initialOf, loadReport, postNote } from './load';

/** A fetch double: a map from url substring to a response. Anything unmatched is a hard failure, so a
 *  read this loader makes and a test did not expect shows up as a test error rather than as silence. */
function fetchOf(routes: Array<[string, { status?: number; body?: unknown; throws?: string }]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, res] of routes) {
      if (!url.includes(match)) continue;
      if (res.throws) throw new Error(res.throws);
      const status = res.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => res.body,
        text: async () => JSON.stringify(res.body),
      } as Response;
    }
    throw new Error(`the loader asked for ${url}, which this test did not stub`);
  }) as unknown as typeof fetch;
}

const REPORT = { runId: 'r1', version: 2, status: 'ok', templateHash: 'h', renderedAt: 1, renderedBy: 'sweep' };

describe('loadReport', () => {
  it('reads the report, its versions and its thread', async () => {
    const page = await loadReport(
      'r1',
      fetchOf([
        ['/report/versions', { body: { versions: [{ version: 2 }, { version: 1 }] } }],
        ['/feedback', { body: { notes: [{ id: 'n1', body: 'hi' }] } }],
        ['/report', { body: REPORT }],
      ])
    );
    expect(page.report?.version).toBe(2);
    expect(page.versions).toHaveLength(2);
    expect(page.notes).toHaveLength(1);
    expect(page.missing).toEqual([]);
    expect(page.absent).toBe(false);
  });

  it('treats a 404 as ABSENT rather than as a failure, because most finished runs are briefly absent', async () => {
    const page = await loadReport('r1', fetchOf([
      ['/feedback', { body: { notes: [] } }],
      ['/report', { status: 404 }],
    ]));
    expect(page.absent).toBe(true);
    expect(page.missing, 'a missing report was reported as a broken read').toEqual([]);
    expect(page.report).toBeNull();
  });

  it('does not ask for versions when there is no report', async () => {
    // A second 404 would be noise about a state the page already explains.
    const asked: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    await loadReport('r1', spy);
    expect(asked.some((u) => u.includes('/versions'))).toBe(false);
  });

  it('NAMES a failed read rather than rendering an empty page', async () => {
    const page = await loadReport('r1', fetchOf([
      ['/report/versions', { status: 500 }],
      ['/feedback', { throws: 'network down' }],
      ['/report', { body: REPORT }],
    ]));
    expect(page.report).not.toBeNull();
    expect(page.missing.map((m) => m.status)).toEqual([500, 0]);
    expect(page.missing[1]!.why).toBe('network down');
  });

  it('keeps the report when only the thread failed', async () => {
    const page = await loadReport('r1', fetchOf([
      ['/report/versions', { body: { versions: [] } }],
      ['/feedback', { status: 503 }],
      ['/report', { body: REPORT }],
    ]));
    expect(page.report?.version).toBe(2);
    expect(page.notes).toEqual([]);
    expect(page.missing).toHaveLength(1);
  });

  it('asks for a named version when given one', async () => {
    const asked: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return { ok: true, status: 200, json: async () => ({ versions: [], notes: [] }), text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    await loadReport('r1', spy, 3);
    expect(asked[0]).toContain('?version=3');
  });

  it('encodes a run id rather than trusting it', async () => {
    const asked: string[] = [];
    const spy = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return { ok: true, status: 200, json: async () => ({ versions: [], notes: [] }), text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    await loadReport('a/b', spy);
    expect(asked[0]).toContain('a%2Fb');
  });
});

describe('postNote', () => {
  it('returns the created note', async () => {
    const note = await postNote('r1', 'hello', fetchOf([['/feedback', { body: { id: 'n1', body: 'hello' } }]]));
    expect(note.id).toBe('n1');
  });

  it("surfaces the server's OWN sentence, because each refusal has a different fix", async () => {
    const fetchImpl = fetchOf([['/feedback', { status: 400, body: { error: 'a note cannot be empty' } }]]);
    await expect(postNote('r1', ' ', fetchImpl)).rejects.toThrow('a note cannot be empty');
  });

  it('falls back to a sentence of its own when the server said nothing useful', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503, text: async () => '' }) as Response) as unknown as typeof fetch;
    await expect(postNote('r1', 'x', fetchImpl)).rejects.toThrow('refused (503)');
  });
});

describe('ago', () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  it('reads as a person would say it', () => {
    expect(ago(now - 5_000, now)).toBe('just now');
    expect(ago(now - 120_000, now)).toBe('2 min ago');
    expect(ago(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(ago(now - 2 * 86400_000, now)).toBe('2d ago');
  });

  it('never says a negative time for a clock that is slightly ahead', () => {
    expect(ago(now + 10_000, now)).toBe('just now');
  });

  it('falls back to a date once a week has passed', () => {
    expect(ago(now - 30 * 86400_000, now)).toMatch(/\d/);
  });
});

describe('initialOf', () => {
  it('uses a person\'s first letter', () => {
    expect(initialOf({ author: 'mohamed', authorKind: 'user' })).toBe('M');
  });

  it('shows a dot for a token, because a token is not a person', () => {
    expect(initialOf({ author: 'service-token', authorKind: 'token' })).toBe('·');
  });

  it('does not crash on an empty author', () => {
    expect(initialOf({ author: '', authorKind: 'user' })).toBe('?');
  });
});
