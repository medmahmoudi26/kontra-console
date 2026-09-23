<script lang="ts">
  /**
   * The console's own table. One component for the dataset list, the row preview and query results.
   *
   * ── WHY THIS REPLACED ag-grid ───────────────────────────────────────────────────────────────────
   *
   * ag-grid arrived with its own theme, and `Grid.svelte` pinned it to `gridTheme('dark')` — a
   * hard-coded palette inside a console whose entire visual system is CSS custom properties. So the
   * widest, densest surface in the product was the one thing that did not look like the product,
   * and could not: its borders, row heights, header weight and focus rings came from a stylesheet
   * the tokens cannot reach.
   *
   * It also cost a dependency on the critical path. `App.svelte` records that importing `Datasets`
   * statically "dragged ag-grid in and the entry went from 93 KB" — a lazy import was the workaround
   * for a grid that renders three columns of text.
   *
   * AND IT FORCED IMPERATIVE CELLS. `cells.ts` existed because "ag-grid's vanilla API asks a
   * renderer for an HTMLElement" — eight functions building DOM by hand, with a warning that a cell
   * which throws takes the render loop with it. A Svelte `{#each}` has none of those properties.
   * The DECISIONS those renderers called into (`datasetBadge`, `accrualWords`, `untilText`,
   * `dispatchCell`) live in `@kontra/console-core` and are untouched — what goes is the DOM
   * plumbing, not the domain.
   *
   * ── THE ONE LAYOUT RULE IT MUST KEEP ────────────────────────────────────────────────────────────
   *
   * ADR 0048 §4: the PAGE never scrolls sideways. A table is the widest thing in the console and a
   * 390px phone cannot show it, so the table scrolls inside its own bounded box. `scripts/overflow.mjs`
   * is what proves it, and it is the reason `.wrap` owns `overflow-x` rather than any ancestor.
   */
  import type { Snippet } from 'svelte';

  import CellInspector from './CellInspector.svelte';

  export interface Column {
    /** Header text. Uppercase labels are the one place `--t-micro` is allowed. */
    label: string;
    /** Right-align and tabular-nums — for counts and sizes, never for names. */
    numeric?: boolean;
    /** A fixed width, when a column would otherwise take space from the one that matters. */
    width?: string;
  }

  interface Props {
    columns: readonly Column[];
    rows: readonly unknown[];
    /** Rendered per row. Receives the row and its index; emits the `<td>`s. */
    cell: Snippet<[unknown, number]>;
    /** Clicking a row opens it. Omitted makes rows inert — a preview table is not navigable. */
    onpick?: (row: unknown, index: number) => void;
    /** Marks the open row, so a detail panel below has something pointing at it. */
    picked?: (row: unknown) => boolean;
    /** Shown in place of the table when there are no rows. A sentence, never a blank box. */
    empty?: string;
    /** Caps the scroller so a long result cannot push the page. Absent lets it grow. */
    maxHeight?: string;
    /**
     * PER-COLUMN FILTERING, which the grid this replaced had and this did not.
     *
     * The table cannot read a row itself — the `<td>`s come from the caller's snippet, so the row
     * is opaque here by design. So the caller supplies the accessor: given a row and a column
     * index, return the text that column shows. Absent means no filter row, and the table behaves
     * exactly as before.
     */
    textOf?: (row: unknown, column: number) => string;
    /**
     * CLICK A CELL, SEE THE WHOLE VALUE. The same accessor shape as `textOf`, returning the RAW
     * value rather than its text — see `CellInspector.svelte` for why the difference matters.
     *
     * ── IT IS NOT CALLED `valueOf`, AND THAT IS NOT A STYLE PREFERENCE ────────────────────────
     *
     * `valueOf` IS ON `Object.prototype`. Destructuring `let { valueOf } = $props()` therefore
     * finds it through the prototype chain on EVERY table, whether the caller passed one or not —
     * so `if (!valueOf) return` never returns, the listing table became cell-inspectable, and
     * calling it rendered the component's own props object into the dialog. Caught by
     * `e2e/datasets.spec.ts`, which is the only place it could be caught: the prop is typed
     * optional, `svelte-check` is happy, and the vitest suites never mount two tables at once.
     *
     * ── A TABLE IS ROW-NAVIGABLE OR CELL-INSPECTABLE, NEVER BOTH ──────────────────────────────
     *
     * Passing this AND `onpick` would make one click mean two things, and the reader cannot be
     * told which they are about to get. The listing table navigates (a row opens a dataset); the
     * preview and the query result inspect (a row is not a destination, a value is). The dev
     * assertion below is there because the two props look independent and are not.
     */
    cellValue?: (row: unknown, column: number) => unknown;
  }

  let {
    columns,
    rows,
    cell,
    onpick,
    picked,
    empty = 'Nothing to show.',
    maxHeight,
    textOf,
    cellValue,
  }: Props = $props();

  // IN AN EFFECT, so it reads the props reactively and fires if a caller starts passing both later
  // — and so `svelte-check` is right rather than merely quiet. Loud in development, absent in
  // production: refusing to render a table over a prop combination would be a worse failure than
  // the ambiguity it is complaining about.
  $effect(() => {
    if (import.meta.env.DEV && onpick && cellValue) {
      // eslint-disable-next-line no-console
      console.error(
        'DataTable: `onpick` and `cellValue` together make one click mean two things. ' +
          'A table navigates by row or inspects by cell — pick one.'
      );
    }
  });

  /** Which cell the inspector is open on. `undefined` is closed. */
  let open = $state<{ row: unknown; column: number; index: number } | undefined>(undefined);

  /**
   * ONE DELEGATED LISTENER ON THE BODY, not a handler per `<td>`.
   *
   * The `<td>`s are the CALLER's — they come out of `cell`, and this component never constructs
   * one. So it cannot attach anything to them, and asking every caller to wire a click into every
   * cell of every snippet is how half of them end up not doing it. `closest('td')` plus
   * `cellIndex` recovers the coordinates from the event, which is the one thing the DOM will
   * always know about a table.
   */
  function inspect(event: MouseEvent): void {
    if (!cellValue) return;
    const td = (event.target as HTMLElement | null)?.closest('td');
    if (!td) return;
    const tr = td.closest('tr');
    if (!tr) return;
    // A SELECTION IS NOT A CLICK. Dragging across a cell to copy part of it must not also open a
    // dialog over the thing being read — which is the first way a modal-on-click gets annoying.
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    const index = Number(tr.dataset.index);
    if (!Number.isInteger(index)) return;
    const row = visible[index];
    if (row === undefined) return;
    open = { row, column: td.cellIndex, index };
  }

  /** One filter per column, by index. Empty string means "this column is not filtering". */
  let filters = $state<Record<number, string>>({});
  const filtering = $derived(Object.values(filters).some((v) => v.trim() !== ''));

  /**
   * SUBSTRING, CASE-INSENSITIVE, AND ANDed ACROSS COLUMNS — the behaviour a filter row implies and
   * therefore the only one that will not surprise. No globbing and no regex: a stray `(` in a
   * host name should narrow a list, not throw.
   */
  const visible = $derived.by(() => {
    if (!textOf || !filtering) return rows;
    const active = Object.entries(filters)
      .map(([i, q]) => [Number(i), q.trim().toLowerCase()] as const)
      .filter(([, q]) => q !== '');
    return rows.filter((row) =>
      active.every(([i, q]) => textOf(row, i).toLowerCase().includes(q))
    );
  });
</script>

{#if rows.length === 0}
  <p class="muted">{empty}</p>
{:else}
  <div class="wrap" style={maxHeight ? `max-height:${maxHeight}` : undefined}>
    <table>
      <thead>
        <tr>
          {#each columns as c (c.label)}
            <th class:num={c.numeric} style={c.width ? `width:${c.width}` : undefined}>{c.label}</th>
          {/each}
        </tr>
        {#if textOf}
          <tr class="filters">
            {#each columns as c, i (c.label)}
              <th>
                <input
                  type="search"
                  bind:value={filters[i]}
                  placeholder="filter"
                  aria-label="Filter by {c.label}"
                />
              </th>
            {/each}
          </tr>
        {/if}
      </thead>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <tbody onclick={inspect}>
        {#each visible as row, i (i)}
          <!-- A ROW IS A BUTTON WHEN IT DOES SOMETHING, and inert markup when it does not. That is
               why `onpick` is optional rather than a no-op: a row that looks clickable and is not
               is a worse affordance than one that never offered.
               `data-index` is what the delegated cell listener reads back — the DOM knows which
               `<td>` was clicked and this is what tells it which ROW that was. -->
          <tr
            data-index={i}
            class:pickable={!!onpick}
            class:inspectable={!!cellValue}
            class:on={picked?.(row)}
            tabindex={onpick ? 0 : undefined}
            role={onpick ? 'button' : undefined}
            onclick={() => onpick?.(row, i)}
            onkeydown={(e) => {
              if (!onpick) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onpick(row, i);
              }
            }}
          >
            {@render cell(row, i)}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if open && cellValue}
    <CellInspector
      label={columns[open.column]?.label ?? `column ${open.column + 1}`}
      value={cellValue(open.row, open.column)}
      row={open.index + 1}
      onclose={() => (open = undefined)}
    />
  {/if}
  {#if textOf && filtering}
    <!-- THE COUNT IS THE HONEST PART. A filtered table showing three rows looks identical to a
         dataset holding three rows, and an operator who forgot a filter is in a box reads the
         second. Saying "3 of 135" costs one line and removes that reading entirely. -->
    <p class="muted count">
      {visible.length.toLocaleString()} of {rows.length.toLocaleString()} rows
      <button class="clear" onclick={() => (filters = {})}>clear filters</button>
    </p>
  {/if}
{/if}

<style>
  /* THE BOX THAT SCROLLS. See the header — the page must not. */
  .wrap {
    overflow: auto;
    max-width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--t-small);
  }

  /* STICKY, because a table you have to scroll is a table whose headers you lose. */
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--track);
    color: var(--dim);
    font-size: var(--t-micro);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: left;
    white-space: nowrap;
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
  }

  /*
   * `:global`, AND NOT BY OVERSIGHT. The `<td>`s are rendered by the CALLER's snippet, so Svelte's
   * scoped CSS does not reach them from this file — svelte-check said so, as four "unused selector"
   * warnings, which is the compiler correctly reporting that the row styling would not apply.
   * Scoped under `.wrap` so this is still this component's table and not everyone's.
   */
  :global(.wrap tbody td) {
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
    vertical-align: baseline;
    white-space: nowrap;
  }
  :global(.wrap tbody tr:last-child td) { border-bottom: 0; }

  /*
   * CLIPPING IS ALLOWED ONLY WHERE THE WHOLE VALUE IS ONE CLICK AWAY.
   *
   * That is why this bound hangs off `.inspectable` and not off every `<td>`. The rule it replaces
   * lived in `Datasets.svelte` and clipped at `44ch` with no way to see the rest — the value was
   * not scrolled off, it was gone. The opposite rule (no bound at all, which is what the query
   * result had) is no better: one 4 KB JSON cell makes its row kilometres wide and pushes every
   * other column out of the scroll box.
   *
   * `zoom-in` rather than `pointer`, because the cell is not a link and does not navigate.
   */
  :global(.wrap tr.inspectable td) {
    max-width: 48ch;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: zoom-in;
  }
  :global(.wrap tr.inspectable td:hover) {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* NO ZEBRA. Alternating fills read as grouping and there is none here; a hairline per row is
     enough separation and leaves the tinting budget for state, which is a real signal. */
  tr.pickable { cursor: pointer; }
  :global(.wrap tr.pickable:hover td) { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  tr.pickable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  :global(.wrap tr.on td) { background: color-mix(in srgb, var(--accent) 12%, transparent); }

  th.num, :global(.wrap td.num) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* The filter row reads as part of the header, not as a second data row. */
  tr.filters th { position: sticky; top: 2.1rem; z-index: 1; background: var(--track); padding: 0 var(--s-1) var(--s-1); }
  tr.filters input {
    width: 100%; min-width: 4rem; font-size: var(--t-small); font-family: var(--mono);
    color: var(--fg); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius); padding: 1px var(--s-1);
  }
  tr.filters input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }

  .count { display: flex; align-items: center; gap: var(--s-2); }
  .clear {
    font-size: var(--t-small); color: var(--accent); background: none;
    border: 0; padding: 0; cursor: pointer; text-decoration: underline;
  }

  .muted {
    font-size: var(--t-small);
    color: var(--dim);
    margin: var(--s-3) 0;
    line-height: var(--lh-body);
    max-width: 62ch;
  }
</style>
