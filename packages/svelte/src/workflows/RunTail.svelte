<script lang="ts">
  /**
   * The run that was just started, while it is still happening.
   *
   * ── IT NEVER SHOWS A VERDICT IT HAS NOT BEEN TOLD ───────────────────────────────────────────────
   *
   * This is the measured bug this component exists for. A newly started run has no detail for a
   * second or two, and a tail that fell back to "the newest run in the list" printed `completed`
   * under an id one second old — the previous run's verdict, attached to this one. So the execution
   * status is `…` until THIS run answers for itself, and `…` is a real state rather than a spinner.
   *
   * ── TWO DIMENSIONS, NOT ONE ─────────────────────────────────────────────────────────────────────
   *
   * ADR 0017: a run's EXECUTION (Temporal's own word) and what its output DID are different
   * questions with different answers, and a run that completed while every Unit was isolated is the
   * case that made that a rule. Execution is what this shows; the run view below carries the rest.
   */
  import type { RunStatus } from '@kontra/core/contract/types';
  import { fetchRun, type RunDetail } from '@kontra/console-core/run/api';

  import { followRun, type Follow } from './runStream';

  /**
   * The five words a run's EXECUTION can be, and nothing else.
   *
   * The stream carries whatever the server wrote, and a status this console does not know is not
   * rendered as itself: an unrecognised word in a status slot reads as a state the operator has
   * never seen rather than as a version skew. It is dropped, and the last known state stands.
   */
  const KNOWN: readonly RunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
  const asStatus = (s: string): RunStatus | undefined =>
    KNOWN.find((k) => k === s.toLowerCase());

  interface Props {
    runId: string;
    /** Open the full run view for this id. */
    onopen?: (runId: string) => void;
  }
  let { runId, onopen }: Props = $props();

  let detail = $state<RunDetail | undefined>(undefined);
  /** What the stream said, before the detail arrived to carry it. */
  let streamed = $state<RunStatus | undefined>(undefined);
  let error = $state('');
  let follow = $state<Follow<{ status?: string }>>({ state: 'connecting' });

  $effect(() => {
    const id = runId;
    // CLEARED ON EVERY ID CHANGE, before anything is fetched. Without this the previous run's
    // detail is on screen under the new id for as long as the fetch takes.
    detail = undefined;
    streamed = undefined;
    error = '';
    follow = { state: 'connecting' };

    let live = true;
    void fetchRun(id)
      .then((d) => {
        // The stream may have moved on while this was in flight; its word is the newer one.
        if (live && id === runId) detail = streamed === undefined ? d : { ...d, execution: streamed };
      })
      .catch((err) => {
        if (live) error = err instanceof Error ? err.message : String(err);
      });

    // The stream carries the status as it changes; the fetch above is what makes the first paint
    // honest. Nothing here is on a timer.
    const stop = followRun<{ status?: string }>(id, (f) => {
      if (!live) return;
      follow = f;
      const said = f.state === 'live' && f.run?.status ? asStatus(f.run.status) : undefined;
      // ONLY EXTENDS WHAT IS KNOWN. Before the detail lands there is no RunDetail to spread, and
      // inventing one would mean inventing the other dimension with it — so the status is held and
      // applied once the run has answered for itself.
      if (said !== undefined) {
        streamed = said;
        if (detail !== undefined) detail = { ...detail, execution: said };
      }
    });
    return () => {
      live = false;
      stop();
    };
  });

  const execution = $derived<RunStatus | '…'>(detail?.execution ?? streamed ?? '…');
</script>

<div class="tail" data-testid="run-tail">
  <span class="lbl">watching</span>
  <button class="id mono" data-testid="run-tail-id" onclick={() => onopen?.(runId)} title="open this run">
    {runId}
  </button>
  <span
    class="st"
    data-testid="run-tail-execution"
    class:ok={execution === 'completed'}
    class:go={execution === 'running'}
    class:bad={execution === 'failed' || execution === 'cancelled'}
  >{execution}</span>
  {#if error}<span class="err" data-testid="run-tail-error" role="alert">{error}</span>{/if}
  {#if follow.state === 'reconnecting'}<span class="link">reconnecting…</span>{/if}
</div>

<style>
  .tail {
    display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap;
    padding: var(--s-2) var(--s-3); background: var(--panel);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: var(--radius);
  }
  .lbl { font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
  .id {
    background: none; border: 0; padding: 0; cursor: pointer; color: var(--fg);
    font-size: var(--t-small); font-weight: 600; text-align: left; overflow-wrap: anywhere;
  }
  .st { font-size: var(--t-small); color: var(--dim); margin-left: auto; font-family: var(--mono); }
  .st.ok { color: var(--ok); }
  .st.go { color: var(--accent); }
  .st.bad { color: var(--bad); }
  .err { font-size: var(--t-small); color: var(--bad); width: 100%; overflow-wrap: anywhere; }
  .link { font-size: var(--t-micro); color: var(--warn); }
</style>
