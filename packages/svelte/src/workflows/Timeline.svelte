<script lang="ts">
  /**
   * A Run, laid out against time.
   *
   * ── PERCENTAGES, NOT PIXELS ─────────────────────────────────────────────────────────────────────
   *
   * The span grows while a run is running, so a pixel layout needs a resize observer and a
   * recompute. Percentages against a span that changes reflow for free and stay correct at any
   * width — which is what makes this usable in a 390px panel, where it is a chart rather than a
   * table that has been squeezed.
   *
   * ── THE PROGRESS BAR IS STILL HERE ──────────────────────────────────────────────────────────────
   *
   * "How far" is the question you ask from across the room, and the lanes cannot answer it at a
   * glance. It counts BARS, not time: a run does not know its own duration in advance, so a
   * time-based percentage would be a guess presented as a measurement.
   */
  import { buildTimeline, short, type Timeline } from '@kontra/console-core/run/timeline';
  import type { RunEvent } from '@kontra/console-core/run/api';

  interface Props {
    events: readonly RunEvent[];
    /** Seconds since the run began, when it is still running. Open bars are drawn to here. */
    now?: number;
    onpick?: (id: number) => void;
  }
  let { events, now, onpick }: Props = $props();

  const tl = $derived<Timeline>(buildTimeline(events, now));
  const pct = (s: number) => `${Math.min(100, (s / tl.span) * 100)}%`;

  const done = $derived(tl.lanes.flatMap((l) => l.bars).filter((b) => !b.open && !b.failed).length);
  const total = $derived(tl.lanes.flatMap((l) => l.bars).length);

  /**
   * MOMENTS, GROUPED BY WHAT THEY ARE.
   *
   * A run with no dispatched work still has a shape — `approve` is a timer, a signal, an answer and
   * a completion — and this used to draw all of it as one row of identical ticks, under a sentence
   * saying there was nothing to show. Rows per category is the run's own structure: what the
   * workflow did, what it waited on, what arrived from outside.
   */
  const momentLanes = $derived.by(() => {
    const by = new Map<string, typeof tl.moments>();
    for (const m of tl.moments) by.set(m.cat, [...(by.get(m.cat) ?? []), m]);
    // A fixed order, so two runs of the same workflow do not draw their rows in different places.
    const ORDER = ['workflow', 'signal', 'timer', 'task', 'activity', 'child', 'failure'];
    return [...by.entries()].sort(
      (a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99)
    );
  });

  /** Did the history END — a terminal workflow event is the only thing that says so. */
  const closed = $derived(
    tl.moments.some((m) => /WorkflowExecution(Completed|Failed|Terminated|Canceled|TimedOut)/i.test(m.type))
  );
  const ended = $derived(tl.moments.find((m) => /WorkflowExecution(Completed|Failed|Terminated|Canceled|TimedOut)/i.test(m.type)));

  // Gridlines: about six, on a round number. A line per second across 230px of phone is a smear.
  const ticks = $derived.by(() => {
    const raw = tl.span / 6;
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300].find((s) => s >= raw) ?? 600;
    const out: number[] = [];
    // THE LAST TICK IS DROPPED WHEN IT CROWDS THE EDGE. Its label is drawn to the right of its
    // line and the chart clips, so a gridline at 97% renders as a truncated number — `15` where
    // the axis means `15s`, which is worse than no label at all.
    for (let t = 0; t <= tl.span * 0.94; t += step) out.push(t);
    return out;
  });
</script>

<div class="tl">
  <div class="stats">
    {#if total > 0}
      <span><b>{done}</b>/{total} done</span>
    {:else}
      <!-- `0/0 done` IS NOT A READING. A run that dispatched nothing has no work to be a fraction
           of, so the honest number is what it DID do: its events. -->
      <span><b>{tl.moments.length}</b> event{tl.moments.length === 1 ? '' : 's'}</span>
    {/if}
    {#if tl.running}<span class="running">{tl.running} running</span>{/if}
    {#if tl.failed}<span class="failed">{tl.failed} failed</span>{/if}
    {#if total === 0 && ended}
      <span class:failed={/Failed|Terminated|Canceled|TimedOut/i.test(ended.type)}>
        {ended.type.replace('WorkflowExecution', '').toLowerCase()}
      </span>
    {/if}
    <span class="dim">{short(tl.span)}</span>
  </div>

  <div
    class="overall"
    role="progressbar"
    aria-valuenow={total ? done : closed ? 1 : 0}
    aria-valuemin={0}
    aria-valuemax={total || 1}
  >
    {#if total > 0}
      <div class="fill ok" style:width={`${(done / total) * 100}%`}></div>
      <div class="fill bad" style:width={`${(tl.failed / total) * 100}%`}></div>
    {:else}
      <!-- NO WORK TO MEASURE, so the bar says whether the run is OVER rather than inventing a
           fraction: full when the history ended, and a moving sliver while it has not. -->
      <div
        class="fill"
        class:ok={closed && !tl.failed}
        class:bad={closed && tl.failed > 0}
        class:going={!closed}
        style:width={closed ? '100%' : '18%'}
      ></div>
    {/if}
  </div>

  {#if tl.lanes.length === 0 && tl.moments.length === 0}
    <p class="empty">Nothing in this history yet.</p>
  {:else}
    <div class="chart">
      {#each ticks as t (t)}
        <div class="gl" style:left={pct(t)}><span>{short(t)}</span></div>
      {/each}

      {#each tl.lanes as lane (lane.key)}
        <div class="lane">
          <span class="label mono" title={lane.label}>{lane.label}</span>
          <div class="track">
            {#each lane.bars as b (b.id)}
              <button
                class="bar {b.cat}"
                class:failed={b.failed}
                class:open={b.open}
                style:left={pct(b.start)}
                style:width={pct(Math.max(b.end - b.start, tl.span * 0.004))}
                title="{b.label} — {short(b.end - b.start)}{b.attempt > 1 ? ` · attempt ${b.attempt}` : ''}"
                onclick={() => onpick?.(b.id)}
              ></button>
            {/each}
          </div>
        </div>
      {/each}

      <!-- MOMENTS ON THE AXIS, ONE ROW PER KIND. A signal or a timer has a time and no duration;
           drawn as a tick so it can be seen next to the work it interrupted, without pretending to
           be work — and kept in its own row, because "what this workflow waited on" and "what
           arrived from outside" are different questions. -->
      {#each momentLanes as [cat, ms] (cat)}
        <div class="lane moments">
          <span class="label dim">{cat}</span>
          <div class="track">
            {#each ms as m (m.id)}
              <button class="moment {cat}" class:failed={m.failed} style:left={pct(m.t)}
                      title="{m.type} — {m.label}" onclick={() => onpick?.(m.id)}></button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tl { display: flex; flex-direction: column; gap: var(--s-2); }
  .moment.signal { background: var(--accent); }
  .moment.timer { background: var(--warn); }
  .moment.workflow { background: var(--fg); }
  .moment.task { background: var(--dim); }
  /* STILL GOING, and it says so by moving. A static sliver reads as a bar stuck at 18%. */
  .fill.going {
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1.6s ease-in-out infinite;
  }
  @keyframes sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(560%); } }
  @media (prefers-reduced-motion: reduce) { .fill.going { animation: none; } }
  .stats { display: flex; gap: var(--s-3); font-size: var(--t-small); align-items: baseline; flex-wrap: wrap; }
  .stats b { color: var(--fg); }
  .running { color: var(--accent); }
  .failed { color: var(--bad); }
  .dim { color: var(--dim); }

  .overall { position: relative; height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; display: flex; }
  .fill { height: 100%; transition: width 120ms linear; }
  .fill.ok { background: var(--ok); }
  .fill.bad { background: var(--bad); }

  .chart {
    position: relative; border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--panel); padding: 22px 0 var(--s-2); overflow: hidden;
  }
  .gl { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line); opacity: 0.5; }
  .gl span { position: absolute; top: 4px; left: 4px; font-size: var(--t-micro); color: var(--dim); font-family: var(--mono); white-space: nowrap; }

  .lane { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; height: 24px; }
  .label {
    padding: 0 var(--s-2); font-size: var(--t-micro); color: var(--fg);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .track { position: relative; height: 100%; }

  .bar {
    position: absolute; top: 5px; height: 14px; border: 0; border-radius: 3px; min-width: 2px;
    cursor: pointer; padding: 0; background: color-mix(in srgb, var(--ok) 70%, transparent);
    transition: width 120ms linear;
  }
  .bar.child { background: color-mix(in srgb, var(--accent) 60%, transparent); }
  .bar.open { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent)); }
  .bar.failed { background: var(--bad); }

  .moments .label { color: var(--dim); }
  .moment {
    position: absolute; top: 9px; width: 6px; height: 6px; margin-left: -3px; padding: 0;
    border: 0; border-radius: 50%; background: var(--dim); cursor: pointer;
  }
  .moment.failed { background: var(--bad); }

  .empty { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }

  @media (min-width: 720px) {
    .lane { grid-template-columns: 200px minmax(0, 1fr); }
    .label { font-size: var(--t-small); }
  }
</style>
