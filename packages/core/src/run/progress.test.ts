import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  describeField,
  emptyProgress,
  eta,
  liveNodes,
  orderedFields,
  splitTopic,
  topicsOf,
  unitsOf,
  type ProgressEvent,
} from './progress';

const ev = (offset: number, topic: string, data: Record<string, unknown>): ProgressEvent => ({
  offset,
  topic,
  data,
});

describe('splitTopic', () => {
  it('splits an actor/method topic', () => {
    expect(splitTopic('webcrawl/crawl')).toEqual({ actor: 'webcrawl', method: 'crawl' });
  });

  it('treats a topic with no slash as a workflow, not an actor', () => {
    // A workflow is not an actor and has no method. Empty strings keep one shape for both rather
    // than a union every caller has to unpack.
    expect(splitTopic('progress')).toEqual({ actor: '', method: '' });
  });

  it('keeps a method containing a slash intact', () => {
    expect(splitTopic('a/b/c')).toEqual({ actor: 'a', method: 'b/c' });
  });
});

describe('applyEvent: topics are separate streams', () => {
  it('does not let an actor topic overwrite the workflow topic', () => {
    // THE BUG THIS PINS. Both publishers used to fold into one flat state, so the actor's
    // per-Batch `done: 1/2` overwrote the workflow's run-wide `done: 10/40` and the bar jumped
    // between a batch's denominator and the run's on every other record.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'progress', { phase: 'tick', done: 10, total: 40 }), 0);
    p = applyEvent(p, ev(1, 'canary/tick', { label: 'unit-3', done: 1, total: 2, node: 'n1' }), 0);

    expect(p.topics['progress'].done).toBe(10);
    expect(p.topics['progress'].total).toBe(40);
    expect(p.topics['canary/tick'].done).toBe(1);
    expect(p.topics['canary/tick'].total).toBe(2);
  });

  it('carries a field the framework has never heard of', () => {
    // THE POINT OF THE MODEL. A scraper has a subreddit, a registry monitor a repo, a bug-bounty
    // sweep a program. The framework reserves at/done/total and nothing else. An earlier version
    // declared `program` here, which made every other workspace either lie or go undescribed.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'reddit/scrape', { subreddit: 'askhistorians', posts: 412, done: 3 }), 0);
    expect(p.topics['reddit/scrape'].fields).toEqual({ subreddit: 'askhistorians', posts: 412 });
    expect(p.topics['reddit/scrape'].done).toBe(3);
  });

  it('remembers a field a later record stops mentioning', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { repo: 'library/nginx', done: 1 }), 0);
    p = applyEvent(p, ev(1, 'x/y', { done: 2 }), 0);
    expect(p.topics['x/y'].fields.repo).toBe('library/nginx');
  });

  it('does not make a card out of engine plumbing', () => {
    // `node` and `actor` are added by the engine for routing; they belong in the worker roster.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { actor: 'abc', node: 'n1', repo: 'r', done: 1 }), 0);
    expect(p.topics['x/y'].fields).toEqual({ repo: 'r' });
    expect(p.topics['x/y'].nodes['n1'].node).toBe('n1');
  });

  it('keeps several workers on ONE topic rather than splitting it', () => {
    // Six crawlers doing the same job are one stream with six voices.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'webcrawl/crawl', { node: 'a', at: 'https://one' }), 0);
    p = applyEvent(p, ev(1, 'webcrawl/crawl', { node: 'b', at: 'https://two' }), 0);
    expect(Object.keys(p.topics)).toEqual(['webcrawl/crawl']);
    expect(Object.keys(p.topics['webcrawl/crawl'].nodes).sort()).toEqual(['a', 'b']);
  });

  it('never moves the offset backwards', () => {
    // A replay from offset 0 after a reconnect must not rewind the high-water mark.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(9, 'x/y', { done: 1 }), 0);
    p = applyEvent(p, ev(2, 'x/y', { done: 1 }), 0);
    expect(p.offset).toBe(9);
  });

  it('files a record with no topic under the workflow topic', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, '', { done: 1 }), 0);
    expect(Object.keys(p.topics)).toEqual(['progress']);
  });
});

describe('topicsOf', () => {
  it('puts the workflow first, then actors alphabetically', () => {
    // The workflow leads because it is the only publisher that knows the whole run.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'zeta/run', {}), 0);
    p = applyEvent(p, ev(1, 'alpha/run', {}), 0);
    p = applyEvent(p, ev(2, 'progress', {}), 0);
    expect(topicsOf(p).map((t) => t.topic)).toEqual(['progress', 'alpha/run', 'zeta/run']);
  });
});

describe('liveNodes', () => {
  it('keeps a worker that published within a slow unit', () => {
    // THE BUG THIS PINS. The cutoff was 7s, tuned for a 2-second polled beat. `stream()` is
    // publish-driven — one record per unit — so a 16-second unit emptied the roster between
    // records and the pane said "no worker has beaten" about a worker that was working.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { node: 'n1', at: 'unit-1' }), 0);
    expect(liveNodes(p.topics['x/y'], 16_000)).toHaveLength(1);
  });

  it('drops a worker that has genuinely gone', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { node: 'n1', at: 'unit-1' }), 0);
    expect(liveNodes(p.topics['x/y'], 120_000)).toHaveLength(0);
  });
});

describe('eta', () => {
  it('refuses to guess from a single unit', () => {
    // The first unit carries the session load and the handshakes the rest reuse — the least
    // representative sample there is.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { done: 1, total: 60 }), 1_000);
    expect(eta(p.topics['x/y'], p, 10_000).remainingMs).toBeNull();
  });

  it('estimates once a rate exists', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { done: 10, total: 60 }), 0);
    expect(eta(p.topics['x/y'], p, 10_000).remainingMs).toBe(50_000);
  });

  it('is null when nothing has declared a total', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { done: 5 }), 0);
    expect(eta(p.topics['x/y'], p, 10_000).remainingMs).toBeNull();
  });
});

describe('orderedFields', () => {
  const schema = {
    properties: {
      label: { type: 'string', description: 'the unit being worked' },
      slept: { type: 'number' },
      done: { type: 'integer' },
    },
  };

  it('uses the order the author DECLARED, not alphabetical', () => {
    // An author lists a progress record's fields in the order they want them read. Sorting them
    // throws that away, and `slept` before `label` reads as noise before the subject.
    const out = orderedFields({ slept: 4, label: 'unit-3' }, schema);
    expect(out.map(([k]) => k)).toEqual(['label', 'slept']);
  });

  it('appends a key the schema does not declare rather than dropping it', () => {
    // A worker may be a version ahead of the catalog. An unlabelled value beats no value.
    const out = orderedFields({ label: 'u', surprise: 1 }, schema);
    expect(out.map(([k]) => k)).toEqual(['label', 'surprise']);
  });

  it('never positions a reserved key as an author field', () => {
    // `done` is drawn as part of the bar; listing it again as a card would double it.
    const out = orderedFields({ label: 'u', done: 3 }, schema);
    expect(out.map(([k]) => k)).toEqual(['label']);
  });

  it('falls back to alphabetical with no schema', () => {
    expect(orderedFields({ b: 1, a: 2 }).map(([k]) => k)).toEqual(['a', 'b']);
  });
});

describe('unitsOf', () => {
  it('reads as a fraction when a total was declared', () => {
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'progress', { done: 16, total: 120 }), 0);
    expect(unitsOf(p.topics['progress'])).toBe('16/120');
  });

  it('reads as a bare count when only done was published', () => {
    // THE BUG THIS PINS. An actor publishes `done` and never a `total` — it knows its Batch, not
    // the run. The card and the bar were both gated on `total`, and `done` is RESERVED so it is
    // excluded from the field list too, which meant the number was swallowed at both ends.
    // Measured on canary-1789943482: both actor topics reported `done` on every record and the
    // pane showed no count at all.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'gocanary/tick', { label: 'unit-8', done: 8, slept: 4 }), 0);
    expect(unitsOf(p.topics['gocanary/tick'])).toBe('8');
  });

  it('is null when a topic has published no count', () => {
    // A stream of pure prose ("fetched <url>") has nothing to count, and "0" would be a claim.
    let p = emptyProgress(0);
    p = applyEvent(p, ev(0, 'x/y', { at: 'https://one' }), 0);
    expect(unitsOf(p.topics['x/y'])).toBeNull();
  });
});

describe('describeField', () => {
  it('returns the declared description', () => {
    expect(describeField({ properties: { a: { description: 'why' } } }, 'a')).toBe('why');
  });

  it('returns empty rather than inventing one', () => {
    expect(describeField({ properties: { a: {} } }, 'a')).toBe('');
    expect(describeField(undefined, 'a')).toBe('');
  });
});
