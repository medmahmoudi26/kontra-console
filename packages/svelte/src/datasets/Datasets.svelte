<script lang="ts">
  /**
   * Datasets — what this control plane has written, and what is in it.
   *
   * ── THE DENSEST SURFACE, AND THE ONE THAT TESTS PANEL-FIRST ─────────────────────────────────────
   *
   * A grid is wider than a phone. The rule is that the PAGE never scrolls sideways, so the grid
   * scrolls inside its own box and the columns that do not fit are reachable there. That is the
   * honest version of "responsive" for a table: it does not pretend nine columns fit in 390px.
   */
  import { groupDatasets } from '@kontra/console-core/datasets/grouped';
  import { fetchPreview, type DatasetPreview } from '@kontra/console-core/datasets/preview';
  import { cellText, runScopedSql } from '@kontra/console-core/datasets/query';
  import { download, type ExportFormat } from '@kontra/console-core/datasets/export';
  import DataTable, { type Column } from './DataTable.svelte';
  import Query from './Query.svelte';
  // THE DECISIONS, NOT THE DOM. `cells.ts` wrapped these in hand-built elements because ag-grid's
  // renderer API demands an HTMLElement; a Svelte `{#each}` calls them directly.
  import { datasetBadge } from '@kontra/console-core/datasets/state';
  import { accrualPhase, accrualWords } from '@kontra/console-core/datasets/accrual';
  import { untilText } from '@kontra/console-core/datasets/expiry';
  import { dispatchCell } from '@kontra/console-core/datasets/listing';
  import {
    entriesOf,
    fetchProvenance,
    headline,
    type DatasetProvenance,
  } from '@kontra/console-core/datasets/provenance';
  import { listingRows, type DatasetListingRow } from '@kontra/console-core/datasets/listing';
  import type { DatasetInfo } from '@kontra/console-core/run/api';
  import { parseAddress } from '@kontra/console-core/state/address';


  let rows = $state<DatasetListingRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');

  /**
   * ARRIVING FROM A RUN, WITH ITS QUERY ALREADY WRITTEN.
   *
   * `/datasets/<name>?run=<id>&q=1` is what the run page's "query these rows" button addresses. The
   * address carries WHERE — the dataset and the run — and `runScopedSql` composes WHAT from exactly
   * those two, so the link stays short and there is one spelling of the query.
   *
   * SCOPED TO THE RUN, not just to the dataset. A Dataset several runs append to holds everybody's
   * rows, and a bare `SELECT * FROM canary_signals` reached from a run answers with whichever run
   * wrote last — the columns are right, the run id column is even there, and nothing on screen
   * says these are not the rows you clicked through from.
   */
  const arrival = parseAddress(location.pathname + location.search);
  const focus = arrival !== null && arrival.view === 'datasets' ? arrival.dataset : null;
  const incomingSql = focus?.query === true ? runScopedSql(focus.name, focus.run) : '';

  // The workbench sits below the listing, so a link that opens it has to take the reader there.
  $effect(() => {
    if (!incomingSql) return;
    document.getElementById('query')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  /**
   * THE OPEN DATASET, AND WHAT IS IN IT.
   *
   * Listing a Dataset without being able to look inside it sends an operator to
   * `kontra dataset query` for the first question anybody asks — "what is actually in there".
   * The preview is bounded by the server, so `truncated` has to be drawn: "12 rows" from a capped
   * sample is not "this Dataset has 12 rows", and conflating them is how a reader concludes a scan
   * found almost nothing.
   */
  let open = $state<DatasetListingRow | undefined>(undefined);
  let preview = $state<DatasetPreview | undefined>(undefined);
  let previewError = $state('');
  let previewing = $state(false);
  /**
   * WHICH RUNS WROTE THIS (kontra-console#4). A Dataset NAME SPANS RUNS — `lame` holds what every
   * nscheck run ever promoted into it — so "where did these rows come from" is not answerable from
   * the listing, and a preview without it shows rows whose origin is invisible.
   *
   * ITS OWN REQUEST AND ITS OWN ERROR, never folded into the preview's. The two answer different
   * questions from different places (a bounded sample of rows; a GROUP BY over the whole lake), and
   * a provenance that failed must cost the provenance block and not the rows a reader came for.
   */
  let prov = $state<DatasetProvenance | undefined>(undefined);
  let provError = $state('');

  async function openRow(row: DatasetListingRow): Promise<void> {
    open = row;
    preview = undefined;
    previewError = '';
    previewing = true;
    const want = row.id;
    prov = undefined;
    provError = '';
    // BESIDE, NOT AFTER. Provenance is a second read and must not delay the rows; the same
    // stale-answer guard applies, because two clicks in flight would otherwise draw the first
    // dataset's origins under the second one's name.
    void fetchProvenance({ kind: row.kind, name: row.dataset })
      .then((p) => {
        if (open?.id === want) prov = p;
      })
      .catch((e: unknown) => {
        if (open?.id === want) provError = e instanceof Error ? e.message : String(e);
      });
    try {
      const p = await fetchPreview({ dataset: row.dataset, kind: row.kind, limit: 50 });
      // A SLOWER ANSWER FOR A DATASET NOBODY IS LOOKING AT ANY MORE IS DROPPED — two clicks in
      // flight would otherwise render the first one's rows under the second one's name.
      if (open?.id !== want) return;
      preview = p;
    } catch (e) {
      if (open?.id !== want) return;
      previewError = e instanceof Error ? e.message : String(e);
    } finally {
      if (open?.id === want) previewing = false;
    }
  }
  const now = Date.now();

  $effect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/datasets', { credentials: 'same-origin' });
        if (!res.ok) {
          error = `could not read datasets: HTTP ${res.status}`;
          return;
        }
        /**
         * `/api/datasets` RETURNS A BARE ARRAY OF `DatasetInfo`, NOT `{groups}`.
         *
         * This read `body.groups ?? []`. An array has no `groups`, so it was always `undefined`,
         * the fallback always fired, and this surface rendered EMPTY — with no error, on an
         * install whose catalog held 56 datasets. The `?? []` is what made it silent: the shape
         * was wrong and the code had a polite answer for being wrong.
         *
         * Grouping is not this component's to invent either — `groupDatasets` is the same
         * function the scratch inspector uses, and it exists because two datasets of the same
         * name in different schemas must NOT fold into one row.
         */
        const body = (await res.json()) as unknown;
        if (!Array.isArray(body)) {
          error = 'the catalog did not answer with a list of datasets';
          return;
        }
        rows = listingRows(groupDatasets(body as DatasetInfo[], now), { series: {}, columns: null, now });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    })();
  });

  const shown = $derived(
    q ? rows.filter((r) => `${r.name} ${r.dataset} ${r.owner}`.toLowerCase().includes(q.toLowerCase())) : rows
  );

  /**
   * What each listing column shows, as text — the filter row's accessor.
   *
   * IT HAS TO MATCH THE CELLS, and the only thing keeping it honest is that both are in this file,
   * a screen apart. A filter that reads a different value from the one on screen is worse than no
   * filter: the row disappears and the reader cannot see why.
   */
  function rowText(r: unknown, i: number): string {
    const row = r as DatasetListingRow;
    switch (i) {
      case 0: return `${row.dataset ?? ''} ${row.nameLocal || row.name || ''}`;
      case 1: return datasetBadge(row.state ?? 'open').label;
      case 2: return String(row.rows ?? 0);
      case 3: return bytes(row.bytes ?? 0);
      case 4: return dispatchCell({ dt: row.dt ?? '', dispatches: row.dispatches ?? 0, kind: row.kind ?? 'output' });
      case 5: return row.runId ?? '';
      default: {
        const at = (row as { expiresAt?: number }).expiresAt;
        return at ? untilText(at - now) : '';
      }
    }
  }

  /** Save the OPEN preview. The preview is a bounded sample, so the name says `-capped`. */
  function savePreview(format: ExportFormat): void {
    if (!preview || !open) return;
    download(
      { columns: preview.columns.map((c) => ({ name: typeof c === 'string' ? c : String((c as { name?: string }).name ?? c) })),
        rows: preview.rows },
      format,
      open.dataset,
      { truncated: preview.truncated }
    );
  }

  const columns: Column[] = [
    { label: 'dataset' },
    { label: 'state', width: '7rem' },
    { label: 'rows', numeric: true, width: '6rem' },
    { label: 'size', numeric: true, width: '6rem' },
    { label: 'dispatches', numeric: true, width: '7rem' },
    { label: 'run' },
    { label: 'expires', width: '7rem' },
  ];

  /**
   * THE PREVIEW'S COLUMNS, as `DataTable` wants them.
   *
   * The type goes in the LABEL rather than in a `title`, matching the query workbench's header and
   * for the same reason: a column called `contexts` is a different thing depending on whether it
   * is a `BIGINT` or a `MAP`, and a tooltip is a fact nobody on a touch screen can read.
   */
  const previewColumns = $derived<Column[]>(
    (preview?.columns ?? []).map((c) => {
      const name = typeof c === 'string' ? c : String((c as { name?: string }).name ?? c);
      const type = typeof c === 'string' ? '' : String((c as { type?: string }).type ?? '');
      return { label: type ? `${name}  ${type.toLowerCase()}` : name };
    })
  );

  /** What each preview column SHOWS, for the filter row. The same accessor shape the grid uses. */
  function previewText(row: unknown, i: number): string {
    return cellText((row as unknown[])[i]);
  }

  /**
   * What each preview column IS, for the inspector.
   *
   * `previewText` and this differ by exactly the thing that matters: `cellText` flattens a MAP or
   * a LIST into one line so it fits a row, and opening the inspector on THAT would be showing a
   * lossy rendering at full size. The raw value is what a reader clicked to see.
   */
  function previewValue(row: unknown, i: number): unknown {
    return (row as unknown[])[i];
  }

  /** Bytes at the scale a person reads. Was `bytesCell`; the arithmetic is unchanged. */
  function bytes(b: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b || 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
  }
</script>

<section>
  <div class="bar">
    <h1>Datasets</h1>
    <input type="search" bind:value={q} placeholder="filter by name or owner" aria-label="Filter datasets" />
  </div>

  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if loading}
    <p class="muted">reading the lake…</p>
  {:else}
    <p class="muted">{shown.length} of {rows.length} · click a row to look inside it</p>
    <DataTable
      {columns}
      rows={shown}
      maxHeight="28rem"
      textOf={rowText}
      onpick={(r) => void openRow(r as DatasetListingRow)}
      picked={(r) => open?.id === (r as DatasetListingRow).id}
      empty="No datasets. A run that pushes rows creates one."
    >
      {#snippet cell(r)}
        {@const row = r as DatasetListingRow & { expiresAt?: number }}
        {@const badge = datasetBadge(row.state ?? 'open')}
        {@const phase = accrualPhase({ state: row.state ?? 'open', runId: row.runId })}
        <!-- `{@const}` must be an immediate child of a block, never nested inside an element. -->
        {@const grain = row.nameLocal || row.name}
        <td>
          <!-- BOTH NAMES, BECAUSE ONE OF THEM IS WHAT YOU TYPE INTO SQL.
               A Run's output has two: the LOGICAL name (`observations`) that every query and the
               detail panel below use, and the run-grain name ADR 0029 §2 derives
               (`wf-hunt-0.1.0--…--636677`) that identifies which Run produced this partition.
               Showing only the derived one here while the panel showed only the logical one made a
               click look like a rename, and left the name a reader needs for `FROM …` off screen
               entirely. Logical leads; run-grain follows, dimmed, as the provenance it is. -->
          <span class="mono">{row.dataset || grain}</span>
          {#if grain && grain !== row.dataset}
            <span class="grain mono" title="Run-grain partition (ADR 0029 §2) — queries name {row.dataset}">{grain}</span>
          {/if}
          <!-- RENAMED IS A FACT ABOUT THE ROW, not decoration: the name on screen is an override
               and the stored one is what a query must use. -->
          {#if row.renamed}<span class="tag" title="stored as {row.dataset}">renamed</span>{/if}
          {#if row.temporary}<span class="tag warn" title="dropped when its run ends">temp</span>{/if}
        </td>
        <td><span class="badge {row.state ?? 'open'}" title={badge.title}>{badge.label}</span></td>
        <td class="num"><span class="cell-rows {phase}" title={accrualWords(phase).title}>{(row.rows ?? 0).toLocaleString()}</span></td>
        <td class="num"><span class="mono" title="{(row.bytes ?? 0).toLocaleString()} bytes">{bytes(row.bytes ?? 0)}</span></td>
        <td class="num"><span class="mono">{dispatchCell({ dt: row.dt ?? '', dispatches: row.dispatches ?? 0, kind: row.kind ?? 'output' })}</span></td>
        <td>
          {#if row.runId}<span class="mono">{row.runId}</span>
          {:else}<span class="dim" title="a standalone dataset, not a run output">loaded</span>{/if}
        </td>
        <td>
          {#if row.expiresAt}<span class="cell-expiry" class:gone={row.expiresAt - now < 0}>{untilText(row.expiresAt - now)}</span>
          {:else}<span class="dim" title="kept until something says otherwise">—</span>{/if}
        </td>
      {/snippet}
    </DataTable>
  {/if}

  <Query initialSql={incomingSql} />

  {#if open}
    <section class="peek" data-testid="dataset-preview">
      <header>
        <h2 class="mono">{open.dataset}</h2>
        <span class="muted">{open.kind}</span>
        {#if preview && preview.rows.length > 0}
          <!-- THE PREVIEW IS A BOUNDED SAMPLE (50 rows), so an export of it is too — and
               `export.ts` stamps `-capped` into the filename when the server says it truncated.
               For the whole dataset, the workbench below is the path: query it, then save that. -->
          <span class="save">
            download
            {#each ['csv', 'tsv', 'json', 'jsonl'] as const as f (f)}
              <button class="fmt" onclick={() => savePreview(f)} title="download this preview as {f.toUpperCase()}">{f}</button>
            {/each}
          </span>
        {/if}
        <button class="close" onclick={() => { open = undefined; preview = undefined; }}>close</button>
      </header>

      {#if previewing}
        <p class="muted">reading…</p>
      {:else if previewError}
        <p class="err" role="alert">{previewError}</p>
      {:else if preview}
        {#if preview.rows.length === 0}
          <!-- EMPTY IS A FACT, and a different one from "we could not read it". -->
          <p class="muted">
            This dataset has no rows yet. A Method that pushes records creates them.
          </p>
        {:else}
          {#if preview.truncated}
            <p class="muted">
              A bounded sample — the server capped it, so this is not the whole dataset.
            </p>
          {/if}
          <!--
            ONE TABLE IMPLEMENTATION, AND THIS IS THE SECOND ONE GOING AWAY.

            This was a hand-rolled `<table>` sitting three hundred lines below a `DataTable` doing
            the same job, and the divergence cost exactly what divergence costs: the component had
            per-column filters and this did not, and this clipped at `max-width: 44ch` with
            `overflow: hidden` and NO title, no click target and no expansion — so anything past
            forty-four characters was unreachable from the console. The bug was not the clipping;
            it was clipping in the copy that had no inspector.
          -->
          <DataTable
            columns={previewColumns}
            rows={preview.rows}
            maxHeight="28rem"
            textOf={previewText}
            cellValue={previewValue}
            empty="This dataset has no rows yet."
          >
            {#snippet cell(r)}
              {#each r as unknown[] as v, j (j)}
                <!-- `null` DRAWN AS A WORD, not as an empty cell: a null and a blank string are
                     different values and a scan reader has to tell them apart. `cellText` for the
                     rest — `String()` renders a MAP or LIST column as `[object Object]`,
                     destroying the cell's whole content. -->
                <td class:num={typeof v === 'number'}>
                  {#if v === null || v === undefined}
                    <span class="null">null</span>
                  {:else}
                    <span class="mono">{cellText(v)}</span>
                  {/if}
                </td>
              {/each}
            {/snippet}
          </DataTable>
          <p class="muted">
            {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} ·
            {preview.columns.length} columns · full SQL is
            <span class="mono">kontra dataset query {open.dataset} --sql "…"</span>
          </p>
        {/if}
      {/if}

      <!--
        WHICH RUNS WROTE THIS (kontra-console#4). Outside the preview's `{#if}` on purpose: a
        Dataset with no rows yet still has a provenance answer ("no runs recorded"), and a preview
        that failed to read must not also hide where the rows came from.
      -->
      <div class="prov">
        <h4>provenance</h4>
        {#if provError}
          <p class="err" role="alert">{provError}</p>
        {:else if !prov}
          <p class="muted">reading…</p>
        {:else}
          {@const runs = entriesOf(prov, 'run')}
          {@const machines = entriesOf(prov, 'machine')}
          <p class="muted">
            {headline(runs, 'run')} · {headline(machines, 'machine')} ·
            {prov.rows.toLocaleString()} row{prov.rows === 1 ? '' : 's'} counted
          </p>
          {#if runs.length > 0}
            <ul>
              {#each runs as r (r.key)}
                <li class="entry {r.state}">
                  <span class="val mono">{r.label}</span>
                  <span class="rows mono">{r.rows.toLocaleString()}</span>
                  <!--
                    A SHARE IS ONLY DRAWN WHEN THERE IS A DISTRIBUTION. One bucket at 100% is a bar
                    that says "distributed" about something that is not — `drawsDistribution` is the
                    same rule stated in `provenance.ts`.
                  -->
                  <span class="share mono">{runs.length > 1 ? `${Math.round(r.share * 100)}%` : ''}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    </section>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
  .peek { border: 1px solid var(--line); border-radius: var(--radius); padding: var(--s-3); background: var(--panel); }
  .peek header { display: flex; align-items: baseline; gap: var(--s-2); }
  .peek h2 { font-size: var(--t-body); font-weight: 600; margin: 0; }
  .save { margin-left: auto; display: inline-flex; align-items: center; gap: var(--s-1);
          font-size: var(--t-small); color: var(--dim); }
  .fmt {
    font-family: var(--mono); font-size: var(--t-small); text-transform: uppercase;
    color: var(--accent); background: none; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--radius); padding: 0 var(--s-1);
  }
  .fmt:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .close { margin-left: var(--s-2); font-size: var(--t-small); padding: 2px var(--s-2);
           border: 1px solid var(--line); border-radius: var(--radius);
           background: var(--track); color: var(--dim); cursor: pointer; }
  /* WIDE CONTENT SCROLLS IN ITS OWN BOX. A 31-column observation row would otherwise make the
     whole page scroll sideways, which is the one thing every surface here refuses to do.
     `DataTable` owns that box now; this class is kept for the provenance block below it. */
  .scroll { overflow-x: auto; max-width: 100%; }
  /*
   * THE SECOND TABLE'S STYLES ARE GONE WITH IT, and this is the rule they broke:
   *
   *     .peek th, .peek td { white-space: nowrap; max-width: 44ch;
   *                          overflow: hidden; text-overflow: ellipsis; }
   *
   * No title, no click target, no expansion. Anything past forty-four characters was not scrolled
   * off — it was unreachable from the console. `DataTable` clips too, at `48ch`, but only on rows
   * marked `.inspectable`, which is the structural version of "clip only what a click can open".
   */
  .null { color: var(--dim); font-style: italic; }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); }
  .bar { display: flex; flex-direction: column; gap: var(--s-2); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  input {
    width: 100%; background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-2) var(--s-3); font-size: var(--t-small);
  }
  /* The run-grain name is PROVENANCE, not identity — dimmed and smaller so the name a query
     uses stays the one the eye lands on. */
  .grain {
    color: var(--dim);
    font-size: var(--t-small);
    margin-left: var(--s-2);
    opacity: 0.75;
  }

  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0; padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  @media (min-width: 720px) {
    .bar { flex-direction: row; align-items: center; justify-content: space-between; }
    input { max-width: 320px; }
  }
  .prov { display: flex; flex-direction: column; gap: var(--s-1); margin-top: var(--s-3);
    border-top: 1px solid var(--line); padding-top: var(--s-2); }
  .prov h4 { font-size: var(--t-small); font-weight: 600; margin: 0; }
  .prov ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .prov .entry {
    display: grid; grid-template-columns: minmax(0, 1fr) 6em 4em; gap: var(--s-2);
    align-items: baseline; font-size: var(--t-small); padding: 1px var(--s-1);
  }
  .prov .val { overflow-wrap: anywhere; }
  .prov .rows, .prov .share { color: var(--dim); text-align: right; font-variant-numeric: tabular-nums; }
  /* A PLACEHOLDER SAYS SO IN WORDS, NOT ONLY IN COLOUR (provenance.ts) — the tint is secondary. */
  .prov .entry.unrecorded .val, .prov .entry.legacy .val { color: var(--dim); }
</style>
