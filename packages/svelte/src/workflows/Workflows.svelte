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
  import { parseAddress } from '@kontra/console-core/state/address';
  import { fetchLogs, type LogRecord } from '@kontra/console-core/run/logs';
  import LogsRail from './LogsRail.svelte';
  import Transcript from './Transcript.svelte';

  import Asks from './Asks.svelte';
  import Launch from './Launch.svelte';
  import RunTail from './RunTail.svelte';
  import Timeline from './Timeline.svelte';
  import RunStream from '../runs/RunStream.svelte';
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
  /**
   * The run the ADDRESS names, if it names one.
   *
   * `/workflows/<workflow>/<run>` and `/workflows?run=<id>` are both live addresses — the second is
   * what a redirected `/runs/<id>` becomes — and a run view that ignored them would make every link
   * anybody has ever pasted land on the newest run instead of the one they meant.
   */
  const parsed = parseAddress(location.pathname + location.search);
  const addressed = parsed?.view === 'workflows' ? (parsed.run ?? undefined) : undefined;
  /**
   * The workflow the ADDRESS names, if it names one.
   *
   * `/workflows/approve` is a scoped view and this surface ignored it — every run of every workflow
   * was listed under a URL that named one. A link that shows somebody else's runs is worse than a
   * 404: it looks like an answer.
   */
  const addressedWorkflow = $state(parsed?.view === 'workflows' ? (parsed.workflow ?? '') : '');

  let picked = $state<string | undefined>(addressed);
  let history = $state<RunHistory | undefined>(undefined);
  let historyError = $state('');
  let focus = $state<number | undefined>(undefined);
  let follow = $state<Follow<RunRow>>({ state: 'connecting' });
  /* THE RAIL'S HALF OF THE RUN VIEW (ADR 0050 §1). Keyed off the SELECTED run, so the rail
     follows the selection the way the timeline does rather than being a second navigation. */
  let logs = $state<LogRecord[]>([]);
  let logsLoading = $state(false);
  let logsError = $state<string | null>(null);
  /** The run this session started, watched here rather than on a surface that replaced this one. */
  let watching = $state('');
  /**
   * Which workflow's runs to show — the address's, or whichever folder the launcher has open.
   *
   * THE JOIN IS TYPE-TO-TYPE. A run carries the `@workflow.defn` TYPE it was started as
   * (`Approve`), and a folder carries a NAME (`approve`); the launcher knows both because it reads
   * the source, so it hands the type down rather than making this end guess at the mapping.
   */
  /** Bumped whenever the stream says the picked run changed. Children re-read on it. */
  let revision = $state(0);
  /**
   * Is the run list open.
   *
   * IT COLLAPSES BECAUSE RUNS ACCUMULATE. A workflow anybody actually uses has hundreds, and an
   * always-open list pushes the thing you came for — what THIS run did — off the bottom of the
   * screen.
   *
   * OPEN WHILE THERE ARE FEW, SHUT ONCE THERE ARE MANY, because the list stops being an overview
   * at about a screenful and starts being an obstacle. The header keeps the count and the selected
   * id visible either way, so a shut list never hides which run is on screen. Once a person
   * touches it, their choice stands — `touched` is what stops the threshold from overriding them
   * when the eleventh run arrives.
   */

  /**
   * How many runs the list draws.
   *
   * A CAP, AND IT SAYS SO when it bites — a silent `slice` is a list that looks complete and is
   * not. The rest are reachable by their address; this surface is about the newest.
   */
  const SHOWN_RUNS = 12;
  let scopeType = $state('');
  let scopeName = $state('');

  // FOLLOW THE PICKED RUN, and tear the stream down when it changes. The server counts open
  // streams; an effect that opened one per click would exhaust them by browsing.
  $effect(() => {
    const id = picked;
    if (!id) return;
    follow = { state: 'connecting' };
    let lastStatus = '';
    return followRun<RunRow>(id, (f) => {
      follow = f;
      // A RUNNING RUN'S HISTORY GROWS. The stream says the run changed; the history endpoint says
      // how. Re-read on a state frame rather than on a timer — this is the whole point.
      if (f.state === 'live' && f.run && !f.run.closedAt) void reread(id);
      /**
       * THE STREAM IS WHAT SAYS SOMETHING CHANGED, including for the two things beside the
       * timeline: the run LIST's status badges and what the run is waiting for.
       *
       * Measured: answering an ask completed the run in Temporal while this page still showed the
       * question and three `RUNNING` badges, because both had been re-read in the same tick as the
       * POST — before the workflow had processed the signal. Re-reading on the stream's own word
       * instead is both correct and free; re-reading on a timer would be the poll this console does
       * not have.
       */
      /**
       * EVERY FRAME BUMPS THE REVISION; only a STATUS CHANGE re-reads the list.
       *
       * These are two different questions and the first version conflated them. A run that parks on
       * an `ask` does not change status — it is `running` before and after — so a revision tied to
       * status meant the question was fetched once, a second after Run, before the workflow had
       * reached it, and never again. Measured: press Run, watch nothing appear, forever.
       *
       * The frame cadence is the SERVER's, which is the same thing the history re-read beside this
       * already rides on. Nothing here is a timer.
       */
      if (f.state === 'live' || f.state === 'ended') revision += 1;
      const said = f.state === 'live' ? (f.run?.status ?? '') : f.state === 'ended' ? 'ended' : '';
      if (said && said !== lastStatus) {
        lastStatus = said;
        void loadRuns();
      }
    });
  });

  async function reread(id: string): Promise<void> {
    const r = await fetch(`/api/runs/${encodeURIComponent(id)}/history`, { credentials: 'same-origin' });
    if (r.ok) history = (await r.json()) as RunHistory;
  }

  /**
   * The run list.
   *
   * A FUNCTION RATHER THAN AN EFFECT BODY, because starting a run has to re-read it: the new run is
   * not in a list fetched before it existed, and it is the one the operator is looking for. Nothing
   * else re-reads — no timer, no interval — the stream is what says a run changed.
   *
   * IT NEVER MOVES THE SELECTION. `picked ??=` only fills an empty one: re-reading after a start
   * must not yank the run somebody is reading out from under them.
   */
  async function loadRuns(): Promise<void> {
    try {
      const r = await fetch('/api/runs', { credentials: 'same-origin' });
      const rows = r.ok ? await r.json() : [];
      runs = Array.isArray(rows) ? (rows as RunRow[]) : [];
      const scoped = scopeType ? runs.filter((r) => r.type === scopeType) : runs;
      picked ??= scoped[0]?.runId;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadRuns();
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
  /**
   * The runs this view is about.
   *
   * Scoped to the open workflow's type when there is one — which is what makes `/workflows/approve`
   * mean what it says — and the whole list when nothing is open, because a console with no workflow
   * selected is still the place you go to see what ran.
   */
  const shown = $derived(scopeType ? runs.filter((r) => r.type === scopeType) : runs);
  let touched = $state(false);
  let openedByHand = $state(true);
  const OPEN_UP_TO = 5;
  const runsOpen = $derived(touched ? openedByHand : shown.length <= OPEN_UP_TO);

  const run = $derived(runs.find((r) => r.runId === picked));

  $effect(() => {
    const id = picked;
    if (!id) {
      logs = [];
      return;
    }
    logsLoading = true;
    logsError = null;
    void fetchLogs(id)
      .then((r) => {
        logs = r;
      })
      .catch((e: unknown) => {
        // A SENTENCE, NOT AN EMPTY LIST — an unreachable backend and a Run that logged nothing
        // are different facts and must not render the same.
        logsError = String((e as Error)?.message ?? e);
      })
      .finally(() => {
        logsLoading = false;
      });
  });
  // Seconds the run has been going, for the open bars. A closed run draws to its last event.
  const nowSeconds = $derived(
    run && !run.closedAt ? (Date.now() - run.startedAt) / 1000 : undefined
  );
  const focused = $derived(events.find((e) => e.id === focus));
</script>

<section>
  <h1>Workflows</h1>

  <!-- STARTING IS THE FIRST THING ON THE SURFACE, because it is what people open it to do. The run
       list below answers "what happened"; this answers "run it again". -->
  <Launch
    open={addressedWorkflow}
    onstarted={(id) => {
      // PRESSING RUN SELECTS THE RUN. It used to only set the watch strip, so the timeline, the
      // history and — the one that mattered — what the run is WAITING FOR all stayed on whichever
      // run happened to be open. A workflow that parks on a question immediately then looked like
      // a workflow where Run did nothing.
      watching = id;
      picked = id;
      focus = undefined;
      void loadRuns();
    }}
    onopened={(name, type) => { scopeName = name; scopeType = type; picked = undefined; }}
  />

  {#if watching}
    <RunTail runId={watching} onopen={(id) => { picked = id; focus = undefined; }} />
  {/if}

  {#if loading}
    <p class="muted">reading runs…</p>
  {:else if shown.length === 0}
    <p class="muted">
      {#if scopeName}
        No runs of <code class="mono">{scopeName}</code> yet. Press Run above.
      {:else}
        No runs yet. <code class="mono">kontra workflow start &lt;folder&gt;</code> produces one.
      {/if}
    </p>
  {:else}
    <div class="runlist">
      <button class="head" aria-expanded={runsOpen} onclick={() => { openedByHand = !runsOpen; touched = true; }}>
        <span class="caret" aria-hidden="true">{runsOpen ? '▾' : '▸'}</span>
        <span class="count">{shown.length} run{shown.length === 1 ? '' : 's'}</span>
        {#if !runsOpen && picked}<span class="rid mono">{picked}</span>{/if}
        {#if shown.length > SHOWN_RUNS}
          <span class="more">showing the newest {SHOWN_RUNS}</span>
        {/if}
      </button>

      {#if runsOpen}
        <div class="runs">
          {#each shown.slice(0, SHOWN_RUNS) as r (r.runId)}
            <button class:on={picked === r.runId} onclick={() => { picked = r.runId; focus = undefined; }}>
              <span class="rid mono">{r.runId}</span>
              <span class="st {r.status}">{r.status}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if run}
      <div class="runwrap">
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

        <!-- WHAT THIS RUN NEEDS FROM A PERSON, first. A run parked on an `ask` looks exactly like a
             run that is working, and the only difference visible anywhere is this. -->
        <Asks runId={run.runId} {revision} />

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

          {#key run.runId}
          <!-- KEYED ON THE RUN, like `Transcript`, and for a sharper reason: `RunStream` holds an
               open EventSource. Without the key, picking a different run would leave the previous
               run's subscription attached and interleave two runs' progress into one pane.

               ── THIS WAS REMOVED AND IS BACK, DELIBERATELY ──────────────────────────────────

               The runs-surface refactor took `RunStream` out on the argument that "progress is not
               a typed stream any more — it is the run's LOG lines (the rail below); a workflow says
               where it is with `workflow.logger`." That is half right and the half it misses is the
               half ADR 0050 §1 is about: logs are LINES a human reads, progress is STATE a machine
               draws, and the two are not interchangeable. A rail cannot recover `step 3 of 5` from
               a sentence without a regex that breaks the moment somebody rewords the line.

               It is also the feature the newest commit on `kontra` shipped — "Typed per-method
               streaming, end to end and in both SDKs" — where an actor declares `streams=` and the
               shape travels in the catalog beside `input` and `output` precisely so a console can
               render typed progress for an actor whose source the reader has never opened. Deleting
               the only consumer of that leaves the schema published and nothing reading it.

               Whoever finishes the Runs Surface should MOVE this there rather than delete it. -->
          <RunStream runId={run.runId} />
          <Transcript runId={run.runId} />
        {/key}

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
      <LogsRail records={logs} loading={logsLoading} error={logsError} />
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
  .runlist { display: flex; flex-direction: column; gap: var(--s-1); }
  .runlist .head {
    display: flex; align-items: baseline; gap: var(--s-2); width: 100%;
    background: none; border: 0; padding: var(--s-1) 0; cursor: pointer; text-align: left;
    font-size: var(--t-small); color: var(--dim);
  }
  .runlist .head .caret { color: var(--dim); }
  .runlist .head .count { color: var(--fg); }
  .runlist .head .rid { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .runlist .head .more { margin-left: auto; font-size: var(--t-micro); }
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
  /*
   * TWO COLUMNS: the run, and the rail beside it (kontra-console#6, variant A).
   *
   * THE RAIL IS FIXED-WIDTH AND THE RUN FLEXES, and that asymmetry is measured rather than
   * stylistic: a log line is ~80 mono characters, so a rail that re-wraps on every window drag is
   * one nobody reads. `minmax(0, 1fr)` on the run column is what stops a wide timeline or a long
   * mono id from pushing the PAGE sideways — the rail scrolls inside itself instead.
   */
  .runwrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 430px;
    gap: var(--s-4);
    align-items: start;
  }
  /* Under 900px a 430px column of mono under a timeline is worse than a block after it. */
  @media (max-width: 900px) {
    .runwrap { grid-template-columns: minmax(0, 1fr); }
  }
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
