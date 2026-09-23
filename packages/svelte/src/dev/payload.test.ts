import { describe, expect, it } from 'vitest';

import { payloadOf, syncDefaults, type FieldValue } from './payload';

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

describe('syncDefaults', () => {
  // THE BUG THIS PINS. Both forms opened blank with the declared default in the `placeholder`.
  // Ghost text is not a value: pressing Run posted `{}` and the run only worked because the
  // workflow repeated every default a second time in `req.get(k) or 5`. A reader saw an empty
  // form and had no way to know what pressing Run would actually do.
  const leaves = [
    { name: 'steps', default: '5' },
    { name: 'every', default: '2.0' },
    { name: 'fail_on', default: '' },
    { name: 'corpus' }, // a file field — the author declared no default
  ];

  it('prefills every field the author gave a default', () => {
    const values: Record<string, FieldValue> = {};
    syncDefaults(leaves, values);
    expect(values).toEqual({ steps: '5', every: '2.0', fail_on: '' });
  });

  it('seeds a declared empty default, because `` is the author\'s answer too', () => {
    // `fail_on: str = ""` means "nothing by default", which is a decision. It is the KEY that
    // decides, never truthiness — and `payloadOf` still drops `''` on the way out, so the run
    // is started without the key rather than with an empty one.
    const values: Record<string, FieldValue> = {};
    syncDefaults(leaves, values);
    expect('fail_on' in values).toBe(true);
    expect(payloadOf(values)).toEqual({ steps: '5', every: '2.0' });
  });

  it('leaves an undeclared default absent rather than seeding an empty string', () => {
    // `undefined` and `''` are different states in `FieldValue`: a file control holding `''`
    // draws a "clear" button over an empty drop zone.
    const values: Record<string, FieldValue> = {};
    syncDefaults(leaves, values);
    expect('corpus' in values).toBe(false);
  });

  it('does not overwrite what somebody has typed', () => {
    // This runs on every contract re-read, which under `serve --watch` is every save.
    const values: Record<string, FieldValue> = { steps: '40' };
    syncDefaults(leaves, values);
    expect(values.steps).toBe('40');
  });

  it('does not refill a box that was deliberately emptied', () => {
    // Clearing a prefilled field leaves `''`, which is PRESENT. Re-seeding it would put the
    // default back under the cursor on the next re-read.
    const values: Record<string, FieldValue> = { steps: '' };
    syncDefaults(leaves, values);
    expect(values.steps).toBe('');
  });

  it('drops keys the contract no longer declares', () => {
    const values: Record<string, FieldValue> = { gone: 'x', steps: '9' };
    syncDefaults(leaves, values);
    expect('gone' in values).toBe(false);
    expect(values.steps).toBe('9');
  });

  it('mutates in place, because the caller holds it in a $state proxy', () => {
    const values: Record<string, FieldValue> = {};
    const same = values;
    syncDefaults(leaves, values);
    expect(same).toBe(values);
    expect(same.steps).toBe('5');
  });
});
