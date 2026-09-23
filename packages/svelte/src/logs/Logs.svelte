<script lang="ts">
  /**
   * Logs — every actor's lines, interleaved, as they are written.
   *
   * ── A TERMINAL, AND WHY THAT IS THE RIGHT SHAPE ─────────────────────────────────────────────────
   *
   * `LogsRail.svelte` already answers "why did this run do that": one run, filtered, newest-first,
   * read beside the thing the run did. This answers the other question — "what is the fleet doing
   * right now" — and the two want opposite layouts. The rail is a list you SEARCH. This is a stream
   * you WATCH, so it reads downward, it follows the tail, and every line carries who wrote it.
   *
   * ── THE ACTOR IS THE COLUMN THE RAIL DOES NOT HAVE ──────────────────────────────────────────────
   *
   * In a rail every line came from the same run, so naming the emitter is noise. Here four actors on
   * six machines write into one scroller and the only way to read it is to be able to pick one
   * emitter out of the interleave. That is what the colour is for — stable per actor, so it is the
   * same colour in every tab and after every reload (`logstream.ts` has the argument, including why
   * it may collide and why fixing that would be worse).
   *
   * ── FOLLOWING IS DERIVED FROM SCROLL POSITION, NOT REMEMBERED ───────────────────────────────────
   *
   * A view that yanks you to the bottom while you are reading is the single reason people stop using
   * one of these. Scrolling up pauses; scrolling back down resumes; the pill says how many lines
   * arrived while you were away. No flag to get stuck, because the rule reads the position
   * (`shouldFollow`) rather than remembering an event — see its note for why the event-shaped
   * version is wrong in both directions.
   *
   * ── DENSITY COMES FROM LEADING AND PADDING, NEVER FROM TYPE SIZE ────────────────────────────────
   *
   * Every row is `--t-small` (12px), which is the floor ADR 0048 §5 sets and `scripts/type-scale.mjs`
   * enforces. A log message is prose. The 11px this obviously "wants" is the argument the React
   * console lost one `text-[11px]` at a time, ending at 27 declarations of 9px.
   */
  import { filterLogs, type Level } from '@kontra/console-core/run/logs';
  import { actorStyle, shouldFollow } from '@kontra/console-core/run/logstream';

  import { BACKFILL_LINES, LogStream } from './stream.svelte';

  const stream = new LogStream();
  $effect(() => stream.start('*'));

  /**
   * The filter is CLIENT-SIDE, over the lines already here, and that is a decision.
   *
   * Sending the box's contents to `/api/logs/tail` as LogsQL would be more powerful and would make
   * every keystroke tear down the stream and reopen it — a terminal that goes blank and refills
   * while you type. The buffer is the thing on screen; filtering it is instant and reversible, and
   * a question that needs more than this is a question for `/api/logs/query`.
   */
  let text = $state('');
  let floor = $state<Level>('debug');
  let onlyIncomplete = $state(false);
  /** One actor, from clicking its chip. `''` is everybody. */
  let pinned = $state('');
  /** Wrapping is the default; a terminal reader sometimes wants the raw column alignment instead. */
  let wrap = $state(true);

  let scroller = $state<HTMLElement | null>(null);
  let following = $state(true);
  /** How many lines existed when following stopped, so the pill can count what was missed. */
  let pausedAt = $state(0);

  const shown = $derived(
    filterLogs(stream.lines, { text, floor, onlyIncomplete }).filter(
      (l) => pinned === '' || (l.actor ?? '') === pinned
    )
  );

  /** Who is writing, how much, and in what colour — the legend, and the actor filter. */
  const actors = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const line of stream.lines) {
      const who = line.actor ?? '';
      counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, color: actorStyle(name).color }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  const behind = $derived(following ? 0 : Math.max(0, stream.lines.length - pausedAt));

  /**
   * What to CALL the connection, which is not always what the transport knows.
   *
   * `quiet` IS THE STATE THAT WAS MISSING, and leaving it out produced the surface's worst bug: on
   * an idle fleet `/api/logs/tail` sends no headers at all (see `stream.svelte.ts`, `reachable`),
   * so the tail reports `connecting` indefinitely — printed above three hundred backfilled lines.
   * Found by screenshotting a real fleet between hunts rather than a generator running flat out,
   * which is the only condition that shows it.
   *
   * A backfill that answered proves the backend is up. `connecting` on top of that means the fleet
   * has not written anything yet, and QUIET IS NOT BROKEN — saying so is the entire job here.
   */
  const phase = $derived(
    stream.phase === 'connecting' && stream.reachable ? 'quiet' : stream.phase
  );

  /**
   * Pin to the bottom after the rows have been drawn.
   *
   * `$effect` RUNS AFTER THE DOM IS FLUSHED, which is the whole reason this works: the new rows
   * already have their height, so `scrollHeight` is the real one and a single assignment lands
   * exactly at the bottom. Reading `shown.length` and `following` is what subscribes it — including
   * to the resume, so pressing the pill scrolls without a second code path.
   */
  $effect(() => {
    const count = shown.length;
    const el = scroller;
    if (!el || !following || count === 0) return;
    el.scrollTop = el.scrollHeight;
  });

  function onscroll(): void {
    const el = scroller;
    if (!el) return;
    const was = following;
    following = shouldFollow(el);
    // Snapshot the count at the moment of pausing — the pill counts from HERE, not from zero.
    if (was && !following) pausedAt = stream.lines.length;
  }

  function pin(name: string): void {
    pinned = pinned === name ? '' : name;
  }

  /** UTC, like the rail and like every machine that wrote these. Local time here would be a third answer. */
  const clock = (ts: number): string => new Date(ts).toISOString().slice(11, 19);
  const full = (ts: number): string => new Date(ts).toISOString();
</script>

<section class="logs">
  <header class="top">
    <h1>Logs</h1>
    <!-- WHAT THE CONNECTION IS DOING, separate from what is on screen. `reconnecting` over four
         thousand lines means the lines are still true and the future is missing — one state, and it
         must not look like either "live" or "empty". -->
    <span class="phase" data-phase={phase} title={phase === 'quiet' ? 'the backend answered the backfill, so it is up — the tail simply has no new line yet' : ''}>{phase}</span>
    <span class="count mono">{shown.length}/{stream.lines.length}</span>
  </header>

  <p class="muted">
    every actor on this install, interleaved, oldest first — times are UTC, the colour is the actor
    and is the same colour in every tab. Scroll up to pause; the last {BACKFILL_LINES} lines are
    loaded on arrival so this is never an empty box waiting.
  </p>

  {#if stream.error}
    <!-- THE SERVER'S OWN SENTENCE. `routes/logs.ts::unreachable` names the compose service and the
         command to check it precisely so this does not have to guess — and so that "the backend is
         down" never renders as "nothing has been logged". -->
    <p class="err" role="alert" data-testid="logs-error">{stream.error}</p>
  {/if}

  {#if stream.historyError}
    <!-- THE PAST, NOT THE PRESENT. A live tail above a failed backfill is a surface showing the
         last few seconds of a fleet that has been running for hours — which reads as "it just
         started" unless this says otherwise. Calmer than `.err` because the stream below IS
         working; the sentence is the server's own. -->
    <p class="warnbar" role="status" data-testid="logs-history-error">
      the last {BACKFILL_LINES} lines could not be loaded, so this starts from whenever you opened
      it rather than from the beginning — the live stream below is unaffected. {stream.historyError}
    </p>
  {/if}

  <div class="bar">
    <input class="q mono" bind:value={text} placeholder="filter these lines" aria-label="filter the lines on screen" />
    <select bind:value={floor} aria-label="minimum level" class="mono">
      <option value="debug">debug</option>
      <option value="info">info</option>
      <option value="warn">warn</option>
      <option value="error">error</option>
    </select>
    <!-- ADR 0050 §2, carried over from the rail: a completeness claim must stay findable, and it
         IGNORES the level floor because one emitted at INFO is exactly the one that gets lost. -->
    <button class="tog" class:on={onlyIncomplete} aria-pressed={onlyIncomplete}
            onclick={() => (onlyIncomplete = !onlyIncomplete)}
            title="results that are not what a reader would assume (ADR 0050 §2)">incomplete</button>
    <button class="tog" class:on={!wrap} aria-pressed={!wrap} onclick={() => (wrap = !wrap)}
            title="stop wrapping long lines — the scroller scrolls sideways instead">nowrap</button>
    <button class="tog" onclick={() => stream.clear()} title="empty the scrollback; the stream stays open">clear</button>
  </div>

  {#if actors.length > 0}
    <div class="legend" aria-label="actors writing">
      {#each actors as a (a.name)}
        <button class="chip mono" class:on={pinned === a.name} aria-pressed={pinned === a.name}
                onclick={() => pin(a.name)} title="show only {a.name || 'the control plane'}">
          <span class="dot" style="background:{a.color}"></span>
          <span style="color:{a.color}">{a.name || 'control-plane'}</span>
          <span class="n">{a.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- THE SCROLLER AND THE PILL SHARE A BOX, because the pill has to sit over the bottom edge of
       the rows rather than under them: a jump control below the fold is a jump control nobody finds. -->
  <div class="frame">
    <!-- `tabindex` SO THE SCROLLER IS REACHABLE FROM THE KEYBOARD — a box that only a wheel can
         move is a box some people cannot read. `aria-live="off"` ON A `role="log"` IS DELIBERATE
         and is the opposite of the usual advice: at a few hundred lines a minute a live region
         reads every one of them aloud and a screen reader user cannot get a word in. The lines are
         here to be read at will, not announced. -->
    <!-- THE LINTER IS WRONG HERE, and the rule it is applying is a heuristic about the wrong thing.
         `a11y_no_noninteractive_tabindex` exists to stop `tabindex` being sprayed onto static text.
         This is a SCROLLABLE REGION, and WCAG 2.1.1 requires that anything scrollable be operable
         from a keyboard — a box only a mouse wheel can move is a box some people cannot read at
         all. Removing the attribute would trade a real barrier for a clean report. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="term" class:nowrap={!wrap} bind:this={scroller} {onscroll} tabindex="0"
         role="log" aria-live="off" aria-label="log lines" data-testid="log-term">
      {#if stream.lines.length === 0}
        <!-- A SENTENCE, NEVER A BLANK BOX — and three different sentences, because "connecting",
             "the backend refused" and "nothing has been written" are three different things to go
             and do something about. -->
        <p class="empty">
          {#if stream.error}
            The stream is not delivering lines. The sentence above is the server's own; it says
            which machine to look at.
          {:else if phase === 'quiet'}
            The backend answered and has nothing yet — no line has been written since this opened.
            Lines reach here from every Machine's <code>vlagent</code> as they are written, so
            leaving this open is the point: an idle fleet is quiet, not broken.
          {:else if phase === 'connecting'}
            opening the stream…
          {:else if phase === 'reconnecting'}
            the stream dropped and is being reopened — nothing has arrived yet.
          {:else}
            The stream is open and nothing has been written yet. Lines reach here from every
            Machine's <code>vlagent</code> as they are written, so leaving this open is the point —
            an idle fleet is quiet, not broken.
          {/if}
        </p>
      {:else if shown.length === 0}
        <p class="empty">
          Nothing matches this filter — all {stream.lines.length} lines are hidden. The stream is
          still running behind it.
        </p>
      {:else}
        {#if stream.dropped > 0}
          <!-- THE TOP OF THE SCROLLBACK IS NOT THE START, and saying so is the difference between a
               reader concluding the fleet did nothing before this and knowing where to query. -->
          <p class="trimmed">{stream.dropped} earlier line(s) dropped at the buffer cap — query them with <code>/api/logs/query</code>.</p>
        {/if}
        <ol class="rows">
          {#each shown as line (line.seq)}
            {@const who = line.actor ?? ''}
            <li class="row {line.level}" class:incomplete={line.incomplete}>
              <span class="t mono" title={full(line.ts)}>{clock(line.ts)}</span>
<!--
                WHICH WORKER SAID IT, in the hover. `actor` is which actor and `machine` is which
                box; on a packed Machine running four Workers neither answers "which process", and
                that is the question asked when one Droplet is grinding an abandoned sweep and ten
                are idle. The identity is also what `temporal task-queue describe` lists, so it is
                the string that carries a reader from this rail into the engine's own view.

                IN THE TITLE AND NOT IN THE ROW, because it is forty characters of `pid@host@queue`
                and the row is already three columns competing for a rail. The free-text filter
                matches it (`run/logs.ts`), which is how somebody narrows to one Worker.
              -->
              <span class="who mono" style="color:{actorStyle(who).color}"
                    title="{who || 'control plane'}{line.machine ? ` · ${line.machine}` : ''}{line.unit ? ` · ${line.unit}` : ''}{line.worker ? `\n${line.worker}` : ''}"
              >{who || '—'}</span>
              <span class="msg mono">{line.msg}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    {#if !following}
      <!-- PAUSED, AND IT SAYS WHAT IT COSTS. The count is the point: "jump to latest" alone does not
           tell a reader whether they are one line behind or four hundred. -->
      <button class="jump" data-testid="logs-jump" onclick={() => (following = true)}>
        paused{behind > 0 ? ` · ${String(behind)} new line${behind === 1 ? '' : 's'}` : ''} · jump to latest ↓
      </button>
    {/if}
  </div>
</section>

<style>
  .logs { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
  .top { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  .phase {
    font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim);
  }
  .phase[data-phase='live'] { color: var(--ok); }
  /* DIM, not green and not amber: the backend is fine and nothing is happening. */
  .phase[data-phase='quiet'] { color: var(--dim); }
  .phase[data-phase='reconnecting'] { color: var(--warn); }
  .phase[data-phase='closed'] { color: var(--bad); }
  .count { font-size: var(--t-small); color: var(--dim); margin-left: auto; }

  .muted {
    font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 78ch;
    line-height: var(--lh-body);
  }
  .warnbar {
    font-size: var(--t-small); color: var(--warn); margin: 0; line-height: var(--lh-body);
    padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
    border-radius: var(--radius); overflow-wrap: anywhere; max-width: 110ch;
  }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0; line-height: var(--lh-body);
    padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent);
    border-radius: var(--radius); overflow-wrap: anywhere;
  }

  /* ── THE BAR ─────────────────────────────────────────────────────────────────────────────────── */
  .bar { display: flex; flex-wrap: wrap; gap: var(--s-1); align-items: center; min-width: 0; }
  /* CAPPED, because this surface runs at the full viewport width (`App.svelte`, `wide`). An input
     that grows to 1200px is a 1200px box holding six characters — it reads as a layout accident
     rather than as a search box, and nothing about a filter needs that much room. */
  .q { flex: 1 1 12rem; min-width: 0; max-width: 34rem; }
  .q, select {
    font-size: var(--t-small); padding: 2px var(--s-2);
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  .tog {
    font-family: var(--mono); font-size: var(--t-small); padding: 2px var(--s-2);
    background: none; color: var(--dim);
    border: 1px solid var(--line); border-radius: var(--radius);
    cursor: pointer; white-space: nowrap;
  }
  .tog.on {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* ── THE LEGEND, which is also the actor filter ──────────────────────────────────────────────── */
  .legend { display: flex; flex-wrap: wrap; gap: var(--s-1); min-width: 0; }
  .chip {
    display: inline-flex; align-items: center; gap: var(--s-1);
    font-size: var(--t-small); padding: 1px var(--s-2);
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    cursor: pointer; color: var(--dim); max-width: 100%; min-width: 0;
  }
  .chip.on { border-color: var(--fg); background: var(--track); }
  .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .chip .n { color: var(--dim); font-variant-numeric: tabular-nums; }

  /* ── THE TERMINAL ────────────────────────────────────────────────────────────────────────────── */
  .frame { position: relative; min-width: 0; }
  .term {
    /* The SCROLLER scrolls. The page never does (ADR 0048 §4) — `min-width: 0` is what stops this
       box widening the document when a row is longer than the viewport. */
    min-width: 0;
    height: calc(100vh - 300px);
    min-height: 18rem;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2) 0;
    scrollbar-width: thin;
  }
  /* Sideways is allowed HERE and only here: the user asked for it, and it is the scroller moving. */
  .term.nowrap { overflow-x: auto; }
  .term.nowrap .rows { min-width: max-content; }
  .term.nowrap .msg { white-space: pre; }

  .rows { list-style: none; margin: 0; padding: 0; }

  /*
   * NARROW FIRST (ADR 0048 §4). Two columns and the message on its own line, because 12ch of actor
   * plus 8ch of clock out of 320px leaves a message column too narrow to read. Width EARNS the
   * third column; it is not assumed and then defended.
   */
  .row {
    display: grid;
    grid-template-columns: 8ch minmax(0, 1fr);
    column-gap: var(--s-2);
    align-items: baseline;
    font-size: var(--t-small);
    line-height: var(--lh-tight);
    padding: 1px var(--s-2) 1px calc(var(--s-2) - 2px);
    border-left: 2px solid transparent;
  }
  .row:hover { background: color-mix(in srgb, var(--fg) 4%, transparent); }
  .msg { grid-column: 1 / -1; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--fg); }
  .t { color: var(--dim); }
  .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }

  @media (min-width: 680px) {
    .row { grid-template-columns: 8ch 13ch minmax(0, 1fr); }
    .msg { grid-column: auto; }
  }

  /* LEVEL IS ON THE MESSAGE AND THE EDGE, NEVER ON THE ACTOR TOKEN — recolouring the identity is
     what would break tracking on exactly the lines you most want to track. */
  .row.debug .msg { color: var(--dim); }
  .row.warn .msg { color: var(--warn); }
  .row.error .msg { color: var(--bad); }
  .row.error { border-left-color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, transparent); }

  /* ADR 0050 §2 — a claim that the result is smaller than it looks, kept findable among progress
     noise at the same level. The same treatment the rail gives it, for the same reason. */
  .row.incomplete {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border-left-color: var(--warn);
  }

  .empty {
    font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body);
    margin: 0; padding: var(--s-3) var(--s-3); max-width: 70ch;
  }
  .trimmed {
    font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body);
    margin: 0 0 var(--s-2); padding: 0 var(--s-2);
    border-bottom: 1px dashed var(--line);
  }
  code { font-family: var(--mono); }

  /* ── THE PILL ────────────────────────────────────────────────────────────────────────────────── */
  .jump {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: var(--s-3);
    max-width: calc(100% - var(--s-5));
    font-family: var(--mono); font-size: var(--t-small);
    padding: var(--s-1) var(--s-3);
    color: var(--bg); background: var(--accent);
    border: 1px solid var(--accent); border-radius: 999px;
    cursor: pointer; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
    box-shadow: 0 2px 10px rgb(0 0 0 / 45%);
  }
  .jump:hover { background: color-mix(in srgb, var(--accent) 85%, white); }
</style>
