/**
 * A tile's tone: the worst thing it is currently carrying.
 *
 * MOVED OUT OF `chrome/StatusLine.tsx` FOR THE SECOND CONSOLE, unchanged. The rule it encodes —
 * green means "and nothing on this tile is failing", red is reserved for "this screen will not
 * change again" — is a fact about the surface, not about one framework's status bar, and two copies
 * of it would let two consoles paint the same Terminal differently.
 */
import type { TerminalHealth } from './panelsClient';

/** How a tile is being fed — `{t:'state'}`'s `mode`. A different axis from the execution mode. */
export type Feed = 'snapshot' | 'live' | 'error';

/**
 * When a snapshot age stops being normal.
 *
 * The streamer's cadence is ~3 s, so 20 s is about six missed passes: long enough that a busy `ssh`
 * is not the explanation. Same number as the status bar's, and for the same reason — two thresholds
 * for one measurement is how a footer and a tile end up disagreeing about the same wall.
 */
export const STALE_FRAME_MS = 20_000;

/** The bar's colour, from the worst thing it is currently carrying. Green is tmux's own default and
 * means "this is a working tile"; nothing else may be green. */
export type BarTone = 'ok' | 'warn' | 'bad' | 'unmeasured';

/**
 * THE WHOLE TILE'S WORST FACT, not just the feed's.
 *
 * `failing` is what stops the band contradicting the chips above it. tmux's own bar is green while
 * the Worker in the pane is on fire, because tmux has no idea; ours is on a tile that has already
 * decided, in severity order, that something is broken — so green here has to mean "and nothing on
 * this tile is failing" or it means nothing at all.
 *
 * A FAILING SIGNAL IS AMBER, NOT RED, and the split is deliberate. Red is reserved for the two facts
 * that say THIS SCREEN WILL NOT CHANGE AGAIN — the process exited, or the stream is dead — because
 * that is the one thing the bar knows and the chips do not. A failing `poller` is urgent and it is
 * still a live picture of a running pane, so it takes the same amber every other "what you are
 * looking at needs qualifying" state on this surface uses (the held-repaint badge, the stale badge,
 * the elided-bytes badge).
 */
export function barTone(input: {
  process: TerminalHealth['process'];
  feed: Feed;
  stale: boolean;
  frameAgeMs: number | null;
  /** Any applicable health signal reading `bad` — see `HealthChips.leadingFinding`. */
  failing?: boolean;
  /** Any applicable health signal that was never measured — `HealthChips.leadingUnmeasured`. */
  unmeasured?: boolean;
}): BarTone {
  // A finished process is the loudest fact a tile can carry, and it outranks a stale feed: the
  // screen is final either way, but only one of the two is about the Worker.
  if (input.process === 'exited') return 'bad';
  if (input.feed === 'error') return 'bad';
  if (input.stale) return 'warn';
  if (input.frameAgeMs !== null && input.frameAgeMs > STALE_FRAME_MS) return 'warn';
  if (input.failing === true) return 'warn';
  // NOT GREEN, and this is the whole reason the tone exists. ADR 0020 forbids `unknown` rendering
  // as healthy, and once the chip row left the tile this bar became the only health reading on the
  // wall — a pane with an uncollected `poller` or `loads` was showing solid tmux green, identical to
  // one where every signal had been checked. Ranked last because "not checked" is the mildest thing
  // that is still not "fine".
  if (input.unmeasured === true) return 'unmeasured';
  return 'ok';
}
