import { describe, expect, it } from 'vitest';

import { plainText } from './prose';

describe('plainText', () => {
  it('unwraps the canary paragraph that shipped its own asterisks to the screen', () => {
    // THE BUG THIS PINS, verbatim from `workspaces/default/workflows/canary/description.md`.
    // The launch form rendered the markers because `description.md` is markdown and the slot it
    // lands in is a `<p>`.
    const raw =
      '**Provisions a Fleet, sweeps on it, and lets you watch every part of it happen.** The ' +
      'first run anybody does on a fresh install.';
    expect(plainText(raw)).toBe(
      'Provisions a Fleet, sweeps on it, and lets you watch every part of it happen. The first ' +
        'run anybody does on a fresh install.'
    );
  });

  it('leaves a plain docstring exactly as it found it', () => {
    // The descriptor path — a Python docstring — is already prose, and this must be a no-op on it
    // or the two sources would render differently for no reason a reader could see.
    const doc = 'Provisions a Fleet, sweeps on it, and lets you watch every part of it happen.';
    expect(plainText(doc)).toBe(doc);
  });

  it('unwraps italics, code spans and links', () => {
    expect(plainText('a *real* Fleet of `Warden` containers')).toBe(
      'a real Fleet of Warden containers'
    );
    expect(plainText('see [ADR 0037](docs/adr/0037.md) for why')).toBe('see ADR 0037 for why');
    expect(plainText('__also bold__')).toBe('also bold');
  });

  it('does not eat an asterisk that is not emphasis', () => {
    // `targets x steps` is often written `targets * steps`, and a lone operator must survive —
    // as must a footnote marker and a glob.
    expect(plainText('targets * steps rows')).toBe('targets * steps rows');
    expect(plainText('required*')).toBe('required*');
    expect(plainText('matches *.py files')).toBe('matches *.py files');
  });

  it('leaves block markdown alone, because eating a # would misreport the author', () => {
    expect(plainText('# canary')).toBe('# canary');
    expect(plainText('- one target is one Unit')).toBe('- one target is one Unit');
  });

  it('trims, so a paragraph with trailing newlines does not push the layout around', () => {
    expect(plainText('  **hi**\n\n')).toBe('hi');
  });

  it('is safe on an empty string', () => {
    expect(plainText('')).toBe('');
  });
});
