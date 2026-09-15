<script>
  /**
   * The run, as a Temporal-UI timeline: one lane per stage, one bar per Unit, a playhead that moves.
   *
   * ── WHY A TIMELINE AND NOT A PROGRESS BAR ───────────────────────────────────────────────────
   *
   * A single percentage answers "how far", which is the least interesting question about a Run. It
   * cannot show that node n3 started four seconds late, that one Unit is taking six times its
   * neighbours, or that the failure happened early and everything after it was wasted. Laid out
   * against time, all three are one glance.
   *
   * The bar across the top is still there, because "how far" is the question you ask from across
   * the room.
   *
   * ── EVERY BAR IS POSITIONED IN PERCENT ──────────────────────────────────────────────────────
   *
   * Not pixels. The span grows while the run runs, so a pixel layout would need a resize observer
   * and a recompute; percentages against a `span()` that changes make the whole thing reflow for
   * free, and it stays correct at any width — which is what makes it usable in a side pane.
   */
  import { app, span, fmt } from './model.svelte.js';

  let { onselect } = $props();

  // DERIVED, NOT COPIED. `$derived` recomputes only when something it read actually changed, so a
  // Unit finishing does not recompute the lane labels.
  const total = $derived(span());
  const pct = (ms) => `${Math.min(100, (ms / total) * 100)}%`;

  const counts = $derived.by(() => {
    const all = app.run.stages.flatMap((s) => s.bars);
    return {
      total: all.length,
      done: all.filter((b) => b.state === 'completed').length,
      failed: all.filter((b) => b.state === 'failed').length,
      running: all.filter((b) => b.state === 'running').length,
    };
  });

  // Gridlines every second, capped so a long run does not draw a thousand of them.
  const ticks = $derived.by(() => {
    // Tick density follows the TRACK, not just the span: 1s lines across 230px of phone is a smear.
    const narrow = typeof window !== 'undefined' && window.innerWidth < 560;
    const step = total > 40000 ? 10000 : total > 12000 ? 5000 : narrow ? 2000 : 1000;
    const out = [];
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  });
</script>

<div class="tl">
  <header>
    <div class="hd">
      <span class="rid">{app.run.runId}</span>
      <span class="badge {app.run.status}">{app.run.status}</span>
      <span class="muted">{app.run.type}</span>
    </div>
    <div class="stats">
      <span><b>{counts.done}</b>/{counts.total} units</span>
      {#if counts.running}<span class="run-n">{counts.running} running</span>{/if}
      {#if counts.failed}<span class="fail-n">{counts.failed} failed</span>{/if}
      <span class="muted">{fmt(app.now)}</span>
      <span class="muted" title="ADR 0046 counts the bill in events">{app.run.historyLength} ev</span>
    </div>
  </header>

  <!-- HOW FAR, for the glance. Units, not time: a run does not know its own duration in advance. -->
  <div class="overall" role="progressbar" aria-valuenow={counts.done} aria-valuemin="0" aria-valuemax={counts.total || 1}>
    <div class="fill done" style:width={counts.total ? `${(counts.done / counts.total) * 100}%` : '0%'}></div>
    <div class="fill failed" style:width={counts.total ? `${(counts.failed / counts.total) * 100}%` : '0%'}></div>
  </div>

  <div class="grid">
    {#each ticks as t}
      <div class="gl" style:left={pct(t)}><span>{fmt(t)}</span></div>
    {/each}
    <!-- The playhead. It is the one element that moves every frame, and it moves alone. -->
    <div class="playhead" style:left={pct(app.now)}></div>

    {#each app.run.stages as st (st.id)}
      <div class="lane" class:sel={app.selectedStage === st.id}>
        <button class="label" onclick={() => onselect?.(st.id)}>
          <span class="nm">{st.actor}</span>
          <span class="nd">{st.node}</span>
        </button>
        <div class="track">
          {#each st.bars as b (b.i)}
            {@const end = b.closedAt || app.now}
            {#if app.now >= b.startedAt}
              <div
                class="bar {b.state}"
                style:left={pct(b.startedAt)}
                style:width={pct(Math.max(end - b.startedAt, 60))}
                title="{st.actor}/{st.node} unit {b.i} — {b.state} — {fmt(end - b.startedAt)}"
              >
                {#if end - b.startedAt > total * 0.06}
                  <span class="dur">{fmt(end - b.startedAt)}</span>
                {/if}
              </div>
            {/if}
          {/each}
          {#if st.bars.length === 0}
            <div class="pending" style:left={pct(st.startedAt - app.run.startedAt)}>waiting</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .tl { display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .hd { display: flex; align-items: baseline; gap: 10px; }
  .rid { font-family: var(--mono); font-size: 13px; color: var(--fg); }
  .muted { color: var(--dim); font-size: 12px; }
  .stats { display: flex; gap: 14px; font-size: 12px; align-items: baseline; }
  .stats b { color: var(--fg); }
  .run-n { color: var(--blue); }
  .fail-n { color: var(--red); }

  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); text-transform: lowercase; }
  .badge.running { color: var(--blue); border-color: color-mix(in srgb, var(--blue) 40%, transparent); }
  .badge.completed { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); }
  .badge.failed { color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, transparent); }

  .overall { position: relative; height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; display: flex; }
  .fill { height: 100%; transition: width 120ms linear; }
  .fill.done { background: var(--green); }
  .fill.failed { background: var(--red); }

  .grid { position: relative; border: 1px solid var(--line); border-radius: 8px; padding: 26px 0 8px; background: var(--panel); overflow: hidden; }
  .gl { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line); opacity: .5; }
  .gl span { position: absolute; top: 5px; left: 5px; font-size: 10px; color: var(--dim); font-family: var(--mono); white-space: nowrap; }
  .playhead { position: absolute; top: 20px; bottom: 0; width: 1px; background: var(--blue); box-shadow: 0 0 6px var(--blue); z-index: 3; }

  .lane { display: grid; grid-template-columns: 132px 1fr; align-items: center; height: 26px; }
  .lane.sel { background: color-mix(in srgb, var(--blue) 10%, transparent); }
  .label { display: flex; gap: 6px; align-items: baseline; padding: 0 10px; background: none; border: 0; cursor: pointer; text-align: left; overflow: hidden; }
  .nm { font-size: 12px; color: var(--fg); font-family: var(--mono); }
  .nd { font-size: 10px; color: var(--dim); }
  .track { position: relative; height: 100%; }

  .bar { position: absolute; top: 6px; height: 14px; border-radius: 3px; min-width: 3px; overflow: hidden;
         transition: width 120ms linear; }
  .bar.running { background: linear-gradient(90deg, color-mix(in srgb, var(--blue) 55%, transparent), var(--blue)); }
  .bar.completed { background: color-mix(in srgb, var(--green) 70%, transparent); }
  .bar.failed { background: var(--red); }
  .dur { font-size: 9px; color: #0b0f14; padding-left: 4px; line-height: 14px; font-family: var(--mono); }
  .pending { position: absolute; top: 7px; font-size: 10px; color: var(--dim); font-style: italic; }

  /* ── PHONE ────────────────────────────────────────────────────────────────────────────────
     The label gutter was 132px of a 390px screen — a third of the width spent on names, leaving
     the bars too short to compare, which is the one thing this view is for. The names truncate
     instead, and the in-bar duration goes: at this width adjacent bars overlapped their labels. */
  @media (max-width: 560px) {
    .lane { grid-template-columns: 86px 1fr; }
    .label { padding: 0 6px; }
    .nm { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nd { font-size: 9px; }
    .dur { display: none; }
    .gl span { font-size: 9px; }
    header { gap: 8px; }
    .stats { gap: 10px; flex-wrap: wrap; }
  }
</style>
