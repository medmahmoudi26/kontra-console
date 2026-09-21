import { describe, expect, it } from 'vitest';

import { payloadOf } from './payload';

describe('payloadOf: declared types', () => {
  // THE BUG THIS PINS. An HTML input holds a string. Passed through verbatim, a declared
  // `machines: int` left the browser as `"2"` and Temporal refused it on the way into the
  // workflow — `Failed converting value for key 'machines'`, then `Failed decoding arguments`,
  // then a wedged workflow task that a subscriber only ever sees as `Workflow Update failed`.
  // It applied to every workflow in the catalog with a numeric input.
  const types = new Map([
    ['units', 'integer'],
    ['seconds', 'number'],
    ['attach', 'boolean'],
    ['program', 'string'],
  ]);

  it('coerces each value to the type the workflow declared', () => {
    expect(
      payloadOf({ units: '40', seconds: '4.0', attach: 'true', program: 'visa' }, types)
    ).toEqual({ units: 40, seconds: 4, attach: true, program: 'visa' });
  });

  it('is unchanged when no types are supplied', () => {
    // The dev pane calls this without a schema, and must keep behaving exactly as before.
    expect(payloadOf({ units: '40' })).toEqual({ units: '40' });
  });

  it('keeps a value that will not coerce rather than dropping the key', () => {
    // Dropping it would start the run on the AUTHOR'S DEFAULT instead of what was typed, which is
    // the worse of the two wrong answers: the form already renders the per-field error.
    expect(payloadOf({ units: 'ten' }, types)).toEqual({ units: 'ten' });
  });

  it('leaves a boolean alone — it never was a string', () => {
    expect(payloadOf({ attach: true }, types)).toEqual({ attach: true });
  });
});
