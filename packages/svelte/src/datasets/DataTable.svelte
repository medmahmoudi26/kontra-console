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
  }: Props = $props();

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
      <tbody>
        {#each visible as row, i (i)}
          <!-- A ROW IS A BUTTON WHEN IT DOES SOMETHING, and inert markup when it does not. That is
               why `onpick` is optional rather than a no-op: a row that looks clickable and is not
               is a worse affordance than one that never offered. -->
          <tr
            class:pickable={!!onpick}
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
