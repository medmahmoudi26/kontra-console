/**
 * The three controls a declared type earns, and the states each one must be able to say.
 *
 * WHAT IS WORTH PINNING IS THE THIRD STATE, EVERY TIME. A closed set has "not chosen" beside its
 * members; a boolean has "not set" beside true and false; a file field has "a value I cannot draw"
 * beside empty and uploaded. Each of those is a real answer the form has always been able to carry,
 * and each is the one a control invented for the two obvious states would quietly destroy — a
 * checkbox turns an absent optional into `false`, a drop zone turns a hand-typed ref into an empty
 * box, and both look like the form losing somebody's work.
 *
 * THE DERIVATION IS PINNED BESIDE THE MARKUP, because a control is only reached if `schemaTree`
 * labelled the field — and the two halves failing together is how a toggle silently reverts to a
 * text box for an OPTIONAL boolean.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FieldInput } from './FieldInput';
import { FileDrop, readRef, sizeWords } from './FileDrop';
import { INPUT_MARKER, schemaControl, schemaTree } from '@kontra/console-core/panels/schemaTree';
import type { SchemaField } from './MethodContract';
import type { JsonSchema } from '@kontra/console-core/types';

function field(over: Partial<SchemaField> & Pick<SchemaField, 'name' | 'type'>): SchemaField {
  return { required: false, ...over };
}

function draw(f: SchemaField, value = ''): string {
  return renderToStaticMarkup(
    createElement(FieldInput, { field: f, value, onChange: () => {}, testId: 'f' })
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('what the schema says the control is', () => {
  it('a boolean is a toggle', () => {
    expect(schemaControl({ type: 'boolean' })).toBe('toggle');
  });

  it('an OPTIONAL boolean is still a toggle', () => {
    // `bool | None` derives an `anyOf`, and an arm that was not walked is the one place the form
    // silently stops helping — exactly the reading `schemaEnum` already had to fix for `Literal`.
    expect(schemaControl({ anyOf: [{ type: 'boolean' }, { type: 'null' }] })).toBe('toggle');
    expect(schemaControl({ type: ['boolean', 'null'] })).toBe('toggle');
  });

  it('a marked type is a file or a folder', () => {
    expect(schemaControl({ type: 'object', [INPUT_MARKER]: 'file' })).toBe('file');
    expect(schemaControl({ type: 'object', [INPUT_MARKER]: 'folder' })).toBe('folder');
  });

  it('is nothing at all for an ordinary field', () => {
    // Non-vacuous partner: a detector that answered for everything would make every box a toggle.
    expect(schemaControl({ type: 'string' })).toBeNull();
    expect(schemaControl({ type: 'integer' })).toBeNull();
    expect(schemaControl({ type: 'object', properties: {} })).toBeNull();
    expect(schemaControl(null)).toBeNull();
  });

  it('finds the marker through a $ref, which is how pydantic emits a model', () => {
    // The keywords live on the DEFINITION; the property carries only the pointer. A reader that
    // looked at the property alone would draw `kontra.File` as a group of three boxes and ask an
    // operator to type a SHA-256.
    const schema: JsonSchema = {
      type: 'object',
      properties: { corpus: { $ref: '#/$defs/File' } },
      required: ['corpus'],
      $defs: {
        File: {
          type: 'object',
          [INPUT_MARKER]: 'file',
          properties: { name: { type: 'string' }, sha256: { type: 'string' }, size: { type: 'integer' } },
        },
      },
    } as unknown as JsonSchema;
    const nodes = schemaTree(schema);
    expect(nodes).not.toBeNull();
    const corpus = nodes!.find((n) => n.name === 'corpus');
    expect(corpus?.control).toBe('file');
    // AND IT IS A LEAF. Walking into it is what would have produced the three boxes.
    expect(corpus?.kind).toBe('leaf');
    expect(corpus?.children).toBeUndefined();
  });

  it('a closed set is still a select, and wins over everything else', () => {
    const nodes = schemaTree({
      type: 'object',
      properties: { mode: { enum: ['fast', 'thorough'] } },
    } as unknown as JsonSchema);
    expect(nodes![0]?.control).toBe('select');
  });
});

describe('against a schema pydantic actually emitted', () => {
  /**
   * THE FIXTURE IS REAL OUTPUT, not a schema written to match the reader.
   *
   * `testdata/scan-with-file.schema.json` is `TypeAdapter(Scan).json_schema()` for a model
   * declaring `corpus: kontra.File`, `notes: kontra.Folder | None`, a bool and an optional bool —
   * captured from the SDK, docstrings stripped. Everything above this block is a schema I wrote,
   * which means every one of those cases proves the reader agrees with ME. This is the one that
   * proves it agrees with pydantic, and the two disagree in exactly the place that matters: an
   * OPTIONAL model arrives as `{"anyOf":[{"$ref":…},{"type":"null"}]}`, so the marker is two
   * indirections down — through the union, then through the pointer.
   */
  const schema = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'testdata', 'scan-with-file.schema.json'), 'utf8')
  ) as JsonSchema;
  const nodes = schemaTree(schema);
  const by = (name: string) => nodes!.find((n) => n.name === name);

  it('read the fixture', () => {
    // The guard on the guard: a fixture that failed to parse would satisfy every `?.` below.
    expect(nodes).not.toBeNull();
    expect(nodes!.map((n) => n.name).sort()).toEqual([
      'corpus',
      'mode',
      'notes',
      'strict',
      'verbose',
    ]);
  });

  it('draws a required File as a drop zone, not as three boxes', () => {
    expect(by('corpus')?.control).toBe('file');
    expect(by('corpus')?.kind).toBe('leaf');
    expect(by('corpus')?.required).toBe(true);
  });

  it('finds the marker through anyOf AND $ref, which is how an optional model arrives', () => {
    // `notes: Folder | None`. One indirection short and this is an ordinary group of two boxes.
    expect(by('notes')?.control).toBe('folder');
    expect(by('notes')?.kind).toBe('leaf');
  });

  it('draws both booleans as toggles, required or not', () => {
    expect(by('strict')?.control).toBe('toggle');
    expect(by('verbose')?.control).toBe('toggle');
  });

  it('leaves an ordinary string alone', () => {
    // Non-vacuous partner: a reader that labelled everything would pass all four cases above.
    expect(by('mode')?.control).toBeUndefined();
  });
});

/**
 * THE TEMPLATE ACTOR'S OWN FORM, which is the claim `examples/python/firstactor` makes in its
 * first sentence: every control the console can draw, on one Method. A README can say that and be
 * wrong the next time a control is added; this fails when it becomes wrong.
 *
 * The fixture is `TypeAdapter(Target).json_schema()` for that actor's input model, captured from
 * the SDK with docstrings stripped. It carries the one case the other fixture does not — a REAL
 * `Literal["quick","deep"]`, which is what an author writes to get a dropdown.
 */
describe("the template actor's Target draws all five controls", () => {
  const schema = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'testdata', 'firstactor-target.schema.json'), 'utf8')
  ) as JsonSchema;
  const nodes = schemaTree(schema);
  const by = (name: string) => nodes!.find((n) => n.name === name);

  it('read the fixture', () => {
    // The guard on the guard: a fixture that failed to parse satisfies every `?.` below.
    expect(nodes).not.toBeNull();
    expect(nodes!.map((n) => n.name).sort()).toEqual([
      'corpus',
      'follow_redirects',
      'host',
      'mode',
      'wordlist',
    ]);
  });

  it('is five DISTINCT controls, which is the whole claim', () => {
    // Asserted as a set rather than field by field: five assertions that each passed would still
    // let a reader that answered `text` for everything look nearly right in a diff.
    const drawn = nodes!.map((n) => n.control ?? 'text').sort();
    expect(drawn).toEqual(['file', 'folder', 'select', 'text', 'toggle']);
  });

  it('a Literal from pydantic is a dropdown, with both arms on it', () => {
    expect(by('mode')?.control).toBe('select');
    expect(by('mode')?.enum).toEqual(['quick', 'deep']);
  });

  it('an OPTIONAL File and Folder are still drop zones', () => {
    // Both are `X | None` here, so the marker is two indirections down — through the union, then
    // through the pointer — and both must stay `leaf` or the form draws their properties.
    expect(by('wordlist')?.control).toBe('file');
    expect(by('wordlist')?.kind).toBe('leaf');
    expect(by('corpus')?.control).toBe('folder');
    expect(by('corpus')?.kind).toBe('leaf');
  });

  it('the plain string stays a box', () => {
    expect(by('host')?.control).toBeUndefined();
    expect(by('host')?.required).toBe(true);
  });

  it('the bool is a toggle', () => {
    expect(by('follow_redirects')?.control).toBe('toggle');
  });
});

describe('a boolean toggle', () => {
  const bool = field({ name: 'dryRun', type: 'boolean', control: 'toggle' });

  it('is a switch, not a box', () => {
    const html = draw(bool);
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('<input');
  });

  it('says NOT SET rather than false when the key is absent', () => {
    // THE STATE A CHECKBOX CANNOT HOLD, and the one most likely to be assumed wrongly: an optional
    // boolean left alone leaves the key out, so the AUTHOR'S default applies — a different outcome
    // from `false`.
    const html = draw(bool, '');
    expect(text(html)).toContain('not set');
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain('the key is left out');
  });

  it('says true and false literally, because that is what goes on the wire', () => {
    expect(text(draw(bool, 'true'))).toContain('true');
    expect(draw(bool, 'true')).toContain('aria-checked="true"');
    expect(text(draw(bool, 'false'))).toContain('false');
    expect(draw(bool, 'false')).toContain('aria-checked="false"');
  });

  it('shows a value it cannot interpret rather than correcting it', () => {
    // `coerceField` refuses this by name, which is where the operator can read why. Silently
    // snapping it to `false` would change a Batch nobody edited.
    const html = draw(bool, 'True');
    expect(text(html)).toContain('True');
    expect(html).toContain('this row will be refused');
  });
});

describe('clicking a toggle reaches every state the field can hold', () => {
  /** The value the control asks for, given the value it currently has. */
  function click(f: SchemaField, from: string): string {
    let got = '__unchanged__';
    const { container } = render(
      createElement(FieldInput, { field: f, value: from, onChange: (n) => (got = n), testId: 'f' })
    );
    const el = container.querySelector('[data-testid="f"]');
    expect(el, 'no switch rendered').not.toBeNull();
    fireEvent.click(el!);
    return got;
  }

  it('cycles an optional boolean unset → true → false → unset', () => {
    // EVERY STATE REACHABLE BY CLICKING, including the one a checkbox cannot express. Without the
    // way back, an operator who toggled an optional field once could never restore "the author's
    // default applies" without editing JSON.
    const optional = field({ name: 'dryRun', type: 'boolean | null', control: 'toggle' });
    expect(click(optional, '')).toBe('true');
    expect(click(optional, 'true')).toBe('false');
    expect(click(optional, 'false')).toBe('');
  });

  it('cycles a required boolean between true and false only', () => {
    // Leaving a required key out is refused by `coerceValues`, so offering the state would be
    // offering a dead end.
    const required = field({ name: 'force', type: 'boolean', required: true, control: 'toggle' });
    expect(click(required, '')).toBe('true');
    expect(click(required, 'true')).toBe('false');
    expect(click(required, 'false')).toBe('true');
  });

  it('resolves a stray value to true in one click', () => {
    const f = field({ name: 'dryRun', type: 'boolean', control: 'toggle' });
    expect(click(f, 'True')).toBe('true');
  });
});

describe('a file field', () => {
  const file = field({ name: 'corpus', type: 'File', control: 'file' });

  function drawDrop(value: string, kind: 'file' | 'folder' = 'file'): string {
    return renderToStaticMarkup(
      createElement(FileDrop, { kind, value, onChange: () => {}, testId: 'd' })
    );
  }

  it('is a drop zone that is also a button, and a real file picker', () => {
    const html = draw(file);
    expect(html).toContain('data-testid="f-zone"');
    // DRAG IS NOT THE ONLY WAY IN. It is undiscoverable, impossible from a keyboard, and useless in
    // a remote session where the files are on the other machine.
    expect(html).toContain('data-testid="f-picker"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('asks for a directory when the field is a folder', () => {
    // `webkitdirectory` is the only way to choose one at all, and React does not know the attribute.
    expect(drawDrop('', 'folder')).toContain('webkitdirectory');
    expect(drawDrop('', 'file')).not.toContain('webkitdirectory');
  });

  it('shows what is held: the name, the size, and the sha the actor will dereference', () => {
    const value = JSON.stringify({
      name: 'hosts.csv',
      sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      size: 2048,
      contentType: 'text/csv',
    });
    const html = drawDrop(value);
    expect(text(html)).toContain('hosts.csv');
    expect(text(html)).toContain('2.0 kB');
    // The sha is how an operator tells two uploads of one filename apart a week later.
    expect(text(html)).toContain('abcdef012345');
    expect(html).toContain('data-testid="d-clear"');
  });

  it('keeps a value it cannot draw instead of showing an empty zone', () => {
    // The field is a JSON one underneath and an operator may legitimately have pasted a ref. An
    // empty drop zone over their text would look like the form losing it.
    const html = drawDrop('{"not":"a ref"}');
    expect(html).toContain('data-testid="d-opaque"');
    expect(text(html)).toContain('{"not":"a ref"}');
    expect(html).toContain('data-testid="d-replace"');
    expect(html).not.toContain('data-testid="d-zone"');
  });
});

describe('reading a field back', () => {
  it('treats blank as nothing chosen, not as unreadable', () => {
    expect(readRef('', false)).toEqual([]);
    expect(readRef('   ', true)).toEqual([]);
  });

  it('returns null for anything it cannot draw, and never throws', () => {
    expect(readRef('not json', false)).toBeNull();
    expect(readRef('{"no":"sha"}', false)).toBeNull();
    expect(readRef('{"name":"x"}', true)).toBeNull();
  });

  it('reads a folder’s listing', () => {
    const files = [{ name: 'a.txt', sha256: 'aa', size: 1, contentType: '', path: 'c/a.txt' }];
    expect(readRef(JSON.stringify({ name: 'c', files }), true)).toEqual(files);
  });
});

describe('sizes are said the way a person reads them', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [2048, '2.0 kB'],
    [1_500_000, '1.5 MB'],
    [2_500_000_000, '2.50 GB'],
  ])('%s → %s', (bytes, said) => {
    expect(sizeWords(bytes)).toBe(said);
  });
});
