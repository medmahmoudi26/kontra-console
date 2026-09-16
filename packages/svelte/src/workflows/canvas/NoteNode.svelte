<script lang="ts">
  /**
   * A note: prose somebody pinned to the canvas.
   *
   * IT HAS NO HANDLES, and that is the difference that makes it its own component rather than a
   * fourth `kind`. A note is not part of the graph — nothing connects to it — so giving it
   * connection points would let somebody draw an edge that the document has no way to represent.
   */
  import type { NodeProps } from '@xyflow/svelte';
  import { NODE_W } from '@kontra/console-core/panels/scratchFlow';

  let { data, selected }: NodeProps = $props();
  const d = $derived(data as { text?: string });
</script>

<div class="note" class:selected style:width="{NODE_W}px">{d.text ?? ''}</div>

<style>
  .note {
    box-sizing: border-box; padding: var(--s-2) var(--s-3);
    background: color-mix(in srgb, var(--warn) 10%, var(--panel));
    border: 1px dashed color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: var(--radius);
    font-size: var(--t-small); color: var(--fg); line-height: var(--lh-body);
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .note.selected { border-style: solid; border-color: var(--accent); }
</style>
