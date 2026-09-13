/**
 * The options every read-only terminal tile is constructed with — ADR 0043, decision 6.
 *
 * WHY THIS IS A MODULE AND NOT AN OBJECT LITERAL INSIDE THE COMPONENT. Pane bytes reach xterm
 * UNFILTERED: `capture-pane` is taken with `-e` so the screen is correct, and nothing in
 * `control/orchestrator/src/panels/` redacts or rewrites what comes back. That is right for a
 * service's own journal and it means the emulator's own capabilities are part of the read-only
 * boundary rather than an implementation detail beneath it — so what this page will ACT on has to be
 * something a test can fail on, not something inherited from a default that could change in a minor
 * version or be flipped by a plausible-looking pull request.
 *
 * The component still owns everything cosmetic. What lives here is the two settings whose value is a
 * security property, plus the theme and font the caller passes through, so there is exactly one
 * construction site to pin.
 *
 * `allowProposedApi` IS DELIBERATELY ABSENT rather than set to `false`. xterm gates its unstable
 * surface behind it — and that surface is where handlers for OSC sequences live, including the ones
 * that would let bytes from a pane reach the viewer's clipboard. Absent and false behave the same;
 * absent says nobody considered turning it on, which is the state {@link readOnlyTerminalOptions}
 * exists to keep true. `terminalOptions.test.ts` fails if it appears at all.
 */

import type { ITerminalOptions, ITheme } from '@xterm/xterm';

export interface TerminalChrome {
  fontSize: number;
  fontFamily: string;
  scrollback: number;
  theme: ITheme;
}

/**
 * The options for one read-only tile.
 *
 * `disableStdin` is xterm's own guard and it is defence in depth, never the boundary: the boundary
 * is that no message in the outbound union carries bytes and no route can write to a session's
 * channel (ADR 0020 finding 3 — a read-only guarantee that rests on "there is nothing to write to"
 * is stronger than one that rests on "we only ever write these two commands"). Both hold, and this
 * one is the half a test in this repository can assert.
 */
export function readOnlyTerminalOptions(chrome: TerminalChrome): ITerminalOptions {
  return {
    convertEol: true,
    cursorBlink: false,
    // Read-only, on top of there being no path for bytes to leave this page at all.
    disableStdin: true,
    scrollback: chrome.scrollback,
    fontSize: chrome.fontSize,
    fontFamily: chrome.fontFamily,
    theme: chrome.theme,
  };
}
