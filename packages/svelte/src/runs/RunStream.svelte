<script lang="ts">
  /**
   * RunStream — what this run is doing, one section per stream, each drawn from its own schema.
   *
   * ── WHY THIS IS NOT THE LOGS RAIL ───────────────────────────────────────────────────────────────
   *
   * `LogsRail.svelte` answers "what did this run SAY" — prose, searchable, read after the fact.
   * This answers "where is it NOW". Recovering the second from the first means regexing
   * `crawl: page 12/26` out of a sentence, which breaks the moment somebody rewords a log line —
   * and rewording a log line is not supposed to be a breaking change.
   *
   * ── NOTHING HERE KNOWS WHAT A CRAWLER IS ────────────────────────────────────────────────────────
   *
   * A Method publishes on `<actor>/<method>` and declares its record's shape with
   * `@actor.method(streams=…)`; that schema rides in the actor's catalog entry beside `input` and
   * `output`. This file groups by topic, looks the schema up by the topic's own two halves, and
   * renders the fields the author declared, in the order they declared them, with their
   * descriptions as tooltips.
   *
   * That is what makes it work for a workflow author who cannot read the actor's source — which is
   * the normal case, and the whole reason a catalog exists. An earlier version of this pane
   * hardcoded five labels including `program`; it drew a bug-bounty sweep correctly and described
   * every other workspace either wrongly or not at all.
   *
   * ── `fetch`, NOT `EventSource`, AND THE ROUTE IS WHY ────────────────────────────────────────────
   *
   * `/api/runs/:runId/progress-stream` is fail-closed on a bearer, because a record carries `at` —
   * the exact host and path a worker is on. `EventSource` cannot set a header, so it gets a 401 and
   * the pane sits empty looking like a backend fault; that is exactly what happened the first time
   * this was wired. `session.ts` installs the credential by wrapping `window.fetch`, so reading the
   * body as a stream authenticates for free. `readFrames` is `logstream.ts`'s, reused rather than
   * rewritten — one SSE parser, and it already knows frames split on `\r?\n\r?\n`, not `\n\n`.
   *
   * ── THE CLOCK TICKS EVEN WHEN NOTHING ARRIVES ───────────────────────────────────────────────────
   *
   * "how much longer" and "how long since this worker last spoke" move with the wall clock, not the
   * stream, so a pane that re-renders only on a record shows a frozen ETA on exactly the run that
   * has stalled — the case a reader most needs it. Hence the 1s ticker.
   */
  import {
    applyEvent,
    describeField,
    emptyProgress,
    eta,
    liveNodes,
    orderedFields,
    unitsOf,
    topicsOf,
    WORKFLOW_TOPIC,
    type ProgressEvent,
    type TopicState,
  } from '@kontra/console-core/run/progress';
  import { readFrames } from '@kontra/console-core/run/logstream';
  import type { CatalogActor, JsonSchema } from '@kontra/console-core/types';

  const props: { runId: string } = $props();

  let run = $state(emptyProgress(Date.now()));
  let now = $state(Date.now());
  let tail = $state<ProgressEvent[]>([]);
  let error = $state('');
  let open = $state(false);
  let finished = $state<{ status: string; offset: number } | null>(null);
  /** Whether anything is polling this run's task queue. `pollers < 0` = could not tell. */
  let serving = $state<{ queue: string; pollers: number } | null>(null);
  /** `<actor>/<method>` -> the schema that Method declared it streams. */
  let schemas = $state<Record<string, JsonSchema>>({});

  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(id);
  });

  /**
   * The declared shapes, fetched ONCE per mount rather than per topic.
   *
   * `/api/actors` is the whole catalog in one response and a run has a handful of topics, so a
   * request per topic would be several round trips for one document. Keyed by `<actor>/<method>`
   * so a topic is a direct lookup with no parsing at render time.
   *
   * A MISSING SCHEMA IS NOT AN ERROR. An actor a version ahead of the catalog, an actor that
   * declares no `streams=`, or a catalog that has not seen this worker yet all land here, and all
   * of them still draw — `orderedFields` falls back to alphabetical. Refusing to render a stream
   * because its shape is unknown would make the pane useless in exactly the moment something new
   * is running.
   */
  $effect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/actors', { credentials: 'same-origin' });
        if (!res.ok || !live) return;
        const actors = (await res.json()) as CatalogActor[];
        const out: Record<string, JsonSchema> = {};
        for (const a of actors ?? []) {
          for (const op of a.operations ?? []) {
            if (op.stream) out[`${a.name}/${op.name}`] = op.stream;
          }
        }
        if (live) schemas = out;
      } catch {
        /* the catalog being unreachable costs labels, not the stream */
      }
    })();
    return () => {
      live = false;
    };
  });

  $effect(() => {
    const runId = props.runId;
    if (!runId) return;
    run = emptyProgress(Date.now());
    tail = [];
    error = '';
    finished = null;
    serving = null;
    open = false;

    const ctl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/progress-stream`, {
          signal: ctl.signal,
          headers: { accept: 'text/event-stream' },
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          error = body.error ?? `${res.status} ${res.statusText}`;
          return;
        }
        open = true;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const { frames, rest } = readFrames(buf);
          buf = rest;
          for (const f of frames) {
            if (f.event === 'progress') {
              try {
                const ev = JSON.parse(f.data) as ProgressEvent;
                run = applyEvent(run, ev, Date.now());
                tail = [...tail, ev].slice(-200);
                error = '';
              } catch {
                /* one malformed frame is not a reason to tear down a working stream */
              }
            } else if (f.event === 'serving') {
              // WHO, IF ANYONE, IS SERVING THIS RUN. A workflow start succeeds with no worker
              // anywhere — Temporal queues the task and waits — so a run with nothing polling its
              // queue sits at RUNNING, publishes nothing, and renders exactly like a broken
              // backend. This is the difference between "wait" and "go serve the workflow".
              try {
                serving = JSON.parse(f.data) as { queue: string; pollers: number };
              } catch {
                serving = null;
              }
            } else if (f.event === 'final') {
              // A RUN THAT HAS ALREADY FINISHED. Its stream is workflow memory, so it ends with
              // the workflow; the route says so rather than leaving the pane on "connecting".
              try {
                finished = JSON.parse(f.data) as { status: string; offset: number };
              } catch {
                finished = { status: 'CLOSED', offset: -1 };
              }
            } else if (f.event === 'error') {
              // THE SERVER'S SENTENCE. A run that hosts no stream and an unreachable Temporal are
              // both errors here, and only the server can tell them apart.
              try {
                error = (JSON.parse(f.data) as { error?: string }).error ?? f.data;
              } catch {
                error = f.data;
              }
            }
          }
        }
      } catch (err) {
        if (!ctl.signal.aborted) error = `the progress stream dropped: ${String(err)}`;
      }
    })();
    return () => ctl.abort();
  });

  const streams = $derived(topicsOf(run));

  function schemaFor(t: TopicState): JsonSchema | undefined {
    return schemas[t.topic];
  }

  /** A published value as one line. Objects are rare here and `[object Object]` helps nobody. */
  function fmt(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function dur(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  /** What to call a stream. The workflow's own topic is not an `<actor>/<method>` pair. */
  function titleOf(t: TopicState): string {
    return t.topic === WORKFLOW_TOPIC ? 'workflow' : t.topic;
  }
</script>

<section class="stream">
  <header>
    <h3>Run stream</h3>
    <span class="state" class:live={open && !error && !finished}
      >{error ? 'error' : finished ? finished.status.toLowerCase() : open ? 'live' : 'connecting'}</span
    >
    <span class="off mono">offset {run.offset < 0 ? '—' : run.offset}</span>
  </header>

  {#if finished}
    <!-- THE STATE MOST READERS ACTUALLY SEE. A run of this size outlives no browser: by the time
         somebody has loaded the console and signed in, a 56-second run is over and its stream is
         gone. So this paragraph is not an edge case — it is the pane, most of the time — and it
         has to say what happened, what there is instead, and how to see the live thing. -->
    <p class="done" data-testid="stream-final">
      This run has finished, so its stream is closed — the log lives in the workflow, not in
      history, and ends with it.
      {finished.offset >= 0
        ? `It published ${finished.offset + 1} record(s) while it ran.`
        : 'It published nothing.'}
      {#if finished.offset >= 0}
        The transcript below is what survives; press <strong>Run</strong> to watch a new one live.
      {/if}
    </p>
  {/if}
  {#if error}
    <p class="err" role="alert" data-testid="stream-error">{error}</p>
  {/if}
  {#if serving && serving.pollers === 0 && streams.length === 0 && !finished}
    <p class="warnbar" role="status" data-testid="stream-unserved">
      This run is queued but <strong>nothing is serving it</strong> — no worker is polling
      <code class="mono">{serving.queue}</code>. Temporal accepted the start and is holding the
      task, so the run will sit at RUNNING and publish nothing until a worker appears. Serve the
      workflow (and its actor) and it will pick up from here.
    </p>
  {/if}

  {#each streams as t (t.topic)}
    {@const schema = schemaFor(t)}
    {@const nodes = liveNodes(t, now)}
    {@const remaining = eta(t, run, now).remainingMs}
    {@const pct = t.total > 0 ? Math.min(100, (100 * t.done) / t.total) : 0}
    {@const units = unitsOf(t)}
    <article class="topic" data-testid="stream-topic" data-topic={t.topic}>
      <h4>
        <span class="mono name">{titleOf(t)}</span>
        <!-- SAID, NOT IMPLIED. A stream with no declared shape still draws; naming that is what
             stops a reader wondering whether the labels are the author's or ours. -->
        {#if !schema && t.topic !== WORKFLOW_TOPIC}
          <span class="untyped" title="This Method declares no streams= type, so these labels are
the record's own keys rather than a declared schema.">no declared shape</span>
        {/if}
        <span class="count mono">{t.count}</span>
      </h4>

      <dl class="cards">
        {#if units !== null}
          <!-- `units` READS AS A FRACTION OR AS A BARE COUNT. An actor publishes `done` and no
               `total` — it knows its Batch, not the run — and gating this on `total` dropped the
               number entirely, since `done` is reserved out of the field list too. -->
          <div title={t.total > 0 ? '' : 'This publisher reports how many units it has finished but declares no total: an actor knows its own Batch, not the run.'}>
            <dt>units</dt><dd class="mono">{units}</dd>
          </div>
        {/if}
        {#if remaining !== null}
          <div><dt>remaining</dt><dd class="mono warn">{dur(remaining)}</dd></div>
        {/if}
        {#if t.at && nodes.length === 0}
          <div><dt>at</dt><dd class="mono at">{t.at}</dd></div>
        {/if}
        {#each orderedFields(t.fields, schema) as [k, v] (k)}
          {@const text = fmt(v)}
          <div title={describeField(schema, k)}>
            <dt>{k}</dt>
            <!-- ONE LINE WITH THE WHOLE VALUE ON HOVER, once it stops being a metric.
                 `dd` is `--t-lead` with `overflow-wrap: anywhere`, which is right for `5` and
                 `handshake` and wrong for a 45-character Temporal identity: MEASURED, the
                 `worker` field `57@f36d372b886f@canary-1.0.0-s-4912e940fba8` wrapped to SEVEN
                 lines and made its tile seven times the height of every other tile in the row.
                 A stat tile is for a value you read at a glance; past ~18 characters this is an
                 identifier you copy, so it truncates and carries the full string in `title`. -->
            <dd class="mono accent" class:long={text.length > 18} title={text.length > 18 ? text : undefined}>{text}</dd>
          </div>
        {/each}
      </dl>

      {#if t.total}
        <div class="bar" aria-hidden="true"><i style="width:{pct}%"></i></div>
      {/if}

      {#if nodes.length > 0}
        <!-- AN EXPLICIT <tbody>. `<table>` does not allow a bare `<tr>` child, so the browser
             inserts one during parse and the server-rendered markup no longer matches what
             hydration expects — svelte-check reports it as `node_invalid_placement_ssr`. -->
        <table data-testid="stream-nodes"><tbody>
          {#each nodes as n (n.node)}
            <tr>
              <td class="mono node">{n.node}</td>
              <td class="mono at">{n.at || '—'}</td>
              <td class="mono ago">{Math.max(0, Math.round((now - n.seenAt) / 1000))}s ago</td>
            </tr>
          {/each}
        </tbody></table>
      {/if}
    </article>
  {:else}
    <!-- NOT AN EMPTY `<p>`. This branch used to render `finished ? '' : '…'`, so a run that had
         finished got a blank paragraph under a "stream" heading with an empty list beneath it —
         which is the shape of a broken pane, not of a closed one. A reader who opens a run after
         it ends is the COMMON case (a 56-second run outlives no browser), so this is the state
         most people see, and it was the one state that said nothing. -->
    {#if !finished}
      <p class="done">Nothing has published yet on this run.</p>
    {/if}
  {/each}

  <!--
    THE FEED IS HIDDEN WHEN THERE IS NOTHING IN IT, rather than drawn empty.

    The records live in the workflow and end with it, so a finished run has no tail to show and
    never will — `finished` above already says so, with the count. An empty `<ol>` under a heading
    invites the reader to wait for something that cannot arrive.
  -->
  {#if tail.length > 0}
    <h4 class="feedhead">stream</h4>
    <ol class="feed" data-testid="stream-feed">
      {#each tail.slice(-40) as ev (ev.offset)}
        <li class="row">
          <span class="off mono">{ev.offset}</span>
          <span class="mono topicname">{ev.topic}</span>
          <!-- The raw record, whatever keys it carried. Rendering named fields here would hide
               exactly the ones a new Method invented. -->
          <span class="mono msg" class:actor={ev.topic !== WORKFLOW_TOPIC}>
            {Object.entries(ev.data)
              .filter(([k]) => k !== 'actor')
              .map(([k, v]) => `${k}=${fmt(v)}`)
              .join('  ')}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  /* Type never goes below --t-small; density comes from leading and padding (ADR 0048 §5). */
  .stream { display: flex; flex-direction: column; gap: var(--s-3); }
  header { display: flex; align-items: baseline; gap: var(--s-2); }
  h3 { font-size: var(--t-head); margin: 0; }
  h4 { font-size: var(--t-micro); color: var(--dim); text-transform: uppercase;
       letter-spacing: .08em; margin: 0 0 var(--s-2); display: flex; align-items: baseline;
       gap: var(--s-2); }
  h4.feedhead { margin-top: var(--s-2); }
  .name { text-transform: none; letter-spacing: 0; color: var(--accent); font-size: var(--t-small); }
  .untyped { text-transform: none; letter-spacing: 0; color: var(--dim); font-size: var(--t-micro); }
  .count { margin-left: auto; color: var(--dim); }
  .state { font-size: var(--t-micro); color: var(--dim); text-transform: uppercase; letter-spacing: .08em; }
  .state.live { color: var(--ok); }
  .off { color: var(--dim); font-size: var(--t-micro); }
  header .off { margin-left: auto; }
  .err { color: var(--bad); font-size: var(--t-small); margin: 0; }
  .done { color: var(--dim); font-size: var(--t-small); margin: 0; }
  .warnbar { color: var(--fg); font-size: var(--t-small); margin: 0; padding: var(--s-2);
             border: 1px solid color-mix(in srgb, var(--bad) 55%, transparent);
             background: color-mix(in srgb, var(--bad) 12%, transparent);
             border-radius: var(--radius); }
  .warnbar code { color: var(--accent); }
  .topic { border: 1px solid var(--line); border-radius: var(--radius);
           background: var(--panel); padding: var(--s-2) var(--s-3); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
           gap: var(--s-2); margin: 0; }
  .cards div { border: 1px solid var(--line); border-radius: var(--radius);
               background: var(--bg); padding: var(--s-2); min-width: 0; }
  dt { color: var(--dim); font-size: var(--t-micro); text-transform: uppercase; letter-spacing: .08em; }
  dd { margin: 2px 0 0; font-size: var(--t-lead); font-variant-numeric: tabular-nums;
       overflow-wrap: anywhere; }
  /* See the `long` note in the markup: an identifier is not a metric, so it gets one line, the
     smaller size the rest of the console uses for mono identifiers, and an ellipsis. */
  dd.long { font-size: var(--t-small); white-space: nowrap; overflow: hidden;
            text-overflow: ellipsis; overflow-wrap: normal; }
  .accent { color: var(--accent); } .warn { color: var(--bad); }
  .bar { height: 6px; border: 1px solid var(--line); border-radius: var(--radius);
         overflow: hidden; background: var(--bg); margin-top: var(--s-2); }
  .bar > i { display: block; height: 100%; background: var(--accent); transition: width .4s; }
  table { width: 100%; border-collapse: collapse; margin-top: var(--s-2); }
  td { padding: 4px var(--s-2); border-bottom: 1px solid var(--line); font-size: var(--t-small); }
  tr:last-child td { border-bottom: 0; }
  .node { color: var(--accent); white-space: nowrap; }
  .at { overflow-wrap: anywhere; }
  .ago { color: var(--dim); text-align: right; white-space: nowrap; }
  .feed { list-style: none; margin: 0; padding: 0; max-height: 18rem; overflow: auto;
          border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
  .row { display: flex; gap: var(--s-2); padding: 2px var(--s-2); font-size: var(--t-small); }
  .row .off { min-width: 3rem; }
  .topicname { color: var(--dim); min-width: 9rem; }
  .msg { flex: 1; overflow-wrap: anywhere; }
  .actor { color: var(--ok); }
  .mono { font-family: var(--mono); }
</style>
