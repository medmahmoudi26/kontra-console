import { describe, expect, it } from 'vitest';

import { cycle, label } from './toggle';
import { missing, payloadOf } from './payload';

describe('the three-state toggle', () => {
  it('reaches false, which the React console could not', () => {
    // THE BUG THIS EXISTS FOR. Nested ternaries made the `false` arm unreachable, so `True`
    // rendered as `not set` and no sequence of clicks produced `false`.
    expect(cycle(true, false)).toBe(false);
    expect(label(false)).toBe('false');
  });

  it('returns to unset for an optional field and to true for a required one', () => {
    expect(cycle(false, false)).toBeUndefined(); // optional: the author's default applies again
    expect(cycle(false, true)).toBe(true); //        required: there is no unset to return to
  });

  it('cycles through all three for an optional field, and back', () => {
    let v = cycle(undefined, false);
    const seen = [v];
    for (let i = 0; i < 2; i += 1) { v = cycle(v, false); seen.push(v); }
    expect(seen).toEqual([true, false, undefined]);
  });

  it('never leaves a required field unset', () => {
    let v: ReturnType<typeof cycle> = undefined;
    for (let i = 0; i < 6; i += 1) {
      v = cycle(v, true);
      if (i > 0) expect(v, `click ${i}`).not.toBeUndefined();
    }
  });

  it('says `not set` rather than nothing', () => {
    // A blank here reads as a rendering failure, and the state it is hiding is the one most likely
    // to be assumed wrongly.
    expect(label(undefined)).toBe('not set');
  });
});

describe('the payload', () => {
  it('omits absent values but keeps false', () => {
    const p = payloadOf({ host: 'example.com', mode: undefined, verbose: false, note: '' });
    expect(p).toEqual({ host: 'example.com', verbose: false });
  });

  it('names the required fields that are missing', () => {
    expect(missing(['host', 'mode'], { host: 'x' })).toEqual(['mode']);
    expect(missing(['host'], { host: 'x' })).toEqual([]);
  });

  it('carries a blob as a ref, never as bytes', () => {
    const ref = { name: 'w.txt', sha256: '2c26b46b68', size: 41203 };
    const p = payloadOf({ wordlist: ref });
    expect(p['wordlist']).toBe(ref);
    expect(JSON.stringify(p).length).toBeLessThan(200);
  });
});
