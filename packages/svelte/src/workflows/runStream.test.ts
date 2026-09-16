import { describe, expect, it } from 'vitest';

import { followRun, type Follow } from './runStream';

class FakeES {
  static last: FakeES | undefined;
  handlers = new Map<string, (e: unknown) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeES.last = this; }
  addEventListener(name: string, fn: (e: unknown) => void): void { this.handlers.set(name, fn); }
  emit(name: string, data?: unknown): void { this.handlers.get(name)?.({ data: JSON.stringify(data) }); }
  close(): void { this.closed = true; }
}
const ES = FakeES as unknown as typeof EventSource;

describe('following a run', () => {
  it('carries the run view off a `state` frame', () => {
    const seen: Follow<{ status: string }>[] = [];
    followRun<{ status: string }>('r1', (f) => seen.push(f), { EventSourceImpl: ES });
    FakeES.last!.emit('state', { status: 'running' });
    expect(seen.at(-1)).toEqual({ state: 'live', run: { status: 'running' } });
  });

  it('CLOSES on `end` instead of letting EventSource reconnect forever', () => {
    // The bug to avoid: the server closes deliberately when a run is terminal, EventSource
    // reopens, and the console polls a finished run for as long as the tab is open.
    followRun('r1', () => {}, { EventSourceImpl: ES });
    FakeES.last!.emit('state', { status: 'completed' });
    FakeES.last!.emit('end', {});
    expect(FakeES.last!.closed).toBe(true);
  });

  it('does not report `reconnecting` after the server said it was done', () => {
    const seen: Follow<unknown>[] = [];
    followRun('r1', (f) => seen.push(f), { EventSourceImpl: ES });
    FakeES.last!.emit('end', {});
    FakeES.last!.onerror?.(); // EventSource fires this as the socket closes
    expect(seen.at(-1)!.state).toBe('ended');
  });

  it('keeps the last good run through a warn and through an error', () => {
    const seen: Follow<{ status: string }>[] = [];
    followRun<{ status: string }>('r1', (f) => seen.push(f), { EventSourceImpl: ES });
    FakeES.last!.emit('state', { status: 'running' });
    FakeES.last!.emit('warn', { detail: 'could not read' });
    expect(seen.at(-1)).toEqual({ state: 'reconnecting', run: { status: 'running' } });
    FakeES.last!.onerror?.();
    expect(seen.at(-1)).toEqual({ state: 'reconnecting', run: { status: 'running' } });
  });

  it('survives a frame that does not parse', () => {
    const seen: Follow<unknown>[] = [];
    followRun('r1', (f) => seen.push(f), { EventSourceImpl: ES });
    FakeES.last!.handlers.get('state')!({ data: '{not json' });
    expect(seen.at(-1)!.state).toBe('reconnecting');
    expect(FakeES.last!.closed).toBe(false); // the stream is fine; the frame was not
  });

  it('stops when told to, because the server counts open streams', () => {
    const stop = followRun('r1', () => {}, { EventSourceImpl: ES });
    stop();
    expect(FakeES.last!.closed).toBe(true);
  });
});
