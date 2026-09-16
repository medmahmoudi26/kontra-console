import { describe, expect, it } from 'vitest';

import { bytesCell, expiryCell, nameCell, runCell, stateCell } from './cells';

describe('the grid cells', () => {
  it('marks a renamed dataset and names what it is stored as', () => {
    // The name on screen is an override; the stored one is what a query must use. A copied name
    // that fails somewhere else is the failure this prevents.
    const e = nameCell({ name: 'scope_8x8', nameLocal: 'my scope', renamed: true, dataset: 'scope_8x8' });
    expect(e.textContent).toContain('my scope');
    expect(e.textContent).toContain('renamed');
    expect(e.querySelector('.tag')?.getAttribute('title')).toContain('scope_8x8');
  });

  it('marks a temporary dataset, because it disappears', () => {
    expect(nameCell({ name: 'tmp', temporary: true }).textContent).toContain('temp');
  });

  it('a dataset with no run says `loaded`, not blank', () => {
    // Blank reads as missing data. A standalone dataset genuinely has no run, and that is an
    // answer rather than an absence.
    const e = runCell({});
    expect(e.textContent).toBe('loaded');
    expect(e.title).toContain('standalone');
  });

  it('an expired dataset is marked as gone, not as a negative duration', () => {
    const now = 1_800_000_000_000;
    expect(expiryCell({ expiresAt: now - 5000 }, now).className).toContain('gone');
    expect(expiryCell({}, now).textContent).toBe('—');
  });

  it('carries core’s own sentence onto the state badge', () => {
    const e = stateCell({ state: 'sealed' });
    expect(e.textContent).toBeTruthy();
    expect(e.title.length).toBeGreaterThan(0); // the reason, not just the word
  });

  it('scales bytes and keeps the exact count in the title', () => {
    const e = bytesCell({ bytes: 1536 });
    expect(e.textContent).toBe('1.5 KB');
    expect(e.title).toBe('1,536 bytes');
  });

  it('never throws on an empty row, because a cell that throws takes the grid with it', () => {
    for (const f of [nameCell, stateCell, runCell, bytesCell]) expect(() => f({})).not.toThrow();
  });
});
