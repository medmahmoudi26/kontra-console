<script lang="ts">
  /**
   * Runs — every run this control plane has seen, and one run as its record.
   *
   * The surface lists every run newest-first and opens one to its record: the input it was started
   * with, the output it produced, and — the part this stage is about — its LOG and its output
   * DATASET, each showing a dropped/errored unit's FULL error and WHICH RECORD it happened on.
   *
   * TWO HOMES FOR "WHICH RECORD + FULL ERROR", because there are two mechanisms (recon, kontra#28):
   *   • a DATASET-error (capped / erratic / voided) is a successful emit — a row whose `error` /
   *     `void_reason` COLUMN carries the whole text, keyed by the record's own columns (host,
   *     endpoint, point, node…). It is read in the Dataset region below.
   *   • a DROPPED/logged error is a LOG line: the full message, plus the record stamped into its
   *     stream `fields` (`host`/`point`/`error`…). It is read in the Log region, via `LogsRail`.
   * Neither is summarised. A "1 unit dropped" count with no error and no record is exactly the
   * thing this stage removes.
   *
   * TWO STATUS WORDS, NEVER ONE VERDICT — `executionOf` / `materializationOf` (`runState.ts`).
   * NO ROUTER — the surface reads `location` and writes it with `history.pushState`.
   */
  import {
    fetchRuns,
    fetchRun,
    fetchWorkflows,
    type RunRow,
    type RunDetail,
  } from '@kontra/console-core/run/api';
  import {
    datasetLabel,
    fetchRunDatasets,
    lakeMaterialization,
    fetchRunIO,
    pairsOf,
    type RunDataset,
    type RunIO,
  } from '@kontra/console-core/run/record';
  import { executionOf, materializationOf } from '@kontra/console-core/run/runState';
  import { fetchLogs, type LogRecord } from '@kontra/console-core/run/logs';
  import { fetchPreview, type DatasetPreview } from '@kontra/console-core/datasets/preview';
  import { plainText } from '@kontra/console-core/panels/prose';
  import { schemaFields, type FieldNode } from '@kontra/console-core/panels/schemaTree';
  import { formatAddress, parseAddress } from '@kontra/console-core/state/address';
  import LogsRail from '../workflows/LogsRail.svelte';

  function runFromUrl(): string | null {
    const a = parseAddress(location.pathname + location.search);
    return a !== null && a.view === 'runs' ? a.run : null;
  }

  let openRun = $state<string | null>(runFromUrl());
  let rows = $state<RunRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  // detail
  let detail = $state<RunDetail | undefined>(undefined);
  let detailErr = $state('');
  let logs = $state<LogRecord[]>([]);
  let logsLoading = $state(false);
  let logsErr = $state<string | null>(null);
  let preview = $state<DatasetPreview | undefined>(undefined);
  let previewErr = $state('');
  /** The Dataset partitions the LAKE attributes to this run — the authority, see `record.ts`. */
  let datasets = $state<RunDataset[]>([]);
  let datasetsErr = $state('');
  /** Which of them is previewed. A run can write several; the first is the one opened. */
  let shownDataset = $state<RunDataset | undefined>(undefined);
  /** What this run was STARTED with and what it RETURNED. Not the schema — the run. */
  let io = $state<RunIO | undefined>(undefined);
  let ioErr = $state('');
  let ioGone = $state(false);
  // The workflow's declared input/output schemas. They no longer supply the VALUES — `io` does —
  // but they still supply the ORDER a field is read in and the author's sentence about it, which
  // a decoded payload does not carry.
  let inputFields = $state<FieldNode[]>([]);
  let outputFields = $state<FieldNode[]>([]);

  function open(id: string | null): void {
    history.pushState({}, '', formatAddress({ view: 'runs', run: id }));
    openRun = id;
  }

  $effect(() => {
    const onPop = (): void => {
      openRun = runFromUrl();
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  });

  $effect(() => {
    loading = true;
    error = '';
    fetchRuns()
      .then((r) => (rows = r))
      .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)))
      .finally(() => (loading = false));
  });

  // The list drives the detail header's two status words from the same RunRow.
  const current = $derived(rows.find((r) => r.runId === openRun));

  /**
   * Everything a run's record is made of, loaded when one opens.
   *
   * FOUR INDEPENDENT READS, AND ONE FAILING MUST NOT BLANK THE OTHERS. They answer from four
   * different authorities — Temporal for the status and the payloads, VictoriaLogs for the rail,
   * the lake for the Dataset — and a run whose execution Temporal has dropped for retention still
   * has rows and log lines worth showing. Each keeps its own error so the page can say WHICH part
   * is missing instead of rendering as if the run were empty.
   */
  $effect(() => {
    const id = openRun;
    detail = undefined;
    detailErr = '';
    logs = [];
    logsErr = null;
    preview = undefined;
    previewErr = '';
    datasets = [];
    datasetsErr = '';
    shownDataset = undefined;
    io = undefined;
    ioErr = '';
    ioGone = false;
    inputFields = [];
    outputFields = [];
    if (id === null) return;

    fetchRun(id)
      .then((d) => {
        detail = d;
        // The declared schemas still supply the ORDER and the author's sentence per field. The
        // VALUES come from `io` — see the note on `inputFields`.
        fetchWorkflows()
          .then((w) => {
            const desc = w.registered.find((r) => r.name === d.type);
            inputFields = schemaFields(desc?.input) ?? [];
            outputFields = schemaFields(desc?.output) ?? [];
          })
          .catch(() => {});
      })
      .catch((e: unknown) => (detailErr = e instanceof Error ? e.message : String(e)));

    /**
     * THE DATASET COMES FROM THE LAKE, NOT FROM `materializationRecords`.
     *
     * That field is the ADR 0017 ledger's, and it is EMPTY for every v2 Run — `publishBatch`
     * writes lake rows and no ledger record. The region read it, found nothing, and printed "This
     * run recorded no output Dataset" over ten rows the lake had stamped with this run's id.
     *
     * THE PARTITION IS ADDRESSED IN FULL. `version` and `dt` ride into the preview, so what is
     * shown is THIS run's rows — asking by name alone returns whichever run wrote that name last,
     * which on a Dataset several runs append to is somebody else's data under this run's heading.
     */
    fetchRunDatasets(id)
      .then((ds) => {
        datasets = ds;
        const first = ds[0];
        if (!first) return;
        shownDataset = first;
        return fetchPreview({
          dataset: first.name,
          kind: first.kind || 'output',
          ...(first.version ? { version: first.version } : {}),
          ...(first.dt ? { dt: first.dt } : {}),
          limit: 50,
        })
          .then((p) => (preview = p))
          .catch((e: unknown) => (previewErr = e instanceof Error ? e.message : String(e)));
      })
      .catch((e: unknown) => (datasetsErr = e instanceof Error ? e.message : String(e)));

    // `undefined` means Temporal has dropped the execution — an ordinary answer for an old run,
    // and a different fact from "this run was started with nothing".
    fetchRunIO(id)
      .then((r) => {
        io = r;
        ioGone = r === undefined;
      })
      .catch((e: unknown) => (ioErr = e instanceof Error ? e.message : String(e)));

    logsLoading = true;
    fetchLogs(id)
      .then((r) => (logs = r))
      .catch((e: unknown) => (logsErr = e instanceof Error ? e.message : String(e)))
      .finally(() => (logsLoading = false));
  });

  /**
   * The run's ARGUMENT, in the order the workflow declares its fields — and every key the payload
   * carries that the schema does not mention.
   *
   * ORDER FROM THE SCHEMA, VALUES FROM THE RUN. An author lists a record's fields in the order
   * they want them read, and a decoded JSON object has whatever order it was serialised in. The
   * schema also carries the only sentence explaining what a field means.
   *
   * THE LEFTOVERS ARE NOT DROPPED. A run started before a field was removed, or by the CLI with a
   * key the form has no control for, still passed that key — and a record that silently omitted it
   * would be a record of something other than what happened.
   */
  const inputRows = $derived.by(() => {
    const given = new Map(pairsOf(io?.input).map((p) => [p.name, p.value]));
    const declared = inputFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? '',
      value: given.get(f.name),
      given: given.has(f.name),
      fallback: f.default,
    }));
    const named = new Set(inputFields.map((f) => f.name));
    const extra = [...given]
      .filter(([k]) => !named.has(k))
      .map(([name, value]) => ({ name, type: '', description: '', value, given: true, fallback: undefined }));
    return [...declared, ...extra];
  });

  /** The run's RESULT, joined to the declared output schema the same way. */
  const outputRows = $derived.by(() => {
    const got = new Map(pairsOf(io?.output).map((p) => [p.name, p.value]));
    const declared = outputFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? '',
      value: got.get(f.name),
      given: got.has(f.name),
    }));
    const named = new Set(outputFields.map((f) => f.name));
    const extra = [...got]
      .filter(([k]) => !named.has(k))
      .map(([name, value]) => ({ name, type: '', description: '', value, given: true }));
    return [...declared, ...extra];
  });

  /** A workflow that returned something other than an object — a string, a list. Drawn whole. */
  const scalarOutput = $derived(
    io?.output !== undefined && (typeof io.output !== 'object' || Array.isArray(io.output))
      ? JSON.stringify(io.output)
      : ''
  );

  function ago(ms: number): string {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function tone(label: string): 'ok' | 'accent' | 'bad' | 'dim' {
    if (/complete|success/i.test(label)) return 'ok';
    if (/fail|cancel|error/i.test(label)) return 'bad';
    if (/run/i.test(label)) return 'accent';
    return 'dim';
  }

  // A dataset cell that carries error text (error / void_reason non-empty) is the DATASET-error's
  // full message; the rest of the row is which record. `colIndex` finds those columns by name.
  const errorCols = $derived(
    (preview?.columns ?? [])
      .map((c, i) => ({ name: c.name, i }))
      .filter((c) => /^(error|void_reason)$/i.test(c.name))
      .map((c) => c.i)
  );
  function cell(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  function rowHasError(r: unknown[]): boolean {
    return errorCols.some((i) => cell(r[i]).trim() !== '');
  }
</script>

{#if openRun === null}
  <section class="list" data-testid="runs-list">
    <h1>Runs</h1>
    {#if loading}
      <p class="muted">loading…</p>
    {:else if error}
      <p class="err" role="alert">{error}</p>
    {:else if rows.length === 0}
      <p class="muted">No runs yet.</p>
    {:else}
      <ul class="runs">
        {#each rows as r (r.runId)}
          {@const ex = executionOf(r)}
          {@const mat = materializationOf(r)}
          <li>
            <button class="row" data-testid="run-row-{r.runId}" onclick={() => open(r.runId)}>
              <span class="rid mono">{r.runId}</span>
              <span class="type">{r.type}</span>
              <span class="word {tone(ex.label)}" title={ex.title}>{ex.label}</span>
              <span class="word {tone(mat.label)}" title={mat.title}>{mat.label}</span>
              <span class="when">{ago(r.startedAt)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else}
  <section class="detail" data-testid="run-detail">
    <button class="back" onclick={() => open(null)}>‹ Runs</button>
    <header class="head">
      <div class="idcol">
        <span class="rid mono" data-testid="run-detail-id">{openRun}</span>
        {#if current}<span class="type">{current.type}</span>{/if}
      </div>
      {#if current}
        {@const ex = executionOf(current)}
        <!-- THE LAKE WINS ON THIS PAGE, and only on this page. The ledger answers `unrecorded` for
             every v2 Run; the page has already read the lake for the Dataset region below, so it
             can say what is actually there instead of repeating a word the list is stuck with. -->
        {@const mat = lakeMaterialization(datasets) ?? materializationOf(current)}
        <div class="dims">
          <span class="chip {tone(ex.label)}" title={ex.title} data-testid="run-execution">{ex.label}</span>
          <span class="chip {tone(mat.label)}" title={mat.title} data-testid="run-materialization">{mat.label}</span>
        </div>
      {/if}
    </header>

    {#if detailErr}<p class="err" role="alert">{detailErr}</p>{/if}

    <!-- INPUT (top) — WHAT THIS RUN WAS STARTED WITH, decoded from the `WorkflowExecutionStarted`
         payload, laid out in the order the workflow declares its fields and annotated with the
         author's own sentence per field.

         IT USED TO SHOW THE DECLARED DEFAULTS, footnoted "the run's recorded values land with the
         snapshot store" — so two runs of one workflow started with different arguments rendered
         identically, and the region was a copy of the launch form rather than a record. -->
    <div class="region input" data-testid="run-input">
      <h2>Input {#if io?.input !== undefined}<span class="dim src">as started</span>{/if}</h2>
      {#if ioErr}
        <p class="err" role="alert">{ioErr}</p>
      {:else if ioGone}
        <!-- RETENTION, NOT A FAULT. Temporal drops an execution long before the Dataset it wrote
             expires, so this says which fact it is rather than drawing an empty form. -->
        <p class="muted">
          Temporal has dropped this execution, so the argument it was started with is gone. The
          Dataset and the log below outlive it.
        </p>
      {:else if inputRows.length === 0}
        <p class="muted">
          {#if io}Started with no arguments.{:else}reading…{/if}
        </p>
      {:else}
        <div class="form">
          {#each inputRows as f (f.name)}
            <div class="fcard" data-testid="input-field-{f.name}">
              <div class="flab">
                <span class="fname">{f.name}</span>
                {#if f.type}<span class="ftype">{f.type}</span>{/if}
              </div>
              {#if f.given}
                <span class="fval mono">{f.value}</span>
              {:else}
                <!-- NOT SENT. The workflow read its own default for this one, and saying so is a
                     different fact from showing the default as though it had been typed. -->
                <span class="fval mono unset" title="not sent — the workflow used its own default">
                  {f.fallback ? `default ${f.fallback}` : 'not sent'}
                </span>
              {/if}
              {#if f.description}<span class="fdesc">{plainText(f.description)}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="middle">
      <!-- DATASET (left) — the last rows of the run's output, with error/void_reason shown IN FULL
           and the record (host/endpoint/point/node…) alongside. This is the DATASET-error's home. -->
      <div class="region dataset" data-testid="run-dataset">
        <h2>
          Dataset
          {#if shownDataset}<span class="dim mono">{datasetLabel(shownDataset)}</span>{/if}
          {#if datasets.length > 1}
            <!-- A RUN CAN WRITE SEVERAL. The first is shown; the count says the others exist
                 rather than letting the page read as though there were only one. -->
            <span class="dim">and {datasets.length - 1} more</span>
          {/if}
        </h2>
        {#if datasetsErr}
          <p class="err" role="alert">{datasetsErr}</p>
        {:else if previewErr}
          <p class="err">{previewErr}</p>
        {:else if !shownDataset}
          <p class="muted">This run wrote no rows to the lake.</p>
        {:else if !preview}
          <p class="muted">reading…</p>
        {:else if preview.rows.length === 0}
          <p class="muted">The Dataset is empty — a successful empty result.</p>
        {:else}
          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>{#each preview.columns as c}<th title={c.type}>{c.name}</th>{/each}</tr>
              </thead>
              <tbody>
                {#each preview.rows as r, ri (ri)}
                  <tr class:err-row={rowHasError(r)} data-testid={rowHasError(r) ? 'dataset-error-row' : 'dataset-row'}>
                    {#each preview.columns as _c, ci}
                      <td class:err-cell={errorCols.includes(ci) && cell(r[ci]).trim() !== ''}
                          data-testid={errorCols.includes(ci) ? 'dataset-error-cell' : undefined}>{cell(r[ci])}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="foot mono">
            {preview.rows.length} of {shownDataset.rows} row{shownDataset.rows === 1 ? '' : 's'}{preview.truncated ? ' · truncated' : ''}
            {#if (shownDataset.contributingRuns ?? []).length > 1}
              · shared with {(shownDataset.contributingRuns ?? []).length - 1} other run(s)
            {/if}
            · the error / void_reason column carries the full message; the rest of the row is which record
          </p>
        {/if}
      </div>

      <!-- LOG (right) — the run's log lines, filterable, each showing the full message and the
           record it is about (from stream `fields`). This is the DROPPED/logged error's home. -->
      <div class="region log" data-testid="run-log">
        <LogsRail records={logs} loading={logsLoading} error={logsErr} />
      </div>
    </div>

    <!-- OUTPUT (bottom) — WHAT THIS RUN RETURNED, decoded from `WorkflowExecutionCompleted`,
         against the declared output schema for the order and the author's sentence per field.

         IT USED TO SHOW THE SHAPE AND NO VALUES AT ALL, footnoted "values land with the run-result
         fetch". This is that fetch. -->
    <div class="region output" data-testid="run-output">
      <h2>Output {#if io?.output !== undefined}<span class="dim src">as returned</span>{/if}</h2>
      {#if io?.closedAs}
        <!-- A RUN THAT DID NOT COMPLETE HAS NO RESULT, and the word for why is the answer. An
             empty Output over a failed run reads as "it returned nothing", which is wrong. -->
        <p class="muted">
          This run <b class="bad">{io.closedAs}</b>, so it returned nothing. The log below is where
          the reason is.
        </p>
      {:else if ioGone}
        <p class="muted">Temporal has dropped this execution, so its result is gone.</p>
      {:else if scalarOutput}
        <span class="fval mono">{scalarOutput}</span>
      {:else if outputRows.length > 0}
        <div class="cards">
          {#each outputRows as f (f.name)}
            <div class="ocard" data-testid="output-field-{f.name}">
              <span class="k"><span class="oname">{f.name}</span>{#if f.type}<span class="ftype">{f.type}</span>{/if}</span>
              {#if f.given}
                <span class="oval mono">{f.value}</span>
              {:else}
                <span class="oval mono unset">not returned</span>
              {/if}
              {#if f.description}<span class="odesc">{plainText(f.description)}</span>{/if}
            </div>
          {/each}
        </div>
      {:else if !io}
        <p class="muted">reading…</p>
      {:else if detail && !detail.closedAt}
        <p class="muted">Still running — there is no result yet.</p>
      {:else}
        <p class="muted">This workflow returned no value.</p>
      {/if}
    </div>
  </section>
{/if}

<style>
  section {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  h1 {
    font-size: var(--t-head);
    font-weight: 600;
    margin: 0;
  }
  h2 {
    font-size: var(--t-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
    margin: 0 0 var(--s-2);
    font-weight: 500;
    display: flex;
    gap: var(--s-2);
    align-items: baseline;
  }
  h2 .dim {
    text-transform: none;
    letter-spacing: 0;
  }
  .muted {
    color: var(--dim);
    font-size: var(--t-small);
    margin: 0;
    line-height: var(--lh-body);
  }
  .err {
    color: var(--bad);
    font-size: var(--t-small);
    margin: 0;
  }

  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto auto auto auto;
    gap: var(--s-3);
    align-items: baseline;
    text-align: left;
    cursor: pointer;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
    color: var(--fg);
    font-size: var(--t-small);
  }
  .row:hover {
    border-color: var(--accent);
  }
  .rid {
    font-size: var(--t-body);
  }
  .type,
  .when {
    color: var(--dim);
    white-space: nowrap;
  }

  .word {
    white-space: nowrap;
  }
  .word.ok,
  .chip.ok {
    color: var(--ok);
  }
  .word.accent,
  .chip.accent {
    color: var(--accent);
  }
  .word.bad,
  .chip.bad {
    color: var(--bad);
  }
  .word.dim,
  .chip.dim {
    color: var(--dim);
  }

  .back {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--t-small);
    padding: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .idcol {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .idcol .rid {
    font-size: var(--t-lead);
  }
  .dims {
    display: flex;
    gap: var(--s-2);
  }
  .chip {
    font-size: var(--t-small);
    font-family: var(--mono);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px var(--s-2);
  }

  .region {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-3);
    min-width: 0;
  }
  .region.log {
    background: none;
    border: none;
    padding: 0;
  }
  /* In the Runs page the log is a COLUMN, not a full-height sticky rail — cap it so the middle is
     compact instead of a viewport-tall void beside a short dataset. */
  .region.log :global(.rail) {
    position: static;
  }
  .region.log :global(.scroller) {
    height: auto;
    max-height: 26rem;
  }
  .middle {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
    gap: var(--s-4);
    align-items: start;
  }
  @media (max-width: 900px) {
    .middle {
      grid-template-columns: 1fr;
    }
  }

  .tbl-wrap {
    overflow: auto;
    max-height: 26rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--mono);
    font-size: var(--t-small);
  }
  thead th {
    text-align: left;
    padding: var(--s-1) var(--s-2);
    color: var(--dim);
    font-weight: 500;
    background: var(--track);
    position: sticky;
    top: 0;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  tbody td {
    padding: var(--s-1) var(--s-2);
    border-bottom: 1px solid var(--line);
    color: var(--fg);
    vertical-align: top;
    white-space: nowrap;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .err-row td:first-child {
    box-shadow: inset 2px 0 0 var(--bad);
  }
  /* The full error text, shown — never truncated. Only THIS cell wraps; the identifier columns
     (host, endpoint) stay on one line and the table scrolls sideways if it must. */
  .err-cell {
    color: var(--bad);
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: 34rem;
  }
  .foot {
    font-size: var(--t-small);
    color: var(--dim);
    margin: var(--s-2) 0 0;
  }
  /* typed input form — one control per declared type */
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--s-2) var(--s-3);
  }
  .fcard {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .flab {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  /* NO DOTTED UNDERLINE AND NO `cursor: help`. It promised a tooltip carrying the field's meaning,
     which is now printed under the value where it can be read without hovering — and a hover
     affordance is not reachable from a touch screen or a keyboard anyway. */
  .fname {
    font-size: var(--t-small);
    color: var(--fg);
    font-family: var(--mono);
  }
  .fdesc,
  .odesc {
    font-size: var(--t-micro);
    color: var(--dim);
    line-height: var(--lh-body);
    max-width: 48ch;
  }
  /* A VALUE THAT WAS NOT SENT IS DRAWN AS ABSENCE, never as an empty box. `fail_on: str = ""`
     rendered as a bordered rectangle with nothing in it — indistinguishable from a field the page
     had failed to fill in. */
  .unset {
    color: var(--dim);
    font-style: italic;
    background: none;
    border-style: dashed;
  }
  .src {
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--mono);
  }
  .bad {
    color: var(--bad);
    font-weight: 500;
  }
  .ftype {
    font-size: var(--t-small);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 var(--s-1);
    font-family: var(--mono);
  }
  .req {
    color: var(--accent);
  }
  .fval {
    font-size: var(--t-small);
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-2);
    overflow-wrap: anywhere;
  }
  /* typed output cards — field, type, and the author's description */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--s-2);
  }
  .ocard {
    background: var(--track);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .ocard .k {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .oname {
    font-family: var(--mono);
    font-size: var(--t-small);
    color: var(--fg);
  }
  .oval {
    font-size: var(--t-small);
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-2);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--mono);
  }
</style>
