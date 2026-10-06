<!--
  A FENCED BLOCK — the one place a report shows bytes rather than prose.

  ── THE MARKERS ARE THE POINT, AND HIGHLIGHTING IS NOT ────────────────────────────────────────────

  §9.2 asks for Shiki tokens with markers added after highlighting. There is no syntax highlighter in
  this repo, and adding one brings a grammar bundle for a purely cosmetic gain, so this renders monospace
  text with the markers and no colour. The markers carry MEANING — `␍` says a line ended CRLF, `\xHH`
  says a byte is not a character — and "the response ended its headers with a bare LF" is a finding a
  renderer must not be able to destroy by normalising. ADR 0055 records the omission.

  ── FOUR WAYS TO READ THE SAME BYTES ──────────────────────────────────────────────────────────────

  Text, hex, copy and download, all computed from the bytes the page already has — no second request
  for a view of something it is holding. `Reveal` is the exception and must be: the unredacted bytes
  are not here, by design.
-->
<script lang="ts">
  import {
    bytesOf,
    hexLines,
    spansOf,
    truncationNote,
    type ReportBlock,
  } from '@kontra/console-core/report/snapshot';

  const { lang, value, block, blockId, runId, version }: {
    lang: string;
    value: string;
    block: ReportBlock | undefined;
    blockId: string;
    runId: string;
    version: number;
  } = $props();

  let view = $state<'text' | 'hex'>('text');
  let copied = $state('');

  /* THE BYTES, NOT THE TEXT, WHEN THERE ARE ANY. `value` is the decoded string the snapshot's tree
     carries for display; `block.b64` is what was actually there. They differ exactly where a byte is
     not a character, which is the case this component exists for. A literal fenced block an author
     typed into their template has no `block` at all — it is Markdown, not evidence — and renders from
     the text. */
  const bytes = $derived(block ? bytesOf(block.b64) : new TextEncoder().encode(value));
  const lines = $derived(spansOf(bytes));
  const hex = $derived(view === 'hex' ? hexLines(bytes) : []);
  const note = $derived(block ? truncationNote(block) : '');
  const unresolved = $derived(block?.unresolved !== undefined);

  const rawUrl = $derived(
    `/api/runs/${encodeURIComponent(runId)}/report/blocks/${encodeURIComponent(blockId)}/raw?version=${version}`
  );

  /** Copy the bytes as latin-1 text, which is what makes a non-UTF-8 byte survive the clipboard. */
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      copied = 'copied';
    } catch (err) {
      // SAID, NOT SWALLOWED. The clipboard is refused in plenty of ordinary situations — an insecure
      // origin, a denied permission — and a button that silently does nothing reads as a broken page.
      copied = err instanceof Error ? `could not copy: ${err.message}` : 'could not copy';
    }
    setTimeout(() => {
      copied = '';
    }, 2500);
  }
</script>

<figure class="block" data-testid="report-block-{blockId || 'literal'}">
  <figcaption>
    <span class="lang mono">{lang || 'text'}</span>
    {#if block?.redacted}
      <!-- SAID ON THE BLOCK ITSELF. A reader who does not know a line was redacted may read
           `Authorization: [redacted]` as what the target actually received. -->
      <span class="tag redacted" title="credential values were replaced before this was stored">redacted</span>
    {/if}
    {#if note}
      <span class="tag {unresolved ? 'bad' : ''}">{note}</span>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="chip" aria-pressed={view === 'hex'} onclick={() => (view = view === 'hex' ? 'text' : 'hex')}>
      {view === 'hex' ? 'text' : 'hex'}
    </button>
    <button type="button" class="chip" onclick={copy}>copy</button>
    {#if blockId}
      <!-- A DOWNLOAD IS A LINK TO THE ROUTE, not a blob built here: the route is the authority on what
           the stored bytes are, and a client-built file could drift from it. -->
      <a class="chip" href={rawUrl} download="{runId}-{blockId}.bin">download</a>
    {/if}
  </figcaption>

  {#if unresolved}
    <pre class="unread" data-testid="report-block-unread">{block?.unresolved}
ref: {block?.ref ?? '(none recorded)'}
This block was NOT read. That is different from a block that was empty.</pre>
  {:else if view === 'hex'}
    <pre class="hex" data-testid="report-block-hex">{#each hex as line, i (i)}<span class="off">{line.offset}</span>  {line.hex.padEnd(47, ' ')}  |{line.ascii}|
{/each}</pre>
  {:else}
    <!-- The line break between lines is a literal `\n` rather than a newline inside an `{#if}`: Svelte
         reads a block whose only content is whitespace as EMPTY and warns, and a warning nobody can
         act on is a warning people learn to scroll past. -->
    <pre data-testid="report-block-text">{#each lines as line, i (i)}{#each line as span, s (s)}{#if span.marker}<span class="marker">{span.text}</span>{:else}{span.text}{/if}{/each}{i < lines.length - 1 ? '\n' : ''}{/each}</pre>
  {/if}

  {#if copied}
    <p class="said" role="status">{copied}</p>
  {/if}
</figure>

<style>
  .block {
    margin: 0 0 var(--s-4);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    overflow: hidden;
  }

  figcaption {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
    background: var(--track);
    font-size: var(--t-micro);
  }

  .lang {
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .spacer {
    flex: 1;
  }

  .tag {
    color: var(--dim);
  }

  .tag.redacted {
    color: var(--warn);
  }

  .tag.bad {
    color: var(--bad);
  }

  .chip {
    font: inherit;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 2px var(--s-2);
    cursor: pointer;
    text-decoration: none;
  }

  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  pre {
    margin: 0;
    padding: var(--s-3);
    overflow-x: auto;
    font-family: var(--mono);
    font-size: var(--t-small);
    line-height: 1.5;
    color: var(--fg);
    white-space: pre;
    tab-size: 4;
  }

  .marker {
    color: var(--dim);
    opacity: 0.8;
  }

  .hex .off {
    color: var(--dim);
  }

  .unread {
    color: var(--bad);
  }

  .said {
    margin: 0;
    padding: var(--s-1) var(--s-3) var(--s-2);
    font-size: var(--t-micro);
    color: var(--dim);
  }

  @media print {
    /* A code block WRAPS rather than clipping: a printed report that cut a request in half at the page
       edge would be evidence with a piece missing. */
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      overflow: visible;
    }

    .chip {
      display: none;
    }
  }
</style>
