<script lang="ts">
  /**
   * The run page's logs rail — prototype variant A (kontra-console#6, ADR 0050 §1).
   *
   * WHY A RAIL AND NOT A TAB. A Run's logs answer "why did it do that", and the question is always
   * asked WHILE looking at what it did. A tab makes the reader choose between the timeline and the
   * reason; variant B (log-first) and C (a drawer) both lost that, which is why the prototype names
   * A and says not to build the others.
   *
   * THE WIDTH IS FIXED AND THE RUN COLUMN FLEXES, from the prototype's own measurements: a log line
   * is ~80 mono characters, and a rail that re-wraps on every window drag is one nobody reads. The
   * page must never scroll sideways — the rail scrolls, inside itself.
   */
  import {
    filterLogs,
    incompleteCount,
    type Level,
    type LogRecord,
  } from '@kontra/console-core/run/logs';

  export let records: LogRecord[] = [];
  export let loading = false;
  /** A sentence when the backend is unreachable — never an empty list, which reads as "no logs". */
  export let error: string | null = null;

  let text = '';
  let floor: Level = 'info';
  let onlyIncomplete = false;

  $: incomplete = incompleteCount(records);
  $: shown = filterLogs(records, { text, floor, onlyIncomplete });

  const time = (ts: number): string =>
    new Date(ts).toISOString().slice(11, 19);

  /**
   * WHICH RECORD a line is about, from its structured fields.
   *
   * This is the second half of "show the full error AND which record" (kontra-console#6): a dropped
   * or errored unit is only debuggable if the reader can see BOTH the whole message — never
   * truncated, `.msg` wraps — and the record it happened on. VictoriaLogs carries stream fields
   * verbatim (`logs.ts` — `_time`/`_msg` plus whatever the emitter attached), so `fields` is where a
   * `host`/`endpoint`/`point`/`record`/`unit` id rides. Rendered as `k=v`, dim, under the message.
   */
  const recordOf = (r: LogRecord): string =>
    r.fields
      ? Object.entries(r.fields)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join('  ')
      : '';
</script>

<aside class="rail">
  <header>
    <h3>logs</h3>
    <!-- THE COUNT IS OF WHAT IS SHOWN OVER WHAT EXISTS, so a filter that hides everything reads as
         a filter rather than as an empty backend. -->
    <span class="count mono">{shown.length}/{records.length}</span>
  </header>

  <div class="controls">
    <input class="filter mono" bind:value={text} placeholder="filter" aria-label="filter logs" />
    <select bind:value={floor} aria-label="minimum level" class="mono">
      <option value="debug">debug</option>
      <option value="info">info</option>
      <option value="warn">warn</option>
      <option value="error">error</option>
    </select>
    <!-- ADR 0050 §2's whole condition, as one button. It IGNORES the level floor on purpose: a
         completeness claim emitted at INFO must stay findable for a reader who raised the floor,
         which is the demotion the migration away from `speak` is warned against. -->
    <button
      class="inc"
      class:on={onlyIncomplete}
      disabled={incomplete === 0}
      aria-pressed={onlyIncomplete}
      on:click={() => (onlyIncomplete = !onlyIncomplete)}
      title="results that are not what a reader would assume (ADR 0050 §2)"
    >
      incomplete {incomplete}
    </button>
  </div>

  <div class="scroller">
    {#if error}
      <p class="err">{error}</p>
    {:else if loading}
      <p class="muted">reading…</p>
    {:else if records.length === 0}
      <p class="muted">
        No logs for this Run. Lines reach here from every Machine's <code>vlagent</code>; a Run that
        never placed a Fleet has none.
      </p>
    {:else if shown.length === 0}
      <p class="muted">Nothing matches this filter — {records.length} lines are hidden.</p>
    {:else}
      <ol>
        {#each shown as r (r.ts + r.msg)}
          <li class="row {r.level}" class:incomplete={r.incomplete} data-testid="log-line">
            <span class="t mono">{time(r.ts)}</span>
            <span class="lv mono">{r.level}</span>
            <span class="msg">
              {r.msg}
              {#if r.fields && Object.keys(r.fields).length > 0}
                <span class="record mono" data-testid="log-record">{recordOf(r)}</span>
              {/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</aside>

<style>
  .rail {
    position: sticky;
    top: var(--s-3);
    border-left: 1px solid var(--line);
    padding-left: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  header { display: flex; align-items: baseline; gap: var(--s-2); }
  h3 { font-size: var(--t-small); font-weight: 600; margin: 0; }
  .count { font-size: var(--t-micro); color: var(--dim); margin-left: auto; }

  .controls { display: flex; gap: var(--s-1); align-items: center; }
  .filter { flex: 1 1 auto; min-width: 0; }
  .filter, select {
    font-size: var(--t-small);
    padding: 2px var(--s-1);
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .inc {
    font-family: var(--mono);
    font-size: var(--t-small);
    padding: 2px var(--s-1);
    background: none;
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
    white-space: nowrap;
  }
  .inc:disabled { opacity: 0.45; cursor: default; }
  .inc.on {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 55%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  /* The RAIL scrolls; the page never does. */
  .scroller { height: calc(100vh - 220px); overflow-y: auto; overflow-x: hidden; }

  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .row {
    display: grid;
    grid-template-columns: 4.5em 3.2em minmax(0, 1fr);
    gap: var(--s-1);
    align-items: baseline;
    font-family: var(--mono);
    /*
     * 12px, NOT the prototype's 11px — ADR 0048 §5 and `scripts/type-scale.mjs` enforce it.
     *
     * The prototype specified 11px and the guard rejected it, correctly: `--t-micro` (11px) is for
     * UPPERCASE labels, and a log message is prose a person reads in a 400px IDE panel. The density
     * argument for 11px is real but it is the argument the React console lost — it had 27
     * declarations at 9px, which is the thing ADR 0048 exists to fix. Density comes from
     * `--lh-tight` and 2px padding instead.
     */
    font-size: var(--t-small);
    line-height: var(--lh-tight);
    padding: 2px var(--s-1);
    border-left: 2px solid transparent;
  }
  .t { color: var(--dim); }
  .lv { color: var(--dim); }
  .msg { overflow-wrap: anywhere; }
  /* WHICH RECORD — a dim line under the (never-truncated) message, so a dropped/errored unit is
     debuggable in place: the full error above, the record it happened on below. */
  .record {
    display: block;
    color: var(--dim);
    font-size: var(--t-small);
    margin-top: 1px;
    overflow-wrap: anywhere;
  }
  .row.error .record { color: color-mix(in srgb, var(--bad) 65%, var(--dim)); }

  .row.debug .msg, .row.debug .lv { color: var(--dim); }
  .row.warn .lv { color: var(--warn); }
  .row.error .lv { color: var(--bad); }
  .row.error .msg { color: var(--bad); }

  /*
   * THE ONE RENDERING REQUIREMENT THAT IS LOAD-BEARING (kontra-console#6).
   *
   * ADR 0050 §2 removes `speak` on the argument that a completeness claim is more useful as a
   * queryable record than as narration — PROVIDED IT DOES NOT GET LOST. This is what stops it
   * getting lost among progress lines at the same level.
   */
  .row.incomplete {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border-left: 2px solid var(--warn);
  }

  .muted { font-size: var(--t-small); color: var(--dim); margin: var(--s-2) 0; line-height: var(--lh-body); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: var(--s-2) 0;
    padding: var(--s-1) var(--s-2);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
    border-radius: var(--radius);
    line-height: var(--lh-body);
  }
  code { font-family: var(--mono); }

  /*
   * UNDER 900px THE RAIL STOPS BEING A RAIL. A 430px column of mono under a timeline is worse than
   * a block after it, so it becomes a full-width block with a border on top instead of the side.
   * The grid that produces the two columns lives in `Workflows.svelte`; this is the rail's half.
   */
  @media (max-width: 900px) {
    .rail {
      position: static;
      border-left: 0;
      padding-left: 0;
      border-top: 1px solid var(--line);
      padding-top: var(--s-3);
    }
    .scroller { height: 22rem; }
  }
</style>
