<script lang="ts">
  /**
   * The ONE place in this bundle that renders a string as markup.
   *
   * `no-raw-html.mjs` exempts this file by PATH and refuses `{@html}` everywhere else — including in
   * another file that also promises to escape. The promise is not the safeguard; the single path is.
   *
   * `renderMarkdown` escapes every byte BEFORE it formats anything, so what arrives here cannot
   * contain markup the source did not already have escaped.
   */
  import { renderMarkdown } from './markdown';

  interface Props { source: string }
  let { source }: Props = $props();
  const html = $derived(renderMarkdown(source));
</script>

<div class="md">{@html html}</div>

<style>
  .md { font-size: var(--t-small); color: var(--fg); line-height: var(--lh-body); overflow-wrap: anywhere; }
  .md :global(p) { margin: 0 0 var(--s-2); }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(code) { font-family: var(--mono); font-size: var(--t-micro); background: var(--track); padding: 1px 4px; border-radius: 3px; }
  .md :global(a) { color: var(--accent); }
</style>
