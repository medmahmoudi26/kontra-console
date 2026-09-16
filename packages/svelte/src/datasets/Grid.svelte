<script lang="ts">
  /**
   * ag-grid, through its framework-agnostic API.
   *
   * ── `createGrid`, NOT `ag-grid-react` ───────────────────────────────────────────────────────────
   *
   * ag-grid's core has no framework in it — the React and Svelte packages are thin wrappers over
   * `createGrid(element, options)`. `@kontra/console-core/lib/agGrid` already registers the modules
   * and builds the theme with no framework, so this component is the element, the lifecycle, and
   * nothing else.
   *
   * ── IT OWNS ITS OWN SCROLL ──────────────────────────────────────────────────────────────────────
   *
   * A grid is the widest thing in the console and a 390px phone cannot show it. The rule
   * (ADR 0048 §4) is that the PAGE never scrolls sideways — so the grid gets a bounded box and
   * scrolls inside it. This is the surface where that is hardest and the overflow check is what
   * proves it.
   */
  import { createGrid, type GridApi, type GridOptions } from 'ag-grid-community';
  import { gridTheme } from '@kontra/console-core/lib/agGrid';
  import { onMount } from 'svelte';

  interface Props {
    options: GridOptions;
    rows: readonly unknown[];
  }
  let { options, rows }: Props = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let api: GridApi | undefined;

  onMount(() => {
    if (!host) return;
    api = createGrid(host, { ...options, theme: gridTheme('dark'), rowData: [...rows] });
    // DESTROYED ON UNMOUNT. A grid left behind keeps listeners on window and a copy of every row;
    // navigating between surfaces a few times is enough to notice.
    return () => api?.destroy();
  });

  // SET, NOT RECREATED. Rebuilding the grid on every data change loses scroll position, selection
  // and column widths — which on a surface people use to READ is the whole of the interaction.
  $effect(() => {
    api?.setGridOption('rowData', [...rows]);
  });
</script>

<div class="grid-wrap"><div bind:this={host} class="grid"></div></div>

<style>
  .grid-wrap { width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); }
  .grid { width: 100%; height: 420px; }
  @media (min-width: 720px) { .grid { height: 560px; } }
</style>
