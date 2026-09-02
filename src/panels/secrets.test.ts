/**
 * What the Settings surface derives about a secret, and the two confirmations before something is
 * destroyed. Pure functions, so this is the whole state space without a DOM.
 */

import { describe, expect, it } from 'vitest';

import {
  SECRET_NAME_RE,
  destroyConfirm,
  nameHint,
  revocationConfirm,
  secretState,
  summarise,
  toRows,
  versionRows,
} from './secrets';
import type { Secret } from '../run/api';

const AUG = (day: number): number => Date.UTC(2026, 7, day, 12, 0, 0);

const oneVersion: Secret = {
  name: 'shodan-key',
  createdAt: AUG(20),
  updatedAt: AUG(20),
  versions: [{ version: 1, createdAt: AUG(20) }],
  current: 1,
};

const rotated: Secret = {
  name: 'shodan-key',
  createdAt: AUG(20),
  updatedAt: AUG(24),
  versions: [
    { version: 1, createdAt: AUG(20) },
    { version: 2, createdAt: AUG(24) },
  ],
  current: 2,
};

const revoked: Secret = {
  name: 'shodan-key',
  createdAt: AUG(20),
  updatedAt: AUG(25),
  versions: [{ version: 1, createdAt: AUG(20), revokedAt: AUG(25) }],
};

describe('the version vocabulary', () => {
  it('tells current from superseded from revoked', () => {
    // SUPERSEDED IS NOT REVOKED, and the distinction is the whole reason rotation is safe: the
    // version before the newest keeps working until somebody revokes it. A page that showed both
    // as "old" would teach an operator that rotating breaks whatever is in flight.
    expect(versionRows(rotated).map((v) => [v.version, v.state])).toEqual([
      [2, 'current'],
      [1, 'superseded'],
    ]);
    expect(versionRows(revoked)[0]?.state).toBe('revoked');
  });

  it('says a secret with every version revoked is unusable', () => {
    expect(secretState(rotated)).toBe('live');
    expect(secretState(revoked)).toBe('unusable');
  });

  it('dates a version the same way in every timezone', () => {
    expect(versionRows(oneVersion)[0]?.created).toBe('2026-08-20');
  });
});

describe('the line under a name', () => {
  it('names the live version and when it last moved, never "set"', () => {
    expect(summarise(oneVersion)).toBe('version 1 · 1 version · updated 2026-08-20');
    expect(summarise(rotated)).toBe('version 2 · 2 versions · updated 2026-08-24');
  });

  it('says plainly when there is nothing left to resolve', () => {
    expect(summarise(revoked)).toContain('every version revoked');
  });
});

describe('rows for the list', () => {
  it('separates an actor secret from an operator one, because they resolve differently', () => {
    const [operator, owned] = toRows([oneVersion, { ...rotated, name: 'do-token', owner: 'actor:probe' }]);
    expect(operator?.scope).toBe('operator');
    expect(owned?.scope).toBe('actor');
    expect(owned?.owner).toBe('actor:probe');
  });
});

describe('the name rule', () => {
  /**
   * WHAT THIS REPLACES. The test here read `backend/src/secrets/store.ts`, pulled its
   * `SECRET_NAME_RE` literal out with a regex, and asserted the two spellings matched — the only
   * check available while the browser kept its own copy. There is one declaration now
   * (`@kontra/core/secrets`), so there is nothing left to compare and nothing left to drift.
   *
   * The rule itself is still worth asserting, because it is a SHARED one: a change here changes
   * what the store accepts, which is the sort of edit that looks local and is not.
   */
  it('is the shared rule, so what the form accepts is what the store accepts', () => {
    expect(SECRET_NAME_RE.test('do-token')).toBe(true);
    expect(SECRET_NAME_RE.test('shodan.key_2')).toBe(true);
    expect(SECRET_NAME_RE.test('DO_TOKEN')).toBe(false); // uppercase
    expect(SECRET_NAME_RE.test('-leading')).toBe(false); // opens with punctuation
    expect(SECRET_NAME_RE.test('has spaces')).toBe(false);
    expect(SECRET_NAME_RE.test('a'.repeat(65))).toBe(false); // bounded at 64
  });

  it('names the mistake that would make two secrets look like one', () => {
    expect(nameHint('DO_TOKEN')).toContain('lowercase');
    expect(nameHint('do-token')).toBeNull();
    expect(nameHint('')).toBeNull(); // an empty field is not yet a mistake
    expect(nameHint('has spaces')).toContain('digits');
  });
});

describe('before something is destroyed', () => {
  it('says what revoking costs, and what is left afterwards', () => {
    const withFallback = revocationConfirm({ name: 'shodan-key', version: 2, fallback: 1 });
    expect(withFallback).toContain('Revoke version 2 of "shodan-key"?');
    expect(withFallback).toContain('destroys the stored value');
    expect(withFallback).toContain('fall back to version 1');

    // The click that leaves a secret with nothing to resolve must not read the same as the one
    // that rolls a bad rotation back.
    const last = revocationConfirm({ name: 'shodan-key', version: 1 });
    expect(last).toContain('NO usable version');
    expect(last).not.toContain('fall back');
  });

  it('names every version a delete takes, and who loses access', () => {
    const msg = destroyConfirm({ name: 'shodan-key', versions: 3, owner: 'actor:probe' });
    expect(msg).toContain('All 3 versions');
    expect(msg).toContain('actor:probe');
    expect(msg).toContain('cannot be recovered');
    expect(destroyConfirm({ name: 'x', versions: 1 })).toContain('Its only version goes with it');
  });
});
