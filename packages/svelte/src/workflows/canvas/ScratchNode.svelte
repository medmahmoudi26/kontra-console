<script lang="ts">
  /**
   * One node on the Scratch canvas: actor, workflow or dataset.
   *
   * ── ONE COMPONENT FOR THREE KINDS ───────────────────────────────────────────────────────────────
   *
   * The React canvas had a component per kind. They differed by an icon and a border colour, which
   * is a `class` and not a component — so this takes the kind as data and the registry maps all
   * three to it. Fewer files, and a fourth kind is a CSS rule rather than a new module.
   *
   * ── HANDLES ARE WHY THIS IS A COMPONENT AT ALL ──────────────────────────────────────────────────
   *
   * A node's box could be drawn by the library. What cannot is where an edge attaches: `Handle`
   * registers a connection point with the canvas, and its `position` decides which side an edge
   * leaves from. That is the whole reason custom nodes exist here.
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { NODE_H, NODE_W } from '@kontra/console-core/panels/scratchFlow';

  let { data, selected }: NodeProps = $props();
  const d = $derived(data as { kind?: string; label?: string; sub?: string; state?: string });
</script>

<div
  class="node {d.kind ?? 'actor'}"
  class:selected
  style:width="{NODE_W}px"
  style:min-height="{NODE_H}px"
>
  <Handle type="target" position={Position.Left} />
  <span class="kind">{d.kind ?? 'actor'}</span>
  <span class="label mono">{d.label ?? ''}</span>
  {#if d.sub}<span class="sub mono">{d.sub}</span>{/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .node {
    display: flex; flex-direction: column; gap: 2px; justify-content: center;
    box-sizing: border-box; padding: var(--s-2) var(--s-3);
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg);
  }
  .node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
  .node.actor { border-left: 3px solid var(--accent); }
  .node.workflow { border-left: 3px solid var(--ok); }
  .node.dataset { border-left: 3px solid var(--warn); }
  .kind { font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }
  .label { font-size: var(--t-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: var(--t-micro); color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
