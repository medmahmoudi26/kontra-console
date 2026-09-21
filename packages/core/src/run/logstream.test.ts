/**
 * The live stream's pure half.
 *
 * Everything asserted here is a thing jsdom cannot see and a screenshot cannot prove: a frame split
 * across two TCP reads, a colour that has to be the same tomorrow, a follow rule that has to
 * survive its own scrolling. The GEOMETRY is proved in a browser (`scripts/overflow.mjs`, and the
 * Playwright shots) — these are the parts a browser would only tell you about by being wrong.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BACKOFF_CAP_MS,
  BACKOFF_START_MS,
  FOLLOW_SLACK_PX,
  HUES,
  MAX_LINES,
  SLOTS,
  actorStyle,
  appendLines,
  atBottom,
  backfill,
  errorOf,
  hashActor,
  lineOf,
  mergeBackfill,
  nextBackoff,
  openTail,
  readFrames,
  shouldFollow,
  type StreamLine,
} from './logstream';

const frame = (actor: string, msg: string, level = 'info'): string =>
  `event: log\ndata: ${JSON.stringify({ _time: '2026-09-20T01:32:03Z', _msg: msg, actor, level, machine: 'demo' })}\n\n`;

describe('SSE framing', () => {
  it('reads whole frames and hands back nothing when the buffer ends cleanly', () => {
    const { frames, rest } = readFrames(frame('desync', 'one') + frame('nuclei', 'two'));
    expect(frames.map((f) => f.event)).toEqual(['log', 'log']);
    expect(rest).toBe('');
  });

  it('KEEPS THE UNTERMINATED TAIL — the failure this costs is silent line loss under load', () => {
    const whole = frame('desync', 'one');
    const half = 'event: log\ndata: {"_msg":"tw';
    const { frames, rest } = readFrames(whole + half);
    expect(frames).toHaveLength(1);
    expect(rest).toBe(half);

    // …and the next read completes it, which is the property that matters.
    const done = readFrames(rest + 'o","actor":"nuclei"}\n\n');
    expect(done.frames).toHaveLength(1);
    expect(lineOf(done.frames[0]!)?.msg).toBe('two');
    expect(done.rest).toBe('');
  });

  it('joins a multi-line data field and ignores keep-alive comments', () => {
    const { frames } = readFrames(': ping\n\nevent: log\ndata: a\ndata: b\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('a\nb');
  });

  it('defaults the event name and tolerates CRLF from a rewriting proxy', () => {
    const { frames } = readFrames('data: {"_msg":"x"}\r\n\r\n');
    expect(frames[0]!.event).toBe('message');
    expect(frames[0]!.data).toBe('{"_msg":"x"}');
  });

  it('turns a log frame into a record and an error frame into the server\'s own sentence', () => {
    const { frames } = readFrames(
      frame('webcrawl', 'crawl: page 3/10, +18 event(s)', 'warn') +
        `event: error\ndata: ${JSON.stringify({ error: 'the logs backend is not answering at http://victorialogs:9428' })}\n\n`
    );
    const record = lineOf(frames[0]!);
    expect(record).toMatchObject({ actor: 'webcrawl', level: 'warn', machine: 'demo' });
    expect(record?.msg).toBe('crawl: page 3/10, +18 event(s)');
    expect(errorOf(frames[0]!)).toBeNull();
    expect(errorOf(frames[1]!)).toContain('victorialogs:9428');
  });

  it('answers null for a malformed log frame rather than throwing into the read loop', () => {
    const { frames } = readFrames('event: log\ndata: {not json\n\n');
    expect(lineOf(frames[0]!)).toBeNull();
  });
});

describe('the per-actor colour', () => {
  it('is the same every time, which is the entire reason it exists', () => {
    const first = actorStyle('desync');
    for (let i = 0; i < 50; i++) expect(actorStyle('desync')).toEqual(first);
    // Stability ACROSS SESSIONS is what the hash buys; pin the value so a "harmless" change to the
    // mixing function has to be a deliberate one. Every operator's muscle memory is this number.
    expect(hashActor('desync') % SLOTS).toBe(6);
    expect(first.color).toBe('oklch(0.85 0.13 205)');
    // Thirty-six, not twenty-four. The widening is recorded here because it is the one change that
    // silently repaints a fleet, and it was made for a measured reason — see the next test.
    expect(SLOTS).toBe(36);
  });

  it('lands inside the palette for anything at all, including an actorless control-plane line', () => {
    for (const name of ['', 'desync', 'a', 'a'.repeat(400), '💥', 'kontra-desync-121']) {
      const style = actorStyle(name);
      expect(style.slot, name).toBeGreaterThanOrEqual(0);
      expect(style.slot, name).toBeLessThan(SLOTS);
      expect(HUES, name).toContain(style.hue);
      expect(style.color, name).toMatch(/^oklch\(0\.\d+ 0\.13 \d+\)$/);
    }
  });

  it('SEPARATES desync, webcrawl AND probe — the regression that widened the palette', () => {
    // THIS IS WHY THERE ARE THIRTY-SIX SLOTS. At twenty-four, `desync` and `probe` both hashed to
    // slot 6: three actors live on the real cluster, two colours on screen, which defeats the only
    // thing the colour is for. Found by screenshotting the actual fleet — a generator with four
    // invented actor names never produced it. Pinned so the palette cannot narrow back.
    const live = ['desync', 'webcrawl', 'probe'];
    const swatches = live.map((a) => actorStyle(a).color);
    expect(new Set(swatches).size, swatches.join(' ')).toBe(3);
    expect(actorStyle('probe').color).not.toBe(actorStyle('desync').color);
  });

  it('separates the actors this fleet actually runs', () => {
    // The demo above is not the point; these are the emitters an operator reads interleaved, and a
    // palette that collides on THEM is a palette that fails at the only job it has.
    const fleet = ['desync', 'webcrawl', 'nuclei', 'subfinder'];
    const swatches = fleet.map((a) => actorStyle(a).color);
    expect(new Set(swatches).size).toBe(fleet.length);
    // And the hues are far enough apart to tell apart, not merely unequal.
    const hues = fleet.map((a) => actorStyle(a).hue).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i++) expect(hues[i]! - hues[i - 1]!).toBeGreaterThanOrEqual(30);
  });

  it('COLLIDES, deterministically, and that is the documented trade', () => {
    // Twenty-four slots and a hash: by the birthday bound, collisions exist. Asserting one rather
    // than pretending otherwise is the point — the alternative designs all make an actor's colour
    // depend on which OTHER actors are present, which destroys the property tested above.
    const seen = new Map<number, string>();
    let collision: [string, string] | null = null;
    for (let i = 0; i < 400 && !collision; i++) {
      const name = `actor-${String(i)}`;
      const slot = actorStyle(name).slot;
      const prior = seen.get(slot);
      if (prior) collision = [prior, name];
      else seen.set(slot, name);
    }
    expect(collision).not.toBeNull();
    const [a, b] = collision!;
    expect(actorStyle(a).color).toBe(actorStyle(b).color);
    // Deterministic: the same pair collides on the next run, so a screenshot of it is reproducible.
    expect(actorStyle(a).slot).toBe(actorStyle(b).slot);
  });

  it('uses every lightness tier, or two thirds of the palette is decoration', () => {
    const lights = new Set<number>();
    for (let i = 0; i < 300; i++) lights.add(actorStyle(`n${String(i)}`).lightness);
    expect([...lights].sort((a, b) => a - b)).toEqual([0.62, 0.72, 0.85]);
  });

  it('keeps the darkest tier above the contrast floor', () => {
    // 0.62 is the FLOOR, measured rather than chosen: against `--bg` (#0b0f14) it is 4.93:1 and
    // 0.58 is 4.18:1, which fails the 4.5:1 minimum for body text. A fourth tier cannot be added
    // below this without failing a reader, and this is what says so out loud.
    const tiers = new Set<number>();
    for (let i = 0; i < 300; i++) tiers.add(actorStyle(`n${String(i)}`).lightness);
    expect(Math.min(...tiers)).toBeGreaterThanOrEqual(0.62);
  });
});

describe('the buffer', () => {
  const rec = (msg: string): { ts: number; level: 'info'; msg: string; runId: string } => ({
    ts: 1,
    level: 'info',
    msg,
    runId: '',
  });

  it('appends oldest-last and numbers every line, because ts+msg is not unique', () => {
    const a = appendLines([], [rec('one'), rec('one')], 0);
    expect(a.lines.map((l) => l.msg)).toEqual(['one', 'one']);
    expect(a.lines.map((l) => l.seq)).toEqual([0, 1]);
    expect(a.nextSeq).toBe(2);
    expect(a.dropped).toBe(0);

    const b = appendLines(a.lines, [rec('two')], a.nextSeq);
    expect(b.lines.map((l) => l.seq)).toEqual([0, 1, 2]);
  });

  it('drops from the FRONT at the cap and says how many, so the top is not mistaken for the start', () => {
    const seed: StreamLine[] = [0, 1, 2].map((n) => ({ ...rec(`old-${String(n)}`), seq: n }));
    const out = appendLines(seed, [rec('new')], 3, 3);
    expect(out.lines.map((l) => l.msg)).toEqual(['old-1', 'old-2', 'new']);
    expect(out.dropped).toBe(1);
  });

  it('keeps a tail worth scrolling', () => {
    expect(MAX_LINES).toBeGreaterThanOrEqual(5_000);
  });
});

describe('follow and pause', () => {
  const at = (scrollTop: number): { scrollTop: number; scrollHeight: number; clientHeight: number } => ({
    scrollTop,
    scrollHeight: 10_000,
    clientHeight: 800,
  });

  it('follows at the bottom and stops when the reader scrolls up', () => {
    expect(shouldFollow(at(9_200))).toBe(true);
    expect(shouldFollow(at(4_000))).toBe(false);
  });

  it('tolerates the few pixels sub-pixel layout leaves behind', () => {
    // An exact test drops out of follow mode while the user does nothing, which is the bug this
    // slack exists for.
    expect(atBottom(at(9_200 - (FOLLOW_SLACK_PX - 1)))).toBe(true);
    expect(atBottom(at(9_200 - (FOLLOW_SLACK_PX + 1)))).toBe(false);
  });

  it('resumes when the reader scrolls back down — no flag to un-stick', () => {
    expect(shouldFollow(at(1_000))).toBe(false);
    expect(shouldFollow(at(9_200))).toBe(true);
  });

  it('follows a scroller too short to scroll', () => {
    expect(shouldFollow({ scrollTop: 0, scrollHeight: 300, clientHeight: 800 })).toBe(true);
  });
});

describe('the backoff', () => {
  it('starts at a second, doubles, and stops at the cap', () => {
    expect(nextBackoff(0)).toBe(BACKOFF_START_MS);
    expect(nextBackoff(BACKOFF_START_MS)).toBe(2_000);
    expect(nextBackoff(8_000)).toBe(BACKOFF_CAP_MS);
    expect(nextBackoff(BACKOFF_CAP_MS)).toBe(BACKOFF_CAP_MS);
  });
});

describe('the backfill', () => {
  const lines = (...objs: object[]): string => objs.map((o) => JSON.stringify(o)).join('\n');

  it('reverses the newest-first answer, because a terminal reads downward', async () => {
    const fake = vi.fn(async () =>
      new Response(
        lines(
          { _time: '2026-09-20T01:00:03Z', _msg: 'third', actor: 'a' },
          { _time: '2026-09-20T01:00:02Z', _msg: 'second', actor: 'a' },
          { _time: '2026-09-20T01:00:01Z', _msg: 'first', actor: 'a' }
        ),
        { status: 200 }
      )
    );
    const out = await backfill('*', 200, fake as unknown as typeof fetch);
    expect(out.error).toBeNull();
    expect(out.lines.map((l) => l.msg)).toEqual(['first', 'second', 'third']);
    expect(String(fake.mock.calls[0]![0])).toContain('/api/logs/query?query=*&limit=200');
  });

  it('keeps the rest when one line is malformed', async () => {
    const fake = async (): Promise<Response> =>
      new Response(`{"_msg":"good","_time":"2026-09-20T01:00:01Z"}\n{ broken\n`, { status: 200 });
    const out = await backfill('*', 10, fake as unknown as typeof fetch);
    expect(out.lines.map((l) => l.msg)).toEqual(['good']);
  });

  it('REPEATS THE SERVER\'S SENTENCE on a 503 rather than answering an empty list', async () => {
    // An empty list here renders as "nothing has been logged", which is a different fact about the
    // world from "the logs backend is down" — and `routes/logs.ts::unreachable` exists to tell them
    // apart. Paraphrasing throws away the only useful part of the response.
    const sentence =
      'the logs backend is not answering at http://victorialogs:9428 — this is not "no logs".';
    const fake = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: sentence }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    const out = await backfill('*', 10, fake as unknown as typeof fetch);
    expect(out.lines).toEqual([]);
    expect(out.error).toBe(sentence);
  });
});

describe('joining the backfill to the frames held while it ran', () => {
  const at = (ts: number, msg: string): { ts: number; level: 'info'; msg: string; runId: string } => ({
    ts,
    level: 'info',
    msg,
    runId: '',
  });

  it('is just the backfill when nothing arrived meanwhile', () => {
    expect(mergeBackfill([at(1, 'a'), at(2, 'b')], []).map((r) => r.msg)).toEqual(['a', 'b']);
  });

  it('truncates the backfill at the first held line — the overlap is ONE event, not two', () => {
    // A line written after the query was issued and before it answered is in both answers.
    // Rendering it twice turns one `baseline not reproducible` into two, and counting incidents off
    // a log is a thing operators do.
    const backfilled = [at(1, 'old'), at(5, 'overlap'), at(6, 'overlap-2')];
    const held = [at(5, 'overlap'), at(7, 'live')];
    expect(mergeBackfill(backfilled, held).map((r) => r.msg)).toEqual(['old', 'overlap', 'live']);
  });

  it('does not collapse two genuinely repeated lines, which content-matching would', () => {
    const backfilled = [at(1, 'batch 4/12 — 200 units resolved'), at(2, 'batch 4/12 — 200 units resolved')];
    expect(mergeBackfill(backfilled, [at(9, 'later')])).toHaveLength(3);
  });
});

describe('the tail', () => {
  /** A response whose body is a stream we push into, so a frame can be split at any byte. */
  function streaming(chunks: string[]): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('delivers records, and one split across two reads arrives once and whole', async () => {
    const whole = frame('desync', 'screen lane 1/1: page 2/3 (+42 observation(s))');
    const split = frame('nuclei', 'corpus shard 12/32: 385 technique(s)');
    const cut = Math.floor(split.length / 2);
    const got: string[] = [];
    const phases: string[] = [];
    const stop = openTail(
      '*',
      {
        onlines: (rs) => got.push(...rs.map((r) => r.msg)),
        onphase: (p) => phases.push(p),
        onerror: () => expect.unreachable('a clean stream must not report an error'),
      },
      {
        fetchImpl: (async () => streaming([whole + split.slice(0, cut), split.slice(cut)])) as unknown as typeof fetch,
        setTimeoutImpl: () => undefined, // never let the reconnect fire inside the test
      }
    );
    await vi.waitFor(() => expect(got).toHaveLength(2));
    stop();
    expect(got).toEqual([
      'screen lane 1/1: page 2/3 (+42 observation(s))',
      'corpus shard 12/32: 385 technique(s)',
    ]);
    expect(phases.slice(0, 2)).toEqual(['connecting', 'live']);
  });

  it('asks the route for the query it was given', async () => {
    const seen: string[] = [];
    const stop = openTail(
      'actor:"desync"',
      { onlines: () => {}, onphase: () => {}, onerror: () => {} },
      {
        fetchImpl: (async (url: string) => {
          seen.push(url);
          return streaming([]);
        }) as unknown as typeof fetch,
        setTimeoutImpl: () => undefined,
      }
    );
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    stop();
    expect(seen[0]).toBe(`/api/logs/tail?query=${encodeURIComponent('actor:"desync"')}`);
  });

  it('reads a plain JSON refusal as a refusal, not as a quiet stream', async () => {
    // `admit` answers through Fastify with `application/json`; the route's own failures answer with
    // stream headers. Reading the first as SSE yields zero frames and looks like a healthy, silent
    // backend — which is the exact confusion this surface is supposed to end.
    const said: string[] = [];
    const stop = openTail(
      '*',
      { onlines: () => {}, onphase: () => {}, onerror: (s) => said.push(s) },
      {
        fetchImpl: (async () =>
          new Response(JSON.stringify({ error: 'logs: unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch,
        setTimeoutImpl: () => undefined,
      }
    );
    await vi.waitFor(() => expect(said).toEqual(['logs: unauthorized']));
    stop();
  });

  it('reports an error FRAME and keeps the connection it arrived on', async () => {
    const said: string[] = [];
    const stop = openTail(
      '*',
      { onlines: () => {}, onphase: () => {}, onerror: (s) => said.push(s) },
      {
        fetchImpl: (async () =>
          streaming([`event: error\ndata: ${JSON.stringify({ error: 'logs backend refused the tail' })}\n\n`])) as unknown as typeof fetch,
        setTimeoutImpl: () => undefined,
      }
    );
    await vi.waitFor(() => expect(said).toEqual(['logs backend refused the tail']));
    stop();
  });

  it('reconnects with backoff when the server closes, and stops when torn down', async () => {
    const opens: number[] = [];
    const waits: number[] = [];
    let fire: (() => void) | null = null;
    const stop = openTail(
      '*',
      { onlines: () => {}, onphase: () => {}, onerror: () => {} },
      {
        fetchImpl: (async () => {
          opens.push(Date.now());
          return streaming([]); // opens, says nothing, closes
        }) as unknown as typeof fetch,
        setTimeoutImpl: (fn, ms) => {
          waits.push(ms);
          fire = fn;
          return 1;
        },
      }
    );
    await vi.waitFor(() => expect(waits).toEqual([BACKOFF_START_MS]));
    fire!();
    await vi.waitFor(() => expect(opens).toHaveLength(2));
    await vi.waitFor(() => expect(waits).toEqual([BACKOFF_START_MS, 2_000]));

    // TEARDOWN IS NOT ADVISORY. Each open tail holds an upstream tail on the orchestrator, so a
    // surface that leaks one leaks it on the server.
    stop();
    fire!();
    await new Promise((r) => setTimeout(r, 5));
    expect(opens).toHaveLength(2);
  });
});
