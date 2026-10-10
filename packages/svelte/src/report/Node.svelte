<!--
  ONE mdast NODE, AND ITS CHILDREN — the whole of how a report is rendered.

  NO `{@html}` AND NO `innerHTML`, and the reason is structural rather than disciplinary: a snapshot is
  a TREE, because the orchestrator dropped every `html` node before storing it. There is no markup here
  to inject, so this repo's build guard against `{@html}` stays satisfied by construction and not by
  anybody remembering.

  A CLOSED SET OF TYPES, matching the eighteen the orchestrator's `ALLOWED_NODES` admits. A type outside
  the set renders as its own text, which is what makes a remark upgrade that emits something new inert
  rather than invisible.

  RECURSION BY SELF-IMPORT, which is how Svelte 5 spells what `<svelte:self>` used to.
-->
<script lang="ts">
  import type { ReportBlock, ReportNode } from '@kontra/console-core/report/snapshot';

  import CodeBlock from './CodeBlock.svelte';
  import Node from './Node.svelte';

  const { node, blocks, runId, version }: {
    node: ReportNode;
    blocks: Record<string, ReportBlock>;
    runId: string;
    version: number;
  } = $props();

  const kids = $derived(node.children ?? []);
  const text = $derived(typeof node.value === 'string' ? node.value : '');
  /** A link's url was already restricted to http(s) before storage; checked again at the last step. */
  const href = $derived(typeof node.url === 'string' && /^https?:\/\//i.test(node.url) ? node.url : '');
  const depth = $derived(Math.min(Math.max(Number(node.depth ?? 2), 1), 6));
</script>

{#if node.type === 'text'}{text}{:else if node.type === 'paragraph'}
  <p>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</p>
{:else if node.type === 'heading'}
  {#if depth === 1}
    <h1>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</h1>
  {:else if depth === 2}
    <h2>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</h2>
  {:else if depth === 3}
    <h3>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</h3>
  {:else}
    <h4>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</h4>
  {/if}
{:else if node.type === 'strong'}
  <strong>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</strong>
{:else if node.type === 'emphasis'}
  <em>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</em>
{:else if node.type === 'delete'}
  <del>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</del>
{:else if node.type === 'inlineCode'}
  <code>{text}</code>
{:else if node.type === 'break'}
  <br />
{:else if node.type === 'link'}
  {#if href}
    <!-- `noreferrer` as well as `noopener`: a report is forwarded, and a target's own URL must not
         learn which console opened it. -->
    <a {href} target="_blank" rel="noreferrer noopener">{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</a>
  {:else}
    {#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}
  {/if}
{:else if node.type === 'thematicBreak'}
  <hr />
{:else if node.type === 'blockquote'}
  <blockquote>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</blockquote>
{:else if node.type === 'list'}
  {#if node.ordered === true}
    <ol start={Number(node.start ?? 1)}>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</ol>
  {:else}
    <ul>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</ul>
  {/if}
{:else if node.type === 'listItem'}
  <li>{#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</li>
{:else if node.type === 'table'}
  <!-- A wide table scrolls INSIDE a box rather than pushing the page sideways — the rule the Datasets
       table already follows, and the one that keeps a report readable at phone width. -->
  <div class="scroll">
    <table>
      {#each kids as row, r (r)}
        {#if r === 0}
          <thead>
            <tr>
              {#each row.children ?? [] as cell, c (c)}
                <th>{#each cell.children ?? [] as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</th>
              {/each}
            </tr>
          </thead>
        {/if}
      {/each}
      <tbody>
        {#each kids.slice(1) as row, r (r)}
          <tr>
            {#each row.children ?? [] as cell, c (c)}
              <td>{#each cell.children ?? [] as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if node.type === 'code'}
  <CodeBlock
    lang={typeof node.lang === 'string' ? node.lang : ''}
    value={text}
    block={typeof node.blockId === 'string' ? blocks[node.blockId] : undefined}
    blockId={typeof node.blockId === 'string' ? node.blockId : ''}
    {runId}
    {version}
  />
{:else if kids.length > 0}
  <!-- An unknown CONTAINER contributes its children. A remark upgrade that emits a new node type is
       therefore inert rather than a hole in the page. -->
  {#each kids as kid, i (i)}<Node node={kid} {blocks} {runId} {version} />{/each}
{:else if text}
  {text}
{/if}

<style>
  p {
    margin: 0 0 var(--s-4);
    color: var(--fg);
  }

  h1 {
    margin: 0 0 var(--s-3);
    font-size: var(--t-display);
    line-height: var(--lh-tight);
    letter-spacing: -0.01em;
  }

  h2 {
    margin: var(--s-5) 0 var(--s-3);
    font-size: var(--t-lead);
  }

  h3,
  h4 {
    margin: var(--s-4) 0 var(--s-2);
    font-size: var(--t-body);
  }

  code {
    font-family: var(--mono);
    font-size: var(--t-small);
    background: var(--track);
    border-radius: 3px;
    padding: 0.1em 0.3em;
  }

  a {
    color: var(--accent);
  }

  hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: var(--s-5) 0;
  }

  blockquote {
    margin: var(--s-4) 0;
    padding: var(--s-1) var(--s-4);
    border-left: 3px solid var(--line);
    color: var(--dim);
  }

  ul,
  ol {
    margin: 0 0 var(--s-4);
    padding-left: var(--s-5);
    color: var(--fg);
  }

  li {
    margin: var(--s-1) 0;
  }

  .scroll {
    overflow-x: auto;
    margin: 0 0 var(--s-4);
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--t-small);
  }

  th,
  td {
    text-align: left;
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  th {
    color: var(--dim);
    font-weight: 500;
    text-transform: none;
  }

  @media print {
    h2 {
      break-before: page;
    }

    .scroll {
      overflow: visible;
    }

    th,
    td {
      white-space: normal;
    }
  }
</style>
