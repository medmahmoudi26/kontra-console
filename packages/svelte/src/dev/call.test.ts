/**
 * What a call does between the button and the answer.
 *
 * The interesting cases are all resolution and sequencing: the actor name that maps to two folders,
 * the reading that happens once rather than on a timer, and the pane that closes while a probe is
 * still starting.
 */
import { describe, expect, it, vi } from 'vitest';

import { callMethod, folderFor, type Call } from './call';

const source = (over: Partial<{ id: string; name: string; version: string; path: string; absent: boolean }>) =>
  ({
    id: 'f1',
    kind: 'actor' as const,
    name: 'firstactor',
    version: '0.1.0',
    path: '/w/firstactor',
    description: '',
    registeredAt: 0,
    ...over,
  });

const listing = (...sources: ReturnType<typeof source>[]) => async () => ({ defaultRoot: '/w', sources });

describe('folderFor', () => {
  it('resolves a name to the one folder that holds it', async () => {
    expect(await folderFor('firstactor', '0.1.0', listing(source({})))).toEqual({ id: 'f1' });
  });

  it('narrows two folders by version', async () => {
    const got = await folderFor(
      'firstactor',
      '0.2.0',
      listing(source({ id: 'old', version: '0.1.0' }), source({ id: 'new', version: '0.2.0' }))
    );
    expect(got).toEqual({ id: 'new' });
  });

  it('refuses to pick between two identical registrations, and names both paths', async () => {
    const got = await folderFor(
      'firstactor',
      '0.1.0',
      listing(source({ id: 'a', path: '/w/a' }), source({ id: 'b', path: '/w/b' }))
    );
    // Picking `[0]` here would run a checkout the operator did not choose, and nothing on screen
    // would say which one ran.
    expect(got).toEqual({ error: expect.stringContaining('/w/a, /w/b') });
  });

  it('ignores a folder whose directory is gone', async () => {
    const got = await folderFor('firstactor', '0.1.0', listing(source({ id: 'gone', absent: true })));
    expect(got).toEqual({ error: expect.stringContaining('kontra actor register') });
  });

  it('says what to do when nothing is registered', async () => {
    expect(await folderFor('nope', '0.1.0', listing(source({})))).toEqual({
      error: expect.stringContaining('no registered folder holds nope'),
    });
  });
});

describe('callMethod', () => {
  /** A `followRun` stand-in whose handler the test drives. */
  function fakeFollow() {
    let emit: ((f: { state: string; run?: { status?: string } }) => void) | undefined;
    const stop = vi.fn();
    const follow = vi.fn((_id: string, onchange: (f: never) => void) => {
      emit = onchange as unknown as typeof emit;
      return stop;
    });
    return { follow: follow as never, stop, fire: (f: { state: string; run?: { status?: string } }) => emit?.(f) };
  }

  it('starts the probe against the resolved folder and reads the result once the stream ends', async () => {
    const seen: Call[] = [];
    const f = fakeFollow();
    const start = vi.fn(async () => ({ runId: 'probe-1' }) as never);
    const read = vi.fn(async () => ({ runId: 'probe-1', status: 'COMPLETED', result: { units: 1, results: 13, isolated: 0, done: true, machine: 'local', dataset: 'd' } }) as never);

    callMethod('firstactor', '0.1.0', 'expand', [{ host: 'example.com' }], (c) => seen.push(c), {
      sources: listing(source({})) as never,
      start,
      read,
      follow: f.follow,
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    expect(start).toHaveBeenCalledWith('f1', 'expand', [{ host: 'example.com' }]);
    // NOT YET READ. The answer is fetched when the run ends, never on a timer.
    expect(read).not.toHaveBeenCalled();

    f.fire({ state: 'live', run: { status: 'RUNNING' } });
    f.fire({ state: 'ended' });
    await vi.waitFor(() => expect(seen.at(-1)?.state).toBe('done'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen.map((c) => c.state)).toEqual(['starting', 'running', 'running', 'done']);
  });

  it('shows the server sentence when the probe is refused', async () => {
    const seen: Call[] = [];
    callMethod('firstactor', '0.1.0', 'expand', [{}], (c) => seen.push(c), {
      sources: listing(source({})) as never,
      start: (async () => {
        throw new Error('no worker is polling wf-firstactor-0.1.0');
      }) as never,
      follow: fakeFollow().follow,
    });
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ state: 'error', error: 'no worker is polling wf-firstactor-0.1.0' }));
  });

  it('a run that finished but could not be read is not reported as a failed call', async () => {
    const seen: Call[] = [];
    const f = fakeFollow();
    callMethod('firstactor', '0.1.0', 'expand', [{}], (c) => seen.push(c), {
      sources: listing(source({})) as never,
      start: (async () => ({ runId: 'probe-2' })) as never,
      read: (async () => {
        throw new Error('HTTP 502');
      }) as never,
      follow: f.follow,
    });
    await vi.waitFor(() => expect(seen.at(-1)?.state).toBe('running'));
    f.fire({ state: 'ended' });
    await vi.waitFor(() =>
      expect(seen.at(-1)).toEqual({ state: 'error', error: 'probe-2 finished but its result could not be read: HTTP 502' })
    );
  });

  it('a pane closed mid-start never reports a run it abandoned', async () => {
    const seen: Call[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const cancel = callMethod('firstactor', '0.1.0', 'expand', [{}], (c) => seen.push(c), {
      sources: (async () => {
        await gate;
        return { defaultRoot: '/w', sources: [source({})] };
      }) as never,
      start: (async () => ({ runId: 'probe-3' })) as never,
      follow: fakeFollow().follow,
    });
    cancel();
    release?.();
    await new Promise((done) => setTimeout(done, 5));
    expect(seen.map((c) => c.state)).toEqual(['starting']);
  });
});
