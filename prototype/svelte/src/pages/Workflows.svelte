<script>
  /**
   * The Workflows surface: what is registered, what is being served, and the run that is live.
   *
   * THE TIMELINE IS THE PAGE, not a tab inside it. The question a person opens this page with is
   * "what is happening right now", and a list of workflow names does not answer it — so the running
   * Run is laid out first and the registry sits underneath.
   */
  import Timeline from '../lib/Timeline.svelte';
  import { app, fmt, restart } from '../lib/model.svelte.js';
</script>

<section class="page">
  <div class="bar">
    <h2>Workflows</h2>
    <div class="ctl">
      <button class:on={app.playing} onclick={() => (app.playing = !app.playing)}>
        {app.playing ? '❙❙ pause' : '▶ play'}
      </button>
      {#each [1, 2, 4] as s}
        <button class:on={app.speed === s} onclick={() => (app.speed = s)}>{s}×</button>
      {/each}
      <button onclick={restart}>↻ replay</button>
    </div>
  </div>

  <Timeline onselect={(id) => (app.selectedStage = app.selectedStage === id ? null : id)} />

  <div class="split">
    <div class="card">
      <h3>Registered</h3>
      <table>
        <thead><tr><th>workflow</th><th>queue</th><th>runs</th><th>state</th></tr></thead>
        <tbody>
          {#each app.workflows as w (w.name)}
            <tr>
              <td><b>{w.name}</b> <span class="dim">{w.workflow}</span></td>
              <td class="mono dim">{w.queue}</td>
              <td class="num">{w.runs}</td>
              <td>
                {#if w.served}<span class="pill ok">served</span>
                {:else}<span class="pill off">not served</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="note">
        <b>not served</b> is a state, not an error — the queue exists and nothing polls it. A run
        started against one waits rather than failing, which is the thing worth seeing before you
        start it.
      </p>
    </div>

    <div class="card">
      <h3>Event log <span class="dim">({app.run.events.length})</span></h3>
      <ol class="events">
        {#each app.run.events.slice(-14).reverse() as e (e.id)}
          <li>
            <span class="mono dim">{fmt(e.at - app.run.startedAt)}</span>
            <span class="ev" class:fail={e.type.endsWith('Failed')}>{e.type}</span>
            <span class="dim">{e.detail}</span>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</section>

<style>
  .page { display: flex; flex-direction: column; gap: 18px; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  h2 { font-size: 15px; margin: 0; font-weight: 600; }
  h3 { font-size: 12px; margin: 0 0 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
  .ctl { display: flex; gap: 6px; }
  .ctl button { font-size: 11px; padding: 3px 9px; border-radius: 5px; border: 1px solid var(--line);
                background: var(--panel); color: var(--dim); cursor: pointer; font-family: var(--mono); }
  .ctl button.on { color: var(--blue); border-color: color-mix(in srgb, var(--blue) 45%, transparent); }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 860px) { .split { grid-template-columns: 1fr; } }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: var(--panel);
          min-width: 0; /* grid items default to min-width:auto — without this the table widens the PAGE */ }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-weight: 500; color: var(--dim); font-size: 10px; text-transform: uppercase;
       letter-spacing: .05em; padding: 0 18px 6px 0; border-bottom: 1px solid var(--line); }
  /* A GUTTER, because the cells are `nowrap` so the table can scroll inside its card. Without it
     `redditscrape RedditScrape` ran straight into `wf-redditscrape-0.1.0` with no space at all. */
  td { padding: 7px 18px 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent); }
  td:last-child, th:last-child { padding-right: 0; }
  .num { text-align: right; font-family: var(--mono); }
  .mono { font-family: var(--mono); }
  .dim { color: var(--dim); }
  .pill { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); }
  .pill.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); }
  .pill.off { color: var(--dim); }
  .note { font-size: 11px; color: var(--dim); margin: 10px 0 0; line-height: 1.5; }
  /* TWO ROWS, NAMED. This was `grid-template-columns: 52px 1fr` with the third child forced back
     to column 2 — which collapsed the row heights and overlapped the event type with its detail,
     unreadably, at every width under about 500px. Areas say where all three go. */
  .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;
            max-height: 232px; overflow: auto; font-size: 11px; }
  .events li { display: grid; grid-template-columns: 52px minmax(0, 1fr);
               grid-template-areas: "at type" ". detail"; gap: 2px 8px; align-items: baseline; }
  .events li > :nth-child(1) { grid-area: at; }
  .ev { grid-area: type; color: var(--fg); overflow-wrap: anywhere; }
  .ev.fail { color: var(--red); }
  .events li > :nth-child(3) { grid-area: detail; font-size: 10px; overflow-wrap: anywhere; }
  /* ── PHONE ─────────────────────────────────────────────────────────────────────────────────
     Measured at 390px and 320px with a headless browser, because "it looks responsive" and "it
     does not scroll sideways" are different claims and only one of them is checkable. */
  @media (max-width: 560px) {
    .split { gap: 10px; }
    .card { padding: 12px; }
    .ctl { width: 100%; }
    .ctl button { flex: 1; }
    .events li { grid-template-columns: 46px minmax(0, 1fr); }
  }
</style>
