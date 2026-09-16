import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaFields } from '@kontra/console-core/panels/schemaTree';
import type { JsonSchema } from '@kontra/console-core/types';
import { describe, expect, it } from 'vitest';

/**
 * THE FIXTURE IS REAL SDK OUTPUT, not a schema written to match the reader.
 *
 * `testdata/firstactor-target.schema.json` is `TypeAdapter(Target).json_schema()` for the template
 * actor's input model, captured from pydantic and verified byte-identical to what a live control
 * plane serves for it. Everything a hand-written schema proves is that the reader agrees with ME.
 *
 * The one case it carries that the older fixture does not is a real `Literal[...]`, which is what an
 * author writes to get a dropdown.
 */
const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(here, '../../../../testdata/firstactor-target.schema.json'), 'utf8')
) as JsonSchema;

describe('/dev derives every control from the contract', () => {
  const nodes = schemaFields(schema);
  const by = (name: string) => nodes?.find((n) => n.name === name);

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
    // As a SET, not field by field: five passing assertions would still let a reader that answered
    // `text` for everything look nearly right in a diff.
    expect(nodes!.map((n) => n.control ?? 'text').sort()).toEqual([
      'file',
      'folder',
      'select',
      'text',
      'toggle',
    ]);
  });

  it('a pydantic Literal is a dropdown carrying both arms', () => {
    expect(by('mode')?.control).toBe('select');
    expect(by('mode')?.enum).toEqual(['quick', 'deep']);
  });

  it('an OPTIONAL File and Folder are still drop zones', () => {
    // Both are `X | None`, so the marker is two indirections down — through `anyOf`, then `$ref`.
    // One short and these are ordinary groups of three boxes.
    expect(by('wordlist')?.control).toBe('file');
    expect(by('wordlist')?.kind).toBe('leaf');
    expect(by('corpus')?.control).toBe('folder');
    expect(by('corpus')?.kind).toBe('leaf');
  });

  it('the plain string stays a box, and is required', () => {
    expect(by('host')?.control).toBeUndefined(); // absent means text — see SchemaField.control
    expect(by('host')?.required).toBe(true);
  });

  it('the bool is a toggle and is NOT required, so it has an unset state', () => {
    expect(by('follow_redirects')?.control).toBe('toggle');
    expect(by('follow_redirects')?.required).toBe(false);
  });
});
