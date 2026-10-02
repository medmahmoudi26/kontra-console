<script lang="ts">
  /**
   * What a Run is doing, as steps — the region the run page leads with.
   *
   * ── IT LEADS BECAUSE FOR THE FIRST HALF-MINUTE IT IS THE ONLY REGION WITH ANYTHING IN IT ────────
   *
   * Measured on the canary: 34 of 57 seconds are spent bringing a Fleet up before one Unit is
   * swept. Nothing reaches the log rail and no row reaches the lake in that window, so a page that
   * opens on Input and Dataset opens on two empty boxes and reads as a hang. This says which step
   * is in flight and how long it has been, from the first second.
   *
   * ── TWO READINGS OF ONE HISTORY, AND THE RAW ONE IS A PEER ──────────────────────────────────────
   *
   * `Steps` is the reduction (`run/steps.ts`); `Temporal` is the same events with nothing renamed,
   * no filtering and its own type names. The friendly view never replaces the real one, and the raw
   * one costs no extra fetch — both read the array this component was handed — so nobody is ever
   * tempted to make the vocabulary the only view because checking it is expensive.
   *
   * ── WHAT THIS DELIBERATELY DOES NOT KNOW ────────────────────────────────────────────────────────
   *
   * A wedged run — one whose workflow task is on attempt 11 and will never succeed — is INVISIBLE
   * here, and no amount of work on this component can fix that: Temporal writes no event per
   * workflow-task retry, so the history simply stops growing and every reading derived from it says
   * `running` forever. The attempt counter lives on `DescribeWorkflowExecution.pendingWorkflowTask`,
   * which reaches the browser as `RunDetail.activity` and is drawn by the caller as a chip. Named
   * here so the absence is a decision and not an oversight.
   */
  import {
    buildSteps,
    causes,
    isOpen,
    nameStep,
    rootCause,
    shortSeconds,
    stepClock,
    type Step,
  } from '@kontra/console-core/run/steps';
  import type { RunEvent } from '@kontra/console-core/run/api';

  interface Props {
    events: readonly RunEvent[];
    /** Seconds since the run's first event, for drawing an open step against something. */
    now: number;
    /** Nothing has closed this run. Decides whether an empty history reads as "starting" or "gone". */
    live: boolean;
    /** Why there is no history, when there is none. */
    error?: string;
    loading?: boolean;
  }
  let { events, now, live, error = '', loading = false }: Props = $props();

  let tab = $state<'steps' | 'temporal'>('steps');

  const steps = $derived(buildSteps(events));
  const open = $derived(steps.filter(isOpen));
  const done = $derived(steps.filter((s) => s.state === 'done').length);
  const failed = $derived(steps.filter((s) => s.state === 'failed'));
  /** Workflow-task triples — the cluster's own bookkeeping. 45 of the canary's 80 events. */
  const bookkeeping = $derived(events.filter((e) => e.cat === 'task').length);
  const span = $derived(Math.max(now, ...events.map((e) => e.t), 1));

  const terminal = $derived(
    events.find((e) => /^WorkflowExecution(Completed|Failed|TimedOut|Canceled|Terminated)$/.test(e.type))
  );

  /**
   * The failure the banner is leading with, so the step that produced it does not print sixty
   * lines of the same Pulumi transcript again a few hundred pixels further down.
   */
  const bannerChain = $derived(failed.length ? causes(failed[failed.length - 1]!.error) : []);
  const bannerRoot = $derived(rootCause(bannerChain));

  interface Verdict {
    tone: 'ok' | 'bad' | 'busy';
    head: string;
    sub: string;
  }

  const verdict = $derived.by<Verdict>(() => {
    if (terminal && terminal.type.endsWith('Completed')) {
      return { tone: 'ok', head: `Finished in ${shortSeconds(terminal.t)}`, sub: '' };
    }
    if (terminal) {
      return {
        tone: 'bad',
        head: `${terminal.type.replace('WorkflowExecution', '').toLowerCase()} after ${shortSeconds(terminal.t)}`,
        sub: 'The workflow itself stopped. Nothing further will run.',
      };
    }
    if (failed.length && !open.length) {
      return {
        tone: 'bad',
        head: `${nameStep(failed[failed.length - 1]!).title} failed`,
        sub: 'The workflow has not yet reacted to it.',
      };
    }
    if (open.length) {
      const s = open[open.length - 1]!;
      const n = nameStep(s);
      return {
        tone: 'busy',
        head: n.title,
        sub: `${n.what} ${shortSeconds(now - s.t0)} so far.`.trim(),
      };
    }
    if (steps.length === 0) {
      // THE SCREEN FOR THE FIRST HALF-SECOND — what a run page opened straight from the Run button
      // shows. It says what it is waiting for rather than drawing an empty chart.
      return {
        tone: 'busy',
        head: 'Starting',
        sub: 'The run exists and has an id. Its first workflow task is being decided — steps appear here the moment the workflow schedules one.',
      };
    }
    return {
      tone: 'busy',
      head: 'Between steps',
      sub: 'The last step returned and the workflow is deciding what to do next.',
    };
  });

  const pct = (s: number): string => `${Math.min(100, (s / span) * 100)}%`;
  const width = (s: Step): string => {
    const end = s.t1 ?? now;
    return `${Math.max(0.6, Math.min(100, ((end - s.t0) / span) * 100))}%`;
  };
  const stateOf = (s: Step): 'done' | 'failed' | 'running' =>
    s.state === 'failed' ? 'failed' : isOpen(s) ? 'running' : 'done';
</script>

<div class="prog" data-testid="run-progress">
  <div class="prow">
    <div class="verdict">
      <span class="vdot {verdict.tone}"></span>
      <div class="vtext">
        <div class="vhead" data-testid="run-verdict">{verdict.head}</div>
        {#if verdict.sub}<p class="vsub">{verdict.sub}</p>{/if}
        <div class="vmeta">
          <span><b>{done}</b> of {steps.length} step{steps.length === 1 ? '' : 's'} done</span>
          {#if open.length}<span class="busy"><b>{open.length}</b> in flight</span>{/if}
          {#if failed.length}<span class="bad"><b>{failed.length}</b> failed</span>{/if}
          <span><b>{shortSeconds(now)}</b> elapsed</span>
          <span>{events.length} event{events.length === 1 ? '' : 's'}<span class="faint"> · {bookkeeping} bookkeeping</span></span>
        </div>

        <!-- THE ONE SENTENCE THAT SAYS WHAT TO FIX, lifted out of the transcript it is buried in.
             It was already reaching the browser on the event's `detail` and was never drawn. -->
        {#if bannerChain.length}
          <div class="fix" data-testid="run-failure">
            <span class="flab">why</span>
            <ul class="chain">
              {#each bannerChain as c (c.msg)}
                <li class:root={c.root}><span class="who">{c.who}</span><span class="msg">{c.msg}</span></li>
              {/each}
            </ul>
            <details>
              <summary>the failure exactly as Temporal recorded it</summary>
              <pre>{failed[failed.length - 1]?.error}</pre>
            </details>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'steps'} data-testid="tab-steps" onclick={() => (tab = 'steps')}>
      Steps<span class="count">{steps.length}</span>
    </button>
    <!-- HONESTY IS A TAB, not a footnote. Same events, Temporal's own names, nothing dropped. -->
    <button role="tab" aria-selected={tab === 'temporal'} data-testid="tab-temporal" onclick={() => (tab = 'temporal')}>
      Temporal<span class="count">{events.length}</span>
    </button>
  </div>

  {#if error}
    <p class="note err" role="alert">{error}</p>
  {:else if tab === 'steps'}
    {#if steps.length === 0}
      <div class="empty">
        <p class="e1">{loading ? 'Reading the history…' : live ? 'Nothing dispatched yet.' : 'This run dispatched nothing.'}</p>
        <p class="e2">
          {#if live}
            Steps appear here the moment the workflow schedules one — usually within a second.
          {:else}
            Temporal has no record of any activity, child workflow or dispatch for this run.
          {/if}
        </p>
      </div>
    {:else}
      <div class="steps">
        {#each steps as s, i (s.openId)}
          {@const n = nameStep(s)}
          {@const st = stateOf(s)}
          <div class="step" class:live={st === 'running'} data-testid="run-step">
            <div class="marker">
              <span class="d {st}"></span>
              {#if i < steps.length - 1}<span class="rail"></span>{/if}
            </div>
            <div class="sbody">
              <div class="sline">
                <span class="sname">{n.title}{#if s.repeats}<span class="seq">#{s.seq}</span>{/if}</span>
                {#if s.kind === 'nexus'}<span class="pill work">the work</span>{/if}
                {#if st === 'failed'}<span class="pill bad">failed</span>{/if}
                {#if st === 'running'}<span class="pill busy">in flight</span>{/if}
                <span class="stime">{stepClock(s, now)}</span>
              </div>
              {#if n.what}<p class="swhat">{n.what}</p>{/if}
              <span class="ssub">{n.sub}</span>
              <div class="track"><div class="bar {s.kind} {st}" style:left={pct(s.t0)} style:width={width(s)}></div></div>
              {#if s.error}
                {@const chain = causes(s.error)}
                <!-- A FAILED STEP ALWAYS PRINTS ITS FAILURE.
                     This used to render "This is the failure named at the top." and nothing else
                     whenever the step's root cause matched the banner's — no chain, no raw record.
                     The intent was not to print sixty lines of Pulumi twice, which is right; the
                     effect was that a failed step showed NO error at all. On a run with several
                     failed steps that is unreadable: every one of them points at the same banner,
                     so nothing says which step hit what, and the one question the region exists to
                     answer — why did THIS fail — has no answer anywhere on the page.
                     Deduplication now collapses the CHAIN to its root line, instead of replacing
                     the error with a cross-reference. The raw record stays one disclosure away. -->
                {@const dupe = rootCause(chain) !== '' && rootCause(chain) === bannerRoot}
                {@const shown = dupe ? chain.filter((c) => c.root) : chain}
                <div class="fix">
                  <ul class="chain">
                    {#each shown as c (c.msg)}
                      <li class:root={c.root}><span class="who">{c.who}</span><span class="msg">{c.msg}</span></li>
                    {/each}
                  </ul>
                  <details><summary>as Temporal recorded it</summary><pre>{s.error}</pre></details>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="note">
      Temporal's history, unchanged — every event, its own type name, its own attempt counter.
      <b>{bookkeeping} of {events.length}</b> rows are the workflow-task triples the cluster writes
      for its own bookkeeping.
    </p>
    <div class="tw">
      <table>
        <thead><tr><th>id</th><th>t</th><th>type</th><th>att</th><th>dur</th><th>detail</th></tr></thead>
        <tbody>
          {#each events as e (e.id)}
            <tr class:bk={e.cat === 'task'} class:fail={e.cat === 'failure'}>
              <td>{e.id}</td>
              <td>{e.t.toFixed(3)}</td>
              <td>{e.type}</td>
              <td>{e.attempt}</td>
              <td>{e.dur ? e.dur.toFixed(3) : ''}</td>
              <td class="d">{e.summary ? `“${e.summary}” · ` : ''}{e.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .prog {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .prow { padding: var(--s-4); border-bottom: 1px solid var(--line); }
  .verdict { display: flex; gap: var(--s-3); align-items: flex-start; }
  .vdot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; margin-top: 7px; background: var(--dim); }
  .vdot.ok { background: var(--ok); }
  .vdot.bad { background: var(--bad); }
  .vdot.busy { background: var(--accent); animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
    50% { box-shadow: 0 0 0 5px transparent; }
  }
  .vtext { display: flex; flex-direction: column; gap: var(--s-1); min-width: 0; flex: 1; }
  .vhead { font-size: var(--t-lead); font-weight: 600; line-height: var(--lh-tight); text-wrap: balance; }
  .vsub { font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body); max-width: 78ch; margin: 0; }
  .vmeta { display: flex; gap: var(--s-4); flex-wrap: wrap; font-size: var(--t-small); color: var(--dim); margin-top: var(--s-1); }
  .vmeta b { color: var(--fg); font-weight: 600; }
  .vmeta .busy { color: var(--accent); }
  .vmeta .bad { color: var(--bad); }
  .faint { color: var(--dim); opacity: 0.7; }

  .fix {
    margin-top: var(--s-2);
    border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--line));
    background: color-mix(in srgb, var(--warn) 6%, var(--panel));
    border-radius: var(--radius); padding: var(--s-3);
    display: flex; flex-direction: column; gap: var(--s-2);
  }
  .fix .flab { font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.09em; color: var(--warn); }
  .chain { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; }
  .chain li { font-size: var(--t-small); line-height: var(--lh-body); display: flex; gap: var(--s-2); align-items: flex-start; }
  .chain .who { color: var(--dim); font-family: var(--mono); font-size: var(--t-micro); flex: 0 0 auto; margin-top: 2px; min-width: 8ch; }
  .chain .msg { min-width: 0; overflow-wrap: anywhere; color: var(--dim); }
  .chain li.root .msg { color: var(--fg); }
  .fix details summary { font-size: var(--t-small); color: var(--dim); cursor: pointer; }
  .fix details pre {
    margin: var(--s-2) 0 0; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-3); overflow-x: auto; max-height: 300px; font-size: var(--t-small);
    line-height: var(--lh-body); color: var(--dim); white-space: pre;
  }

  .tabs { display: flex; gap: var(--s-1); padding: 0 var(--s-4); border-bottom: 1px solid var(--line); background: var(--track); }
  .tabs button {
    background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim);
    padding: var(--s-3) var(--s-2); cursor: pointer; font-size: var(--t-small);
  }
  .tabs button[aria-selected='true'] { color: var(--fg); border-bottom-color: var(--accent); }
  .tabs .count { color: var(--dim); font-size: var(--t-micro); margin-left: var(--s-1); }

  .steps { display: flex; flex-direction: column; }
  .step {
    display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: var(--s-3);
    padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--track); align-items: start;
  }
  .step:last-child { border-bottom: 0; }
  .step.live { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .marker { display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 5px; height: 100%; }
  .marker .d { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); flex: 0 0 auto; }
  .marker .d.running { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
  .marker .d.failed { background: var(--bad); }
  .marker .rail { width: 1px; flex: 1; background: var(--line); min-height: 8px; }
  .sbody { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .sline { display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap; }
  .sname { font-size: var(--t-body); font-weight: 500; }
  .sname .seq { color: var(--dim); font-weight: 400; font-size: var(--t-small); margin-left: var(--s-1); }
  .stime { margin-left: auto; font-family: var(--mono); font-size: var(--t-small); color: var(--dim); }
  .swhat { font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body); max-width: 76ch; margin: 0; }
  .ssub { font-family: var(--mono); font-size: var(--t-micro); color: var(--dim); overflow-wrap: anywhere; opacity: 0.8; }
  .track { position: relative; height: 5px; background: var(--track); border-radius: 3px; margin-top: 3px; }
  .bar { position: absolute; top: 0; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--ok) 72%, transparent); }
  .bar.child, .bar.nexus { background: color-mix(in srgb, var(--accent) 62%, transparent); }
  .bar.running { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 40%, transparent), var(--accent)); }
  .bar.failed { background: var(--bad); }
  .pill {
    font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.07em;
    padding: 1px 6px; border-radius: 10px; border: 1px solid var(--line); color: var(--dim);
  }
  .pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  .pill.busy { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .pill.work { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }

  .empty { padding: var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); }
  .empty .e1 { font-size: var(--t-body); margin: 0; }
  .empty .e2 { font-size: var(--t-small); color: var(--dim); max-width: 70ch; line-height: var(--lh-body); margin: 0; }
  .note {
    padding: var(--s-3) var(--s-4); font-size: var(--t-small); color: var(--dim);
    line-height: var(--lh-body); margin: 0; border-bottom: 1px solid var(--line);
  }
  .note b { color: var(--fg); }
  .note.err { color: var(--bad); border-bottom: 0; }

  .tw { overflow-x: auto; max-height: 420px; }
  table { border-collapse: collapse; width: 100%; font-size: var(--t-small); }
  th {
    text-align: left; font-weight: 600; color: var(--dim); font-size: var(--t-micro);
    text-transform: uppercase; letter-spacing: 0.07em; padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line); white-space: nowrap; position: sticky; top: 0; background: var(--track);
  }
  td { padding: 5px var(--s-3); border-bottom: 1px solid var(--track); font-family: var(--mono); white-space: nowrap; vertical-align: top; }
  td.d { white-space: normal; color: var(--dim); font-size: var(--t-micro); max-width: 520px; overflow-wrap: anywhere; }
  tr.bk td { color: var(--dim); opacity: 0.65; }
  tr.fail td { color: var(--bad); }
</style>
