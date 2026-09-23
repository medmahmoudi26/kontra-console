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
    type MaterializationRecord,
  } from '@kontra/console-core/run/api';
  import { executionOf, materializationOf } from '@kontra/console-core/run/runState';
  import { fetchLogs, type LogRecord } from '@kontra/console-core/run/logs';
  import { fetchPreview, type DatasetPreview } from '@kontra/console-core/datasets/preview';
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
  let previewName = $state('');
  // The workflow's declared input/output schemas — the typed input form and the typed output are
  // drawn from these (the SAME `schemaFields` derivation the Launch form uses), so a workflow
  // nobody has written yet renders correctly with zero form code.
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

  // Detail + its logs + its output dataset preview, loaded when a run opens.
  $effect(() => {
    const id = openRun;
    detail = undefined;
    detailErr = '';
    logs = [];
    logsErr = null;
    preview = undefined;
    previewErr = '';
    previewName = '';
    inputFields = [];
    outputFields = [];
    if (id === null) return;

    fetchRun(id)
      .then((d) => {
        detail = d;
        // The typed input form + typed output, from the workflow's declared schemas.
        fetchWorkflows()
          .then((w) => {
            const desc = w.registered.find((r) => r.name === d.type);
            inputFields = schemaFields(desc?.input) ?? [];
            outputFields = schemaFields(desc?.output) ?? [];
          })
          .catch(() => {});
        const out = outputRecord(d.materializationRecords);
        const raw = out?.name ?? out?.actor;
        const name = typeof raw === 'string' ? raw : '';
        if (name) {
          previewName = name;
          fetchPreview({ dataset: name, kind: 'output', limit: 50 })
            .then((p) => (preview = p))
            .catch((e: unknown) => (previewErr = e instanceof Error ? e.message : String(e)));
        }
      })
      .catch((e: unknown) => (detailErr = e instanceof Error ? e.message : String(e)));

    logsLoading = true;
    fetchLogs(id)
      .then((r) => (logs = r))
      .catch((e: unknown) => (logsErr = e instanceof Error ? e.message : String(e)))
      .finally(() => (logsLoading = false));
  });

  function outputRecord(recs?: MaterializationRecord[]): MaterializationRecord | undefined {
    return (recs ?? []).find((r) => r.name || r.actor);
  }

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
        {@const mat = materializationOf(current)}
        <div class="dims">
          <span class="chip {tone(ex.label)}" title={ex.title} data-testid="run-execution">{ex.label}</span>
          <span class="chip {tone(mat.label)}" title={mat.title} data-testid="run-materialization">{mat.label}</span>
        </div>
      {/if}
    </header>

    {#if detailErr}<p class="err" role="alert">{detailErr}</p>{/if}

    <!-- INPUT (top) — the typed form, drawn from the workflow's declared input schema (the SAME
         `schemaFields` derivation the Launch form uses). Prefilled with the DECLARED defaults; the
         run's own recorded values land with the snapshot store (Temporal drops the start payload
         after retention, ADR 0007), which is the one thing this does not invent. -->
    <div class="region input" data-testid="run-input">
      <h2>Input</h2>
      {#if inputFields.length === 0}
        <p class="muted">This workflow declares no input fields.</p>
      {:else}
        <div class="form">
          {#each inputFields as f (f.name)}
            <div class="fcard" data-testid="input-field-{f.name}">
              <div class="flab">
                <span class="fname" title={f.description ?? ''}>{f.name}</span>
                <span class="ftype">{f.type}</span>
                {#if f.required}<span class="req" title="required">*</span>{/if}
              </div>
              {#if f.control === 'toggle'}
                <span class="toggle" class:on={f.default === 'true'}>
                  <span class="tk"></span>{f.default === 'true' ? 'true' : 'false'}
                </span>
              {:else}
                <span class="fval mono">{f.default ?? '—'}</span>
              {/if}
            </div>
          {/each}
        </div>
        <p class="foot mono">
          declared defaults · the run's recorded values land with the snapshot store (ADR 0007)
        </p>
      {/if}
    </div>

    <div class="middle">
      <!-- DATASET (left) — the last rows of the run's output, with error/void_reason shown IN FULL
           and the record (host/endpoint/point/node…) alongside. This is the DATASET-error's home. -->
      <div class="region dataset" data-testid="run-dataset">
        <h2>Dataset {#if previewName}<span class="dim mono">{previewName}</span>{/if}</h2>
        {#if previewErr}
          <p class="err">{previewErr}</p>
        {:else if !previewName}
          <p class="muted">This run recorded no output Dataset.</p>
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
            {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'}{preview.truncated ? ' · truncated' : ''}
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

    <!-- OUTPUT (bottom) — the typed output, drawn from the workflow's declared output schema: each
         field, its type, and the author's own description (which is how a reader knows what a value
         means — e.g. a `suggested_query` string). Values land with the run-result fetch; the shape
         and its guidance render now. -->
    <div class="region output" data-testid="run-output">
      <h2>Output</h2>
      {#if outputFields.length > 0}
        <div class="cards">
          {#each outputFields as f (f.name)}
            <div class="ocard" data-testid="output-field-{f.name}">
              <span class="k"><span class="oname">{f.name}</span><span class="ftype">{f.type}</span></span>
              {#if f.description}<span class="odesc">{f.description}</span>{/if}
            </div>
          {/each}
        </div>
        <p class="foot mono">
          typed output · declared fields and their descriptions · values land with the run-result fetch
        </p>
      {:else if detail?.materializationRecords && detail.materializationRecords.length > 0}
        <ul class="outds">
          {#each detail.materializationRecords as m}
            <li class="mono"><span class="ok">{m.name ?? m.actor}</span> · {m.rows} row{m.rows === 1 ? '' : 's'}{m.state ? ` · ${m.state}` : ''}</li>
          {/each}
        </ul>
      {:else}
        <p class="muted">This workflow declares no typed output.</p>
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
  .outds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--t-small);
  }
  .outds .ok {
    color: var(--ok);
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
  .fname {
    font-size: var(--t-small);
    color: var(--fg);
    border-bottom: 1px dotted var(--dim);
    cursor: help;
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
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-small);
    font-family: var(--mono);
    color: var(--dim);
  }
  .toggle .tk {
    width: 30px;
    height: 16px;
    border-radius: 999px;
    background: var(--track);
    border: 1px solid var(--line);
    position: relative;
    flex: none;
  }
  .toggle .tk::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 1px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--dim);
  }
  .toggle.on {
    color: var(--accent);
  }
  .toggle.on .tk {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: var(--accent);
  }
  .toggle.on .tk::after {
    transform: translateX(14px);
    background: var(--accent);
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
  .odesc {
    font-size: var(--t-small);
    color: var(--dim);
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--mono);
  }
</style>
