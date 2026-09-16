<script lang="ts">
  /**
   * The Scratch canvas, in Svelte Flow.
   *
   * ── THE DOCUMENT IS THE LOAD-BEARING SHAPE, NOT THE CANVAS'S ────────────────────────────────────
   *
   * `scratchFlow.ts` converts between the two and lives in `@kontra/console-core` — it has no
   * framework in it and never did. `renderScratch` on the server turns the DOCUMENT into the spec an
   * agent writes code from (ADR 0026), so `id`, `kind`, `at` and the notes keep their names whatever
   * the canvas library of the day would prefer to call them. That is what made this port a swap of
   * the renderer rather than a rewrite of the model.
   *
   * ── THIS CHUNK IS LAZY, DELIBERATELY ────────────────────────────────────────────────────────────
   *
   * `@xyflow/react` sits in the React console's ENTRY bundle: everybody downloads the canvas to open
   * Secrets. Svelte Flow is ~181 KB and is imported from a surface that is itself code-split, so it
   * is paid for by the people who open a canvas.
   */
  import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
  import type { ScratchFlowEdge, ScratchFlowNode } from '@kontra/console-core/panels/scratchFlow';
  import '@xyflow/svelte/dist/style.css';

  import NoteNode from './NoteNode.svelte';
  import ScratchNode from './ScratchNode.svelte';

  interface Props {
    nodes: ScratchFlowNode[];
    edges: ScratchFlowEdge[];
  }
  let props: Props = $props();

  // SEEDED ONCE, THEN OWNED HERE. After mount the canvas is the authority on positions — dragging a
  // node is the point — so these are local state rather than derived. `$state.snapshot` takes a
  // plain copy so the props' own reactivity does not reach into what the user is dragging.
  // svelte-ignore state_referenced_locally -- seeding once is the intent; see above
  const seedNodes = $state.snapshot(props.nodes) as ScratchFlowNode[];
  // svelte-ignore state_referenced_locally -- ditto
  const seedEdges = $state.snapshot(props.edges) as ScratchFlowEdge[];

  // THREE KINDS, ONE COMPONENT. They differed by an icon and a border colour in React, which is a
  // class rather than a component.
  const nodeTypes = { actor: ScratchNode, workflow: ScratchNode, dataset: ScratchNode, note: NoteNode };

  let nodes = $state(seedNodes);
  let edges = $state(seedEdges);
</script>

<div class="wrap">
  <SvelteFlow bind:nodes bind:edges {nodeTypes} fitView proOptions={{ hideAttribution: false }}>
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  /* A BOUNDED BOX, because a canvas given `height: auto` collapses to nothing and a canvas given
     the viewport takes the page with it on a phone. `min-height` on a flex/grid child defaults to
     auto, which is the other half of the same bug. */
  .wrap {
    height: 340px; min-height: 0; width: 100%;
    border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
    background: var(--bg);
  }
  @media (min-width: 720px) { .wrap { height: 460px; } }
</style>
