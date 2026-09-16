/**
 * Is anything polling this actor's queue — and if we cannot tell, say so.
 *
 * ── THREE STATES, BECAUSE `isServing` HAS TWO ───────────────────────────────────────────────────
 *
 * `@kontra/console-core`'s `isServing` answers a boolean, which is right for its callers: a page
 * that must decide whether to offer a dispatch has one decision to make. This surface has a
 * different job — it EXPLAINS why a dispatch would wait — and for that, "nothing is polling" and
 * "the cluster could not be asked" are different facts with different fixes.
 *
 * Collapsing them is the loud kind of wrong: reporting a control plane nobody could reach as a wall
 * of dead actors sends an operator to restart workers that are fine. `stuck.ts` in the orchestrator
 * makes the same distinction for the same reason, and its `pollers: null` means exactly this
 * `unknown`.
 *
 * The freshness rule itself is NOT restated here — `pollIsFresh` comes from core, which shares it
 * with the server. A second window is how a page comes to offer a worker the server calls stale.
 */
import { pollIsFresh } from '@kontra/console-core/run/workflowState';

export type Serving = 'serving' | 'idle' | 'unknown';

export interface PollerReport {
  pollers: number;
  lastPoll: number;
  /** Present when the cluster could not be asked. Not the same as "nobody is polling". */
  error?: string;
}

export function servingState(report: PollerReport | null | undefined, now: number): Serving {
  if (!report || report.error !== undefined) return 'unknown';
  if (report.pollers <= 0) return 'idle';
  // A poller listed with no fresh timestamp is a worker Temporal has not forgotten yet. Temporal
  // keeps one listed for about five minutes after it was last seen, so identities alone would
  // report a worker killed thirty seconds ago as serving.
  return pollIsFresh(report.lastPoll, now) ? 'serving' : 'idle';
}

/** What the state means for somebody about to dispatch. Shown, because the state alone is jargon. */
export function servingHint(state: Serving): string {
  if (state === 'serving') return 'a dispatch runs now';
  if (state === 'idle') return 'a dispatch waits until something serves this queue';
  return 'the cluster could not be asked — this is not the same as nothing serving it';
}
