/**
 * The read-only terminal's options are a security boundary — ADR 0043, decision 6.
 *
 * WHAT THIS IS FOR, stated so it is not mistaken for a snapshot test. `capture-pane` is taken with
 * `-e` and nothing in the panels path redacts what comes back, so escape sequences from a pane reach
 * this emulator as they are. That is correct for a service's own journal, and it makes xterm's own
 * capabilities part of the boundary: what the page will ACT on must be a thing a test fails on
 * rather than a default inherited from a dependency.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readOnlyTerminalOptions } from '@kontra/console-core/panels/terminalOptions';

const CHROME = { fontSize: 12, fontFamily: 'mono', scrollback: 2_000, theme: { background: '#000' } };

describe('the read-only terminal options', () => {
  it('never enables xterm proposed API', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `allowProposedApi` gates xterm's unstable surface, which is
    // where handlers for OSC sequences live — including the ones that would let bytes from a pane
    // reach the VIEWER's clipboard. A pane showing a scan's output carries bytes a third party chose.
    //
    // Absent, not `false`: both behave the same and absent says nobody considered turning it on.
    const options = readOnlyTerminalOptions(CHROME) as Record<string, unknown>;
    expect('allowProposedApi' in options, 'allowProposedApi must not appear at all').toBe(false);
    expect(options.allowProposedApi).toBeUndefined();
  });

  it('keeps stdin disabled', () => {
    // Defence in depth, never the boundary — the boundary is that no message in the outbound union
    // carries bytes (ADR 0020 finding 3). This is the half a test in this repo can assert.
    expect(readOnlyTerminalOptions(CHROME).disableStdin).toBe(true);
  });

  it("passes the caller's chrome through unchanged", () => {
    // A guard that asserted only the two above would pass against a function that returned exactly
    // those two and dropped the font and the theme — which renders every glyph as tofu.
    const options = readOnlyTerminalOptions(CHROME);
    expect(options.fontSize).toBe(12);
    expect(options.fontFamily).toBe('mono');
    expect(options.scrollback).toBe(2_000);
    expect(options.theme).toEqual({ background: '#000' });
  });

  it('is the only place a terminal is constructed', () => {
    // The options being right buys nothing if a second `new XTerm({...})` exists with its own object.
    // NON-VACUOUS: it asserts it found the construction site before asserting anything about it.
    const src = readFileSync(join(__dirname, 'TerminalTile.tsx'), 'utf8');
    expect(src).toContain('readOnlyTerminalOptions(');
    const literals = src.match(/new XTerm\(\s*\{/g) ?? [];
    expect(literals, 'a terminal built from an inline literal bypasses this file').toEqual([]);
    expect(src.match(/new XTerm\(/g) ?? [], 'the construction site vanished').toHaveLength(1);
  });
});
