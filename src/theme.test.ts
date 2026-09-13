/**
 * The dark palette IS the KontraConsole v2 design — asserted against its literal values.
 *
 * WHY A TEST FOR COLOURS. "Is this still the design?" is otherwise answered by opening two things
 * and squinting. These are the exact hex values from the design's own `:root{--k-*}` block, so a
 * value that drifts — a tweak, a merge, a well-meaning tint — fails here with both numbers on
 * screen rather than being noticed months later or never.
 *
 * IT PINS THE DARK PALETTE ONLY. v2 specifies dark; light is kept working rather than invented, so
 * pinning light would be pinning a guess.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8');

/** The `.dark { … }` block, which is where the design lives. */
function darkBlock(): string {
  const start = CSS.indexOf('.dark {');
  expect(start, '.dark block not found in styles.css').toBeGreaterThan(-1);
  const end = CSS.indexOf('\n}', start);
  return CSS.slice(start, end);
}

function tokenIn(block: string, name: string): string | undefined {
  return new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

/**
 * The design's own values, from `KontraConsole v2.dc.html`'s `:root{--k-*}`.
 * Left → the design's name, right → the shadcn token it was mapped onto.
 */
const FROM_DESIGN: ReadonlyArray<[design: string, token: string, value: string]> = [
  ['--k-bg', 'background', '#0a0c0b'],
  ['--k-ink', 'foreground', '#e7ece9'],
  ['--k-panel', 'card', '#101413'],
  ['--k-panel2', 'muted', '#161b19'],
  ['--k-line', 'border', '#212725'],
  ['--k-line2', 'line2', '#2d3532'],
  ['--k-ink2', 'muted-foreground', '#98a4a0'],
  ['--k-chip', 'accent', '#1a201e'],
  ['--k-acc', 'primary', '#34d399'],
  ['--k-acc-ink', 'primary-foreground', '#06231a'],
  ['--k-ok', 'ok', '#6ee7b7'],
  ['--k-warn', 'warn', '#fdba74'],
  ['--k-fail', 'destructive', '#fb7185'],
  ['--k-stall', 'stall', '#c4b5fd'],
  ['--k-park', 'park', '#fcd34d'],
  ['--k-author', 'author', '#7dd3fc'],
];

describe('the dark palette matches the v2 design', () => {
  const block = darkBlock();

  it('found tokens to check', () => {
    // The guard on the guard: a `.dark` block that failed to parse would satisfy every `it.each`
    // below by comparing undefined to undefined if the helper were laxer.
    expect(block.length).toBeGreaterThan(200);
    expect(FROM_DESIGN.length).toBeGreaterThan(10);
  });

  it.each(FROM_DESIGN)('%s → --%s is %s', (design, token, value) => {
    expect(tokenIn(block, token), `--${token} (the design's ${design})`).toBe(value);
  });
});

describe('the tones the transcript reader needs', () => {
  /**
   * `@kontra/core/vocabulary` separates states a two-colour palette cannot. If the palette collapses
   * them, two readings that mean different things render identically — which is the failure the
   * vocabulary exists to prevent, reintroduced one layer down.
   */
  it('gives stall, park and author their own values, all distinct', () => {
    const block = darkBlock();
    const tones = ['ok', 'warn', 'destructive', 'stall', 'park', 'author'].map((t) => tokenIn(block, t));
    for (const [i, v] of tones.entries()) {
      expect(v, `tone ${i} is missing`).toBeTruthy();
    }
    // A stall painted as a failure is a lie about whose problem it is; a park painted as a stall
    // hides that the run is waiting for a PERSON.
    expect(new Set(tones).size, 'two tones share a colour').toBe(tones.length);
  });

  it('exposes them to Tailwind, or the utilities silently do nothing', () => {
    // The stylesheet is a static compile: a `--warn` that never reaches `@theme inline` produces a
    // `text-warn` that resolves to nothing at all, with no error anywhere.
    for (const t of ['warn', 'stall', 'park', 'author', 'line2']) {
      expect(CSS, `--color-${t} is not in @theme inline`).toContain(`--color-${t}: var(--${t});`);
    }
  });
});

describe('type', () => {
  it('names the design’s faces but fetches nothing', () => {
    expect(CSS).toContain('Inter');
    expect(CSS).toContain('JetBrains Mono');
    // NO WEBFONT REQUEST. The console is served from the appliance on loopback and may be run
    // airgapped; a font CDN link is a request that fails silently and falls back to something
    // nobody chose.
    expect(CSS).not.toMatch(/@import\s+url\(|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('falls back to the platform stack', () => {
    expect(CSS).toMatch(/--font-sans:\s*Inter,\s*ui-sans-serif/);
    expect(CSS).toMatch(/--font-mono:\s*'JetBrains Mono',\s*ui-monospace/);
  });
});
