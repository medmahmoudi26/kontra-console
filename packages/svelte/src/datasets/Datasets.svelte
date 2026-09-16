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
  import type { ColDef, GridOptions } from 'ag-grid-community';
  import { listingRows, type DatasetListingRow } from '@kontra/console-core/datasets/listing';

  import Grid from './Grid.svelte';
  import { bytesCell, dispatchesCell, expiryCell, nameCell, rowsCell, runCell, stateCell } from './cells';

  let rows = $state<DatasetListingRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  const now = Date.now();

  $effect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/datasets', { credentials: 'same-origin' });
        if (!res.ok) {
          error = `could not read datasets: HTTP ${res.status}`;
          return;
        }
        const body = (await res.json()) as { groups?: Parameters<typeof listingRows>[0] };
        rows = listingRows(body.groups ?? [], { series: {}, columns: null, now });
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

  // COLUMNS ARE DATA. Each renderer is a function from a row to an element, defined in `cells.ts`
  // and tested there — ag-grid never sees a component.
  const columns: ColDef[] = [
    { headerName: 'dataset', field: 'name', flex: 2, minWidth: 180, cellRenderer: (p: { data: DatasetListingRow }) => nameCell(p.data) },
    { headerName: 'state', field: 'state', width: 110, cellRenderer: (p: { data: DatasetListingRow }) => stateCell(p.data) },
    { headerName: 'rows', field: 'rows', width: 110, type: 'numericColumn', cellRenderer: (p: { data: DatasetListingRow }) => rowsCell(p.data) },
    { headerName: 'size', field: 'bytes', width: 100, type: 'numericColumn', cellRenderer: (p: { data: DatasetListingRow }) => bytesCell(p.data) },
    { headerName: 'dispatches', field: 'dispatches', width: 120, cellRenderer: (p: { data: DatasetListingRow }) => dispatchesCell(p.data) },
    { headerName: 'run', field: 'runId', flex: 1, minWidth: 160, cellRenderer: (p: { data: DatasetListingRow }) => runCell(p.data) },
    { headerName: 'expires', field: 'expiresAt', width: 120, cellRenderer: (p: { data: DatasetListingRow & { expiresAt?: number } }) => expiryCell(p.data, now) },
  ];

  const options: GridOptions = {
    columnDefs: columns,
    defaultColDef: { sortable: true, resizable: true },
    rowHeight: 34,
    headerHeight: 32,
    getRowId: (p: { data: DatasetListingRow }) => p.data.id,
    // A SENTENCE, NOT A BLANK GRID. "No rows" and "this control plane has never written one" are
    // different states and only one of them means something is wrong.
    overlayNoRowsTemplate:
      '<span style="color:#7b8b9c;font-size:12px">No datasets. A run that pushes rows creates one.</span>',
  };
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
    <p class="muted">{shown.length} of {rows.length}</p>
    <Grid {options} rows={shown} />
    <p class="muted">
      The grid scrolls sideways inside its own box — the page never does. On a phone the columns
      past <span class="mono">state</span> are reached by scrolling the grid.
    </p>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
  .bar { display: flex; flex-direction: column; gap: var(--s-2); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  input {
    width: 100%; background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-2) var(--s-3); font-size: var(--t-small);
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
</style>
