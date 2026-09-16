/**
 * A frame from the streamer, and what a terminal does with it.
 *
 * ── A SNAPSHOT IS A SCREEN, NOT A LOG ───────────────────────────────────────────────────────────
 *
 * One binary frame type carries both a whole-screen repaint and a live attach's increments, and
 * {@link CLEAR_HOME} at the head is the ONLY thing that tells them apart. Get this wrong in the
 * appending direction and a tile accumulates a new copy of the screen every few seconds until the
 * scrollback cap eats it; get it wrong the other way and a live attach resets on every keystroke.
 *
 * MOVED HERE FROM `TerminalTile.tsx`, unchanged, because two consoles now draw these frames and the
 * repaint rule is a property of the WIRE rather than of either renderer.
 */
import { CLEAR_HOME } from '@kontra/core/panels/tmux';

export { CLEAR_HOME };

const CLEAR_HOME_BYTES = Uint8Array.from(CLEAR_HOME, (c) => c.charCodeAt(0));

/**
 * How many lines this pane's own scrollback ring keeps — xterm's `scrollback` option, named.
 *
 * TMUX'S SCROLLBACK IS UNREACHABLE FROM A READ-ONLY PANE. tmux keeps history in copy-mode, which is
 * a KEYBOARD feature — entered with `C-b [`, scrolled with the arrow keys. A read-only browser pane
 * forwards no keystrokes (that is the whole guarantee), so "scroll back through what a Worker
 * printed" cannot be tmux's job here. It is the frontend's: the xterm below holds a ring of the
 * stream, capped at this. Exported because the detail drawer STATES the cap to the operator, and a
 * `2000` written twice is how the sentence and the buffer come to disagree.
 *
 * WHAT SURVIVES A RECONNECT is a real design item, not something tmux answers for us. A snapshot
 * pane's ring is thrown away on every repaint (`applyFrame`'s `reset()` — that discard is exactly
 * what makes a snapshot idempotent), so on a snapshot pane the ring is only ever the last screen
 * plus the backlog a `capture-pane -S` carries. A live attach accumulates up to the cap. Either way
 * a dropped-and-reattached socket reseeds from a fresh screen and the browser holds no bytes across
 * the gap — which is the same property that lets the reconnect promise never to duplicate output.
 *
 * It was `panels/scrollback.ts`, whose one other export was the drawer's sentence about all this.
 * The constant belongs to the component that passes it to xterm; the sentence belongs to the one
 * that says it, and neither needed a file of its own once a test could render either.
 */
export const SCROLLBACK_LINES = 2_000;

/** Is this payload a whole screen? */
export function isRepaint(payload: Uint8Array): boolean {
  if (payload.length < CLEAR_HOME_BYTES.length) return false;
  for (let i = 0; i < CLEAR_HOME_BYTES.length; i += 1) {
    if (payload[i] !== CLEAR_HOME_BYTES[i]) return false;
  }
  return true;
}


/** The part of xterm a frame needs. An interface so the rule below is testable without a DOM. */
export interface TerminalSink {
  reset(): void;
  write(data: Uint8Array): void;
}


/**
 * Write one frame: a snapshot REPLACES the tile, a live frame appends to it.
 *
 * The reset is the mechanism, not belt-and-braces. Two things would otherwise accumulate: a repaint's
 * outgoing screen scrolls into xterm's scrollback, so a tile repainting every three seconds fills
 * 2000 lines of history with stale screens an operator can scroll back through; and a live attach's
 * first bytes were measured to be `\x1b[?1049h` (alternate screen) followed by `\x1b[1;50r` (a
 * 50-row scroll region), so a stream that ends leaves the terminal in a mode a later snapshot would
 * paint into sideways. `reset()` is the only primitive that puts the buffer, the scrollback, the
 * cursor, the SGR state, the alternate-buffer flag and the scroll region back to a known state —
 * which is what makes a repaint idempotent whatever the previous stream left behind.
 *
 * It is also why the wheel proxy has nothing to scroll on a snapshot tile: `reset()` throws the
 * scrollback away every few seconds, so scrollback is a property of a LIVE tile. `chrome/scroll.ts`
 * states the consequence — a snapshot tile absorbs no wheel and the wall scrolls instead.
 */
export function applyFrame(sink: TerminalSink, payload: Uint8Array): 'repaint' | 'append' {
  if (isRepaint(payload)) {
    sink.reset();
    sink.write(payload);
    return 'repaint';
  }
  sink.write(payload);
  return 'append';
}


/**
 * Should this frame be HELD because somebody is reading back through the tile?
 *
 * THE BUG THIS ENDS. A snapshot carries 50 lines above the visible screen (`SNAPSHOT_LINES`), so a
 * snapshot tile has scrollback and can be scrolled — and then, three seconds later, the next
 * snapshot arrives and {@link applyFrame} calls `reset()`, which is documented above as throwing the
 * scrollback away on purpose. The viewport lands back at the tail. Reading anything older than the
 * visible screen was therefore impossible: the wall pulled you to the bottom faster than you could
 * read a line.
 *
 * ONLY A REPAINT IS HELD, and only while the tile is actually scrolled back. A live frame is an
 * APPEND, and xterm already leaves a scrolled-up viewport where it is when output arrives — so
 * holding those would stall a live attach to fix a problem it does not have. A tile at the tail
 * (`scrolledBack === 0`) is every tile on a wall nobody is touching, and it repaints as before.
 *
 * HELD, NOT DROPPED-AND-FORGOTTEN. The next snapshot after the operator returns to the tail is a
 * whole screen — that is what a snapshot IS — so the tile catches up on its own within one cadence.
 * Nothing has to be buffered, which is the property that makes this safe on a wall of sixty tiles.
 */
export function holdsRepaint(payload: Uint8Array, scrolledBack: number): boolean {
  return scrolledBack > 0 && isRepaint(payload);
}
