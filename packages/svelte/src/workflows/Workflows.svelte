<script lang="ts">
  /**
   * Workflows — what is registered, the runs each produced, and what a run DID.
   *
   * ── A RUN IS REACHED THROUGH THE WORKFLOW THAT PRODUCED IT ──────────────────────────────────────
   *
   * `/runs/<id>` is a retired surface that still redirects, and this is why: a run id on its own
   * tells you nothing about what it was meant to do. Opening a run from its workflow keeps the
   * question — "did THIS do what it should" — attached to its answer.
   *
   * ── THE TIMELINE IS THE RUN VIEW, NOT A TAB IN IT ───────────────────────────────────────────────
   *
   * A list of events answers "what happened" in the order it happened, which is the wrong order for
   * "why is this slow". Both are here; the chart is first because it is the question people open a
   * run with.
   */
  import type { RunEvent, RunHistory } from '@kontra/console-core/run/api';

  import Timeline from './Timeline.svelte';
  import { followRun, type Follow } from './runStream';
  import type { ScratchFlowEdge, ScratchFlowNode } from '@kontra/console-core/panels/scratchFlow';

  // LAZY, AND THAT IS THE POINT. `@xyflow/react` sits in the React console's ENTRY chunk, so
  // everybody downloads the canvas to open Secrets. A dynamic import keeps Svelte Flow's ~181 KB
  // with the people who open a canvas.
  let Canvas = $state<unknown>(undefined);
  let canvasWanted = $state(false);
  $effect(() => {
    if (!canvasWanted || Canvas) return;
    void import('./canvas/Canvas.svelte').then((m) => (Canvas = m.default));
  });

  // The Scratch document for this workflow, once there is one to draw.
  let flowNodes = $state<ScratchFlowNode[]>([]);
  let flowEdges = $state<ScratchFlowEdge[]>([]);

  interface RunRow { runId: string; type: string; status: string; startedAt: number; closedAt: number }

  let runs = $state<RunRow[]>([]);
  let loading = $state(true);
  let picked = $state<string | undefined>(undefined);
  let history = $state<RunHistory | undefined>(undefined);
  let historyError = $state('');
  let focus = $state<number | undefined>(undefined);
  let follow = $state<Follow<RunRow>>({ state: 'connecting' });

  // FOLLOW THE PICKED RUN, and tear the stream down when it changes. The server counts open
  // streams; an effect that opened one per click would exhaust them by browsing.
  $effect(() => {
    const id = picked;
    if (!id) return;
    follow = { state: 'connecting' };
    return followRun<RunRow>(id, (f) => {
      follow = f;
      // A RUNNING RUN'S HISTORY GROWS. The stream says the run changed; the history endpoint says
      // how. Re-read on a state frame rather than on a timer — this is the whole point.
      if (f.state === 'live' && f.run && !f.run.closedAt) void reread(id);
    });
  });

  async function reread(id: string): Promise<void> {
    const r = await fetch(`/api/runs/${encodeURIComponent(id)}/history`, { credentials: 'same-origin' });
    if (r.ok) history = (await r.json()) as RunHistory;
  }

  $effect(() => {
    void fetch('/api/runs', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        runs = Array.isArray(rows) ? (rows as RunRow[]) : [];
        picked ??= runs[0]?.runId;
        loading = false;
      })
      .catch(() => (loading = false));
  });

  $effect(() => {
    const id = picked;
    if (!id) return;
    history = undefined;
    historyError = '';
    void fetch(`/api/runs/${encodeURIComponent(id)}/history`, { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 404) {
          // ORDINARY, not an error. Temporal drops an execution at retention and the archive may
          // have nothing either; saying "no history" is the honest answer and 502 would be a lie.
          historyError = 'no history — Temporal has dropped this execution and the archive has none';
          return undefined;
        }
        if (!r.ok) {
          historyError = `could not read history: HTTP ${r.status}`;
          return undefined;
        }
        return (await r.json()) as RunHistory;
      })
      .then((h) => (history = h))
      .catch((e) => (historyError = e instanceof Error ? e.message : String(e)));
  });

  const events = $derived<readonly RunEvent[]>(history?.events ?? []);
  const run = $derived(runs.find((r) => r.runId === picked));
  // Seconds the run has been going, for the open bars. A closed run draws to its last event.
  const nowSeconds = $derived(
    run && !run.closedAt ? (Date.now() - run.startedAt) / 1000 : undefined
  );
  const focused = $derived(events.find((e) => e.id === focus));
</script>

<section>
  <h1>Workflows</h1>

  {#if loading}
    <p class="muted">reading runs…</p>
  {:else if runs.length === 0}
    <p class="muted">
      No runs yet. <code class="mono">kontra workflow start &lt;folder&gt;</code> produces one.
    </p>
  {:else}
    <div class="runs">
      {#each runs.slice(0, 12) as r (r.runId)}
        <button class:on={picked === r.runId} onclick={() => { picked = r.runId; focus = undefined; }}>
          <span class="rid mono">{r.runId}</span>
          <span class="st {r.status}">{r.status}</span>
        </button>
      {/each}
    </div>

    {#if run}
      <div class="run">
        <header>
          <h2 class="mono">{run.type}</h2>
          <span class="st {follow.state === 'live' && follow.run ? follow.run.status : run.status}">
            {follow.state === 'live' && follow.run ? follow.run.status : run.status}
          </span>
          <!-- THE LINK, because a run view holding a minute-old state with no indication is worse
               than one that says it is stale. `ended` is not a failure: the server closes a stream
               deliberately when a run reaches a terminal status. -->
          <span class="link {follow.state}">
            {#if follow.state === 'live'}<span class="dot" aria-hidden="true"></span>following
            {:else if follow.state === 'reconnecting'}reconnecting…
            {:else if follow.state === 'ended'}finished
            {:else if follow.state === 'unsupported'}not following
            {:else}connecting…{/if}
          </span>
          {#if history?.archived}
            <span class="arch" title="read from the ADR 0025 archive, not from Temporal">archived</span>
          {/if}
        </header>

        {#if historyError}
          <p class="err" role="alert">{historyError}</p>
        {:else if !history}
          <p class="muted">reading history…</p>
        {:else}
          <Timeline {events} now={nowSeconds} onpick={(id) => (focus = id)} />

          {#if history.elided > 0}
            <p class="muted">
              {history.elided} event(s) dropped from the middle to stay under the cap — said rather
              than swallowed.
            </p>
          {/if}

          <div class="canvas">
            <button class="toggle" onclick={() => (canvasWanted = !canvasWanted)}>
              {canvasWanted ? 'hide' : 'show'} the scratch canvas
            </button>
            {#if canvasWanted}
              {#if Canvas}
                {@const C = Canvas as typeof import('./canvas/Canvas.svelte').default}
                <C nodes={flowNodes} edges={flowEdges} />
              {:else}
                <p class="muted">loading the canvas…</p>
              {/if}
            {/if}
          </div>

          {#if focused}
            <dl class="pick">
              <dt>event</dt><dd class="mono">#{focused.id} {focused.type}</dd>
              <dt>at</dt><dd class="mono">{focused.t.toFixed(2)}s</dd>
              {#if focused.attempt > 1}<dt>attempt</dt><dd class="mono">{focused.attempt}</dd>{/if}
              <dt>detail</dt><dd>{focused.summary || focused.detail || '—'}</dd>
            </dl>
          {:else}
            <p class="muted">Pick a bar to see the event behind it.</p>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  h2 { font-size: var(--t-lead); font-weight: 600; margin: 0; }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0; padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  .runs { display: flex; flex-direction: column; gap: var(--s-1); }
  .runs button {
    display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; text-align: left; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); color: var(--fg);
  }
  .runs button.on { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .rid { font-size: var(--t-small); overflow-wrap: anywhere; }
  .st {
    margin-left: auto; font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim);
  }
  .st.running { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .st.completed { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
  .st.failed, .st.terminated { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  .arch { font-size: var(--t-micro); color: var(--warn); }
  .link { font-size: var(--t-small); color: var(--dim); margin-left: auto; display: inline-flex; align-items: center; gap: var(--s-1); }
  .link.live { color: var(--ok); }
  .link.reconnecting { color: var(--warn); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .run {
    display: flex; flex-direction: column; gap: var(--s-3);
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); padding: var(--s-3);
  }
  header { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  .pick {
    display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3);
    margin: 0; padding: var(--s-2) var(--s-3); background: var(--track); border-radius: var(--radius);
  }
  .pick dt { font-size: var(--t-small); color: var(--dim); }
  .pick dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  code { font-size: var(--t-small); }
  .canvas { display: flex; flex-direction: column; gap: var(--s-2); min-width: 0; }
  .toggle {
    align-self: flex-start; font-size: var(--t-small); padding: var(--s-1) var(--s-3);
    border-radius: var(--radius); border: 1px solid var(--line);
    background: var(--track); color: var(--dim); cursor: pointer;
  }
</style>
