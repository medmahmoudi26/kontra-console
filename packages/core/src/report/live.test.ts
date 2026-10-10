/**
 * The live report stream (ADR 0062) — framing, patching and the refusals that must not be retried.
 *
 * The SSE parse is tested against CHUNK BOUNDARIES rather than whole frames, because the network
 * puts the boundary wherever it likes and the bug that shape produces — half a frame parsed as a
 * broken one — is invisible in a test that feeds complete frames.
 */

import { describe, expect, it, vi } from 'vitest';

import { applyPatch, openLiveReport, parseFrame, splitFrames, type LiveHandlers } from './live';

function handlers(): LiveHandlers & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    snapshot: [],
    patch: [],
    status: [],
    final: [],
    phase: [],
    refused: [],
  };
  return {
    calls,
    onSnapshot: (...a) => calls.snapshot!.push(a),
    onPatch: (...a) => calls.patch!.push(a),
    onStatus: (...a) => calls.status!.push(a),
    onFinal: (...a) => calls.final!.push(a),
    onPhase: (...a) => calls.phase!.push(a),
    onRefused: (...a) => calls.refused!.push(a),
  };
}

/**
 * A body that yields exactly these chunks, so a test controls where the boundaries fall, and then
 * STAYS OPEN — which is what a real event stream does. A fixture that closes instead makes every
 * test race the reconnect it just triggered.
 */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) return; // open, idle: `read()` stays pending
      c.enqueue(enc.encode(chunks[i]!));
      i += 1;
    },
  });
}

/** A body that ends after its chunks, for the one test that is about a dropped stream. */
function closingBodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(chunks[i]!));
      i += 1;
    },
  });
}

function sse(event: Record<string, unknown>): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

describe('framing', () => {
  it('returns complete frames and keeps the remainder', () => {
    const { frames, rest } = splitFrames('a\n\nb\n\npartial');
    expect(frames).toEqual(['a', 'b']);
    expect(rest).toBe('partial');
  });

  it('returns nothing when no frame is complete yet', () => {
    expect(splitFrames('event: snapshot\ndata: {')).toEqual({
      frames: [],
      rest: 'event: snapshot\ndata: {',
    });
  });

  it('parses a known event', () => {
    expect(parseFrame('event: status\ndata: {"type":"status","status":"running"}')).toEqual({
      type: 'status',
      status: 'running',
    });
  });

  it('ignores a frame with no data line, broken JSON, or an unknown type', () => {
    expect(parseFrame('event: ping')).toBeUndefined();
    expect(parseFrame('data: {nope')).toBeUndefined();
    expect(parseFrame('data: {"type":"gossip"}')).toBeUndefined();
  });
});

describe('applyPatch', () => {
  it('replaces only the named indices', () => {
    expect(applyPatch(['a', 'b', 'c'], [{ index: 1, node: 'B' }])).toEqual(['a', 'B', 'c']);
  });

  it('ignores an index outside the list rather than growing it', () => {
    expect(applyPatch(['a'], [{ index: 5, node: 'x' }])).toEqual(['a']);
    expect(applyPatch(['a'], [{ index: -1, node: 'x' }])).toEqual(['a']);
  });

  it('does not mutate the list it was given', () => {
    const before = ['a', 'b'];
    applyPatch(before, [{ index: 0, node: 'A' }]);
    expect(before).toEqual(['a', 'b']);
  });
});

describe('the stream', () => {
  it('delivers a snapshot then a patch, across an awkward chunk boundary', async () => {
    const snapshot = sse({ type: 'snapshot', blocks: [{ index: 0, node: { t: 'a' } }] });
    const patch = sse({ type: 'patch', blocks: [{ index: 0, node: { t: 'b' } }] });
    const joined = snapshot + patch;
    // Split mid-frame, which is the case a whole-frame test never exercises.
    const cut = snapshot.length - 5;
    const h = handlers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: bodyOf([joined.slice(0, cut), joined.slice(cut)]),
    })) as unknown as typeof globalThis.fetch;

    const stop = openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    await vi.waitFor(() => expect(h.calls.patch).toHaveLength(1));
    stop();

    expect(h.calls.snapshot).toHaveLength(1);
    expect(h.calls.snapshot[0]![0]).toEqual([{ index: 0, node: { t: 'a' } }]);
    expect(h.calls.patch[0]![0]).toEqual([{ index: 0, node: { t: 'b' } }]);
  });

  it('carries the degraded reason through so the page can say why nothing moves', async () => {
    const h = handlers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: bodyOf([sse({ type: 'snapshot', blocks: [], degraded: 'no materializer role' })]),
    })) as unknown as typeof globalThis.fetch;

    const stop = openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    await vi.waitFor(() => expect(h.calls.snapshot).toHaveLength(1));
    stop();

    expect(h.calls.snapshot[0]![1]).toEqual({ degraded: 'no materializer role' });
  });

  it('treats `final` as terminal and stops reading', async () => {
    const h = handlers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: bodyOf([sse({ type: 'final', version: 4 })]),
    })) as unknown as typeof globalThis.fetch;

    openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    await vi.waitFor(() => expect(h.calls.final).toHaveLength(1));

    expect(h.calls.final[0]).toEqual([4]);
    expect(h.calls.phase.at(-1)).toEqual(['closed']);
    // Terminal means terminal: no reconnect after the run ended.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** Retrying these forever would hammer the orchestrator for a document that will never appear. */
  it.each([
    [404, 'no run r1'],
    [409, 'already ended'],
    [503, 'at capacity'],
  ])('refuses %i without retrying', async (status, message) => {
    const h = handlers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status,
      json: async () => ({ error: message }),
    })) as unknown as typeof globalThis.fetch;

    openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    await vi.waitFor(() => expect(h.calls.refused).toHaveLength(1));

    expect(h.calls.refused[0]).toEqual([status, message]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reconnects after a dropped stream', async () => {
    const h = handlers();
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('socket died');
      if (n === 2) {
        return { ok: true, status: 200, body: closingBodyOf([sse({ type: 'status', status: 'running' })]) };
      }
      // Third attempt stays open, so the assertions are about ONE reconnect rather than a race.
      return { ok: true, status: 200, body: bodyOf([]) };
    }) as unknown as typeof globalThis.fetch;

    const stop = openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    await vi.waitFor(() => expect(h.calls.status).toHaveLength(1));
    stop();

    expect(h.calls.phase.map((p) => p[0])).toContain('reconnecting');
  });

  it('stops when asked, so a torn-down component frees its viewer slot', async () => {
    const h = handlers();
    const fetchMock = vi.fn(
      async () =>
        new Promise(() => {
          /* never resolves: the stream is open */
        })
    ) as unknown as typeof globalThis.fetch;

    const stop = openLiveReport('r1', h, { fetch: fetchMock, backoff: [0, 50], sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    stop();
    expect(h.calls.phase.at(-1)).toEqual(['stopped']);
  });
});
