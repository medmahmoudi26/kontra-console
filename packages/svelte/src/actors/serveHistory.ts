/**
 * A folder's serve history, turned into the four strings a row shows.
 *
 * ── WHY THERE IS A HISTORY AT ALL ───────────────────────────────────────────────────────────────
 *
 * Pressing Serve starts a `serveDevWorkflow` execution, and the orchestrator deliberately keeps
 * that type OFF the Runs page: it is kontra's own infrastructure, not a caller's Run, and a wall of
 * these would bury what somebody actually ran. Hiding it was all that existed. A serve that died —
 * a missing module, a folder that moved, two minutes gone on a cold image pull — left a button that
 * looked pressed and an actor nothing was polling, with the sentence explaining it held in an
 * execution no surface listed. The reason is the whole point of keeping the record; the timestamps
 * are context for it.
 *
 * ── WHY THE DERIVATION IS HERE AND NOT IN THE COMPONENT ─────────────────────────────────────────
 *
 * The same reason `serving.ts` beside it is a module: jsdom has no layout engine and a Svelte test
 * proves nothing about what a row SAYS. The mapping from a Temporal status to an English outcome,
 * and the decision about what to print when a failure has no recorded reason, are the two things
 * that can be wrong here — so both are functions with tests rather than expressions in a template.
 *
 * `startedAtText` and `shortSeconds` come from core, which the Runs page already draws its clocks
 * with. A second time format on a second surface is how two pages come to disagree about when the
 * same minute was.
 */
import type { ServeHistory, ServeRecord } from '@kontra/console-core/run/api';
import { shortSeconds, startedAtText } from '@kontra/console-core/run/steps';

/**
 * WHAT HAPPENED, in the three answers an operator acts on differently.
 *
 * Not the server's five-member `RunStatus`, and the collapse is deliberate in BOTH directions.
 * `cancelled` and `pending` are folded into `failed` because what they have in common is the only
 * thing this panel is about: no Worker came out of that press. And `failed` is NOT collapsed
 * further, because the row beneath it carries the sentence that distinguishes an import error from
 * a timeout — which is information the status itself threw away (the server folds Temporal's
 * FAILED, TERMINATED and TIMED_OUT into one word).
 */
export type ServeOutcome = 'running' | 'worked' | 'failed';

export interface ServeLine {
  /** Temporal's run id for this execution — the key, because the workflow id is the FOLDER and is
   *  reused by every press of Serve. */
  execId: string;
  outcome: ServeOutcome;
  /** `23 Sep 2026 · 19:22:58`, local — the same clock the Runs page prints. '' if unknown. */
  when: string;
  /** How long a CLOSED serve took. '' while it is still open, and '' with no usable clock. */
  took: string;
  /**
   * The sentence under a failed row. '' for a serve that worked or is still going — never a
   * placeholder, because an empty reason line would read as a reason nobody wrote down.
   */
  reason: string;
}

/**
 * What a failed serve says when the reason cannot be read.
 *
 * A CLOSED EXECUTION'S HISTORY AGES OUT BEFORE ITS VISIBILITY ROW DOES, so "it failed and the
 * sentence is gone" is an ordinary outcome and not a bug. Saying which of the two you are looking
 * at is the difference between a record with a hole in it and one that looks broken.
 */
export const NO_REASON_RECORDED = 'no reason recorded — the execution history has aged out';

/**
 * NO `now` ARGUMENT, and its absence is the decision recorded at {@link took}: nothing drawn here
 * is relative to the present, so nothing here goes stale in a tab left open.
 */
export function serveLines(history: ServeHistory | null | undefined): ServeLine[] {
  return (history?.serves ?? []).map(serveLine);
}

function serveLine(s: ServeRecord): ServeLine {
  const outcome = outcomeOf(s);
  return {
    execId: s.execId,
    outcome,
    when: startedAtText(s.startedAt),
    took: took(s),
    reason: outcome === 'failed' ? s.failure || NO_REASON_RECORDED : '',
  };
}

function outcomeOf(s: ServeRecord): ServeOutcome {
  if (s.status === 'running') return 'running';
  if (s.status === 'completed') return 'worked';
  return 'failed';
}

/**
 * How long a CLOSED serve took.
 *
 * NOTHING FOR A SERVE STILL IN FLIGHT, and that is the honest answer rather than a missing feature.
 * This panel does not tick — a history is a record, and `setInterval` is banned in this tree
 * (ADR 0048 §3) — so `now - startedAt` computed once at mount is a stopwatch that stops. Seen in
 * the browser while checking the layout: three page loads of the same running serve printed 4.9s,
 * 6.6s and 8.3s, each frozen from the moment its tab opened. A number that says "4.9s" about a
 * serve that has been going ten minutes is worse than no number; the `when` beside it is the fact
 * that does not decay.
 *
 * '' RATHER THAN A ZERO for a missing clock, too. A start time this page never received is not a
 * serve that took no time, and `0s` beside a failure would be read as "it failed instantly".
 */
function took(s: ServeRecord): string {
  if (!s.startedAt || !s.closedAt) return '';
  const seconds = (s.closedAt - s.startedAt) / 1000;
  return seconds >= 0 ? shortSeconds(seconds) : '';
}

/**
 * THE CAP, SAID OUT LOUD — '' when it did not bite.
 *
 * A bounded list drawn without this reads as the complete history: "this actor has been served
 * twice", where the truth is "here are the last two of many". The count comes from the rows
 * actually present rather than from a number restated here, so the sentence cannot disagree with
 * what is on screen.
 */
export function serveCapNote(history: ServeHistory | null | undefined): string {
  if (!history?.capped) return '';
  const n = history.serves.length;
  return `showing the ${n} most recent — this folder has been served more times than that.`;
}
