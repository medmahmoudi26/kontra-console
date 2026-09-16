import { describe, expect, it, vi } from 'vitest';

import { watchContract, type LiveContract } from './live';

/** A schema with one field, or two — enough to see a form GROW, which is the feature. */
const schemaWith = (names: string[]) => ({
  type: 'object',
  required: ['host'],
  properties: Object.fromEntries(names.map((n) => [n, { type: 'string' }])),
});

function fakeFetch(fields: () => string[]): typeof fetch {
  return (async (url: string) => {
    if (String(url).startsWith('/api/actors')) {
      return {
        ok: true,
        json: async () => [
          { name: 'firstactor', version: '0.1.0', operations: [{ name: 'expand', input: schemaWith(fields()) }] },
        ],
      };
    }
    if (String(url).startsWith('/api/sources/actor')) {
      return { ok: true, json: async () => ({ sources: [{ id: 'actor:firstactor:abc', name: 'firstactor' }] }) };
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
}

/** A hand-driven EventSource, so a test can deliver a save without a server. */
class FakeES {
  static last: FakeES | undefined;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeES.last = this;
  }
  close(): void {
    this.closed = true;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('/dev is live', () => {
  it('re-reads the contract when the stream says the file changed', async () => {
    let fields = ['host'];
    const seen: LiveContract[] = [];
    const stop = watchContract('firstactor', 'expand', (s) => seen.push(s), {
      fetchImpl: fakeFetch(() => fields),
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    await settle();
    FakeES.last!.onopen?.();

    // The author adds a field and saves.
    fields = ['host', 'mode'];
    FakeES.last!.onmessage?.();
    await settle();

    const latest = seen.at(-1)!;
    expect(latest.contract.state).toBe('ready');
    // Narrowed rather than cast: the assertion above already proved the state, and a cast would
    // keep compiling if `ready` ever stopped carrying a schema.
    if (latest.contract.state !== 'ready') throw new Error('not ready');
    expect(Object.keys(latest.contract.schema?.properties ?? {})).toEqual(['host', 'mode']); // GREW
    expect(latest.revisions).toBeGreaterThan(1);
    stop();
  });

  it('subscribes to the SOURCE id, which is not the actor name', async () => {
    const stop = watchContract('firstactor', 'expand', () => {}, {
      fetchImpl: fakeFetch(() => ['host']),
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    await settle();
    expect(FakeES.last!.url).toContain('actor%3Afirstactor%3Aabc');
    stop();
  });

  it('reports reconnecting rather than failing, and keeps the last good contract', async () => {
    const seen: LiveContract[] = [];
    const stop = watchContract('firstactor', 'expand', (s) => seen.push(s), {
      fetchImpl: fakeFetch(() => ['host']),
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    await settle();
    FakeES.last!.onopen?.();
    const before = seen.at(-1)!.contract;

    FakeES.last!.onerror?.();
    const after = seen.at(-1)!;
    expect(after.link).toBe('reconnecting');
    // THE FORM DOES NOT GO AWAY. A dropped socket that blanked the pane would be worse than a poll.
    expect(after.contract).toEqual(before);
    stop();
  });

  it('closes the stream when stopped, because the server counts them', async () => {
    const stop = watchContract('firstactor', 'expand', () => {}, {
      fetchImpl: fakeFetch(() => ['host']),
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    await settle();
    stop();
    expect(FakeES.last!.closed).toBe(true);
  });

  it('says so when the browser has no EventSource, rather than quietly polling', async () => {
    const seen: LiveContract[] = [];
    const stop = watchContract('firstactor', 'expand', (s) => seen.push(s), {
      fetchImpl: fakeFetch(() => ['host']),
      EventSourceImpl: undefined as unknown as typeof EventSource,
    });
    await settle();
    expect(seen.at(-1)!.link).toBe('unsupported');
    stop();
  });

  it('uses no timers at all', async () => {
    // ADR 0048 §3, asserted rather than asked for. A poll would pass every test above.
    const spy = vi.spyOn(globalThis, 'setInterval');
    const stop = watchContract('firstactor', 'expand', () => {}, {
      fetchImpl: fakeFetch(() => ['host']),
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    stop();
  });
});
