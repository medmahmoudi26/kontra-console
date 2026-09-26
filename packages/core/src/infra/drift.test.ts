import { describe, expect, it } from 'vitest';

import {
  DRIFT_STATES,
  driftOf,
  driftWord,
  imageKey,
  parsePinned,
  shortDigest,
  type ResolvedImage,
} from './drift';

/**
 * Registry drift, and the one answer this module must never give: drift it inferred from no evidence.
 *
 * THE REFS ARE IN THE SHAPE THE SYSTEM ACTUALLY PRODUCES. `activities/fleet.ts:resolveWorkerImage`
 * returns `<advertised>/<actor>@sha256:<hex>` where `advertised` is `KONTRA_REGISTRY` with the scheme
 * stripped — on this installation `127.0.0.1:5000` (`dockerFleet.ts:62`). The colon in that host is
 * the reason {@link parsePinned} splits on the LAST `@` and not on a `host:port/name:tag` pattern, and
 * a fixture written as `canary@sha256:…` would never have exercised it.
 */

const REPO = '127.0.0.1:5000/canary';
const PINNED = `sha256:${'a'.repeat(64)}`;
const NEWER = `sha256:${'b'.repeat(64)}`;
const IMAGE = `${REPO}@${PINNED}`;

describe('parsing a pinned reference', () => {
  it('splits a registry host:port repo from its digest', () => {
    expect(parsePinned(IMAGE)).toEqual({ repo: REPO, digest: PINNED });
  });

  it('refuses a tag, an unpinned name and a short digest — exactly what dockerFleet refuses', () => {
    // `dockerFleet.ts:126` tests `/@sha256:[a-f0-9]{64}$/` and refuses the converge otherwise. This
    // console must reach the same verdict about the same string.
    expect(parsePinned('127.0.0.1:5000/canary:0.1.1')).toBeUndefined();
    expect(parsePinned('127.0.0.1:5000/canary')).toBeUndefined();
    expect(parsePinned(`${REPO}@sha256:abc`)).toBeUndefined();
    expect(parsePinned(`${REPO}@sha512:${'a'.repeat(64)}`)).toBeUndefined();
    // Uppercase hex is not what any registry emits, and accepting it would make two spellings of one
    // digest compare unequal.
    expect(parsePinned(`${REPO}@sha256:${'A'.repeat(64)}`)).toBeUndefined();
    expect(parsePinned(`@${PINNED}`)).toBeUndefined();
    expect(parsePinned('')).toBeUndefined();
  });

  it('shortens to the twelve hex an operator compares by eye, keeping the algorithm', () => {
    expect(shortDigest(PINNED)).toBe('sha256:aaaaaaaaaaaa');
    expect(shortDigest('a'.repeat(64))).toBe('sha256:aaaaaaaaaaaa');
  });
});

describe('the four states', () => {
  it('names them all and gives each a word without jargon', () => {
    expect(DRIFT_STATES).toEqual(['current', 'drifted', 'unknown', 'unpinned']);
    expect(DRIFT_STATES.map(driftWord)).toEqual(['current', 'drifted', 'unknown', 'not digest-pinned']);
  });
});

describe('a Placement with no container image says nothing at all', () => {
  it('is undefined for an absent image, so the drawing draws no row', () => {
    // A DigitalOcean Fleet's Workers run natively off a Bundle (`fleet.ts:65`): there is no container
    // digest and no tag to re-resolve. An absent fact draws no row rather than an empty one.
    expect(driftOf(undefined, '0.1.1', { image: `${REPO}@${NEWER}` })).toBeUndefined();
    expect(driftOf('', '0.1.1', { image: `${REPO}@${NEWER}` })).toBeUndefined();
  });
});

describe('a registry that cannot be reached is unknown, never drift', () => {
  /** Every way the answer can be missing. `resolveWorkerImage` fails SOFT — it returns `''` after
   *  trying every base — so the empty case is the COMMON one, not an exceptional one. */
  const nothing: Array<[string, ResolvedImage | undefined]> = [
    ['nobody asked', undefined],
    ['the read failed', { error: 'the control plane did not answer' }],
    ['the resolver gave up on every base', { image: '' }],
    ['the field is absent', {}],
    ['the answer is not a digest-pinned ref', { image: '127.0.0.1:5000/canary:0.1.1' }],
  ];

  for (const [why, resolved] of nothing) {
    it(`is unknown when ${why}`, () => {
      const d = driftOf(IMAGE, '0.1.1', resolved);
      expect(d?.state).toBe('unknown');
      // THE ACCEPTANCE CRITERION, ASSERTED DIRECTLY. A registry timeout rendered as drift sends an
      // operator to re-deploy a Fleet that is running exactly the code they think it is.
      expect(d?.state).not.toBe('drifted');
      // The pinned digest is still named — that half IS known, exactly, from the checkpoint.
      expect(d?.pinned).toBe(PINNED);
      // And no second digest is invented for a state that has none.
      expect(d?.now).toBeUndefined();
    });
  }

  it('repeats the read error verbatim rather than paraphrasing it', () => {
    // `load.ts:why` already turned the status into the sentence that names the fix; restating it here
    // would be a second vocabulary for the same failure.
    const d = driftOf(IMAGE, '0.1.1', { error: 'this control plane does not serve that route' });
    expect(d?.why).toBe('this control plane does not serve that route');
  });

  it('names the tag it could not resolve, so the sentence is actionable', () => {
    expect(driftOf(IMAGE, '0.1.1', { image: '' })?.tag).toBe('127.0.0.1:5000/canary:0.1.1');
    expect(driftOf(IMAGE, '0.1.1', { image: '' })?.why).toContain('127.0.0.1:5000/canary:0.1.1');
  });
});

describe('the comparison itself', () => {
  it('is current when the tag still resolves to the digest on the Machine', () => {
    const d = driftOf(IMAGE, '0.1.1', { image: IMAGE });
    expect(d?.state).toBe('current');
    expect(d?.pinned).toBe(PINNED);
    expect(d?.now).toBe(PINNED);
  });

  it('is drifted when they differ, and NAMES BOTH DIGESTS', () => {
    const d = driftOf(IMAGE, '0.1.1', { image: `${REPO}@${NEWER}` });
    expect(d?.state).toBe('drifted');
    // Both, in full, because "flagged, naming both digests" means both must be copyable into a
    // `docker pull`. The sentence carries the short form for reading.
    expect(d?.pinned).toBe(PINNED);
    expect(d?.now).toBe(NEWER);
    expect(d?.why).toContain(shortDigest(PINNED));
    expect(d?.why).toContain(shortDigest(NEWER));
    expect(d?.why).toContain('127.0.0.1:5000/canary:0.1.1');
  });

  it('compares the digest and not the whole ref, so a re-advertised registry is not drift', () => {
    // The Controller may advertise itself as `registry:5000` to a container and `127.0.0.1:5000` to the
    // host — `resolveWorkerImage` tries three bases for exactly that reason. Same bytes, same code.
    const d = driftOf(IMAGE, '0.1.1', { image: `registry:5000/canary@${PINNED}` });
    expect(d?.state).toBe('current');
  });
});

describe('an image the Fleet program would refuse', () => {
  it('is its own state, and it is not unknown', () => {
    // A checkpoint holding a tag means it predates `dockerFleet.ts:126` or came from a program that
    // does not refuse. An unknown digest is the registry's fault and there is nothing to do from here;
    // this one has a fix, and calling both "unknown" hides which.
    const d = driftOf('127.0.0.1:5000/canary:0.1.1', '0.1.1', { image: `${REPO}@${NEWER}` });
    expect(d?.state).toBe('unpinned');
    expect(d?.why).toContain('repo@sha256:<64 hex>');
    // No comparison is attempted, so neither digest is claimed.
    expect(d?.pinned).toBeUndefined();
    expect(d?.now).toBeUndefined();
  });
});

describe('the tag the two halves agree on', () => {
  it('falls back to the bare repo when the Placement carries no version', () => {
    // `resolveWorkerImage` asked `/v2/<actor>/manifests/<version>`; with no version there is no tag to
    // name, and `repo:` with nothing after the colon is not a reference anything can pull.
    expect(driftOf(IMAGE, '', { image: '' })?.tag).toBe(REPO);
  });

  it('keys a resolve the same way on both sides of the seam', () => {
    // One function so `load.ts` and `deriveMachines` cannot spell it differently — a key composed
    // independently in each is the shape that silently produces `unknown` everywhere.
    expect(imageKey('canary', '0.1.1')).toBe('canary@0.1.1');
    expect(imageKey('canary', '')).toBe('canary@');
  });
});
