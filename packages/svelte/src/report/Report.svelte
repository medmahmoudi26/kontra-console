<!--
  A RUN'S REPORT — what the workflow said it found, and the thread underneath.

  ── THIS IS A PAGE, NOT A TAB STRIP, AND THAT IS A DEPARTURE FROM §9.1 ───────────────────────────

  §9.1 asks for the report to be "the default tab" of the run detail. The run detail is one 1718-line
  component with NO page-level tab strip — the two `role="tablist"` strips in this repo are both
  in-component and in-memory, neither reflected in the URL — so there is nothing to add a tab to, and
  restructuring that component is a change with a blast radius this feature should not take on days
  before a demo. The design prototype also shows a standalone page rather than a tab.

  So the report is addressed at `/runs/<id>/report` and the run page links to it. The address
  round-trips, which is the property that actually matters: an operator can paste it. ADR 0055 records
  the deviation and what it would take to honour §9.1 properly.

  ── THE PAGE IS NEVER EMPTY, AND NEVER PRETENDS ─────────────────────────────────────────────────

  Four states, each said in words: a report, a report whose render FAILED, no report yet (the common
  case for a run that just finished), and a failed read. The last two look identical if you only draw
  the empty case, which is why `load.ts` keeps `absent` and `missing` apart.
-->
<script lang="ts">
  import { formatAddress } from '@kontra/console-core/state/address';
  import type { FeedbackNote } from '@kontra/console-core/report/snapshot';

  import {
    applyPatch,
    openLiveReport,
    type LivePhase,
  } from '@kontra/console-core/report/live';

  import Feedback from './Feedback.svelte';
  import Node from './Node.svelte';
  import { loadReport, type ReportPage } from './load';

  const {
    runId,
    backHref,
    backLabel = 'runs',
  }: { runId: string; backHref?: string; backLabel?: string } = $props();

  let page = $state<ReportPage | null>(null);
  let loading = $state(true);
  let chosen = $state<number | undefined>(undefined);

  async function read(version?: number): Promise<void> {
    loading = true;
    page = await loadReport(runId, fetch, version);
    loading = false;
  }

  $effect(() => {
    // Keyed on the run AND the chosen version, so picking an older version re-reads rather than
    // rendering the newest tree under an older number.
    void runId;
    void chosen;
    void read(chosen);
  });

  // LIVE MODE (ADR 0062). `liveBlocks` is non-null only while a stream is attached; when it is, the
  // page renders it instead of the stored tree. The stream refuses with 409 for a finished run, so a
  // report that is already frozen never enters this path.
  let liveBlocks = $state<unknown[] | null>(null);
  let livePhase = $state<LivePhase | null>(null);
  let liveDegraded = $state<string | undefined>(undefined);
  let liveStatus = $state<string | undefined>(undefined);

  $effect(() => {
    void runId;
    // Only an unchosen version watches: picking an older version is asking for a stored document.
    if (chosen !== undefined) return undefined;
    const stop = openLiveReport(runId, {
      onSnapshot: (blocks, extra) => {
        liveBlocks = blocks.map((b) => b.node);
        liveDegraded = extra.degraded;
      },
      onPatch: (blocks) => {
        if (liveBlocks) liveBlocks = applyPatch(liveBlocks, blocks);
      },
      onStatus: (status) => (liveStatus = status),
      // THE FREEZE IS A RE-READ, not the last live frame. The stored version is rendered from the
      // final context, so `result` is populated and the `{% if result %}` branch has flipped.
      onFinal: () => {
        liveBlocks = null;
        void read(undefined);
      },
      onPhase: (phase) => (livePhase = phase),
      // 409 is the ordinary case: the run was already finished when the page opened.
      onRefused: () => (liveBlocks = null),
    });
    return stop;
  });

  const report = $derived(page?.report ?? null);
  const snapshot = $derived(report?.snapshot ?? null);
  const isLive = $derived(liveBlocks !== null && livePhase === 'live');
  /** Where the breadcrumb goes back to. Defaults to the RUN, because that is where a report is of. */
  const upHref = $derived(backHref ?? formatAddress({ view: 'runs', run: runId }));
  const exportBase = $derived(`/api/runs/${encodeURIComponent(runId)}/report/export`);
  const exportQuery = $derived(report ? `&version=${report.version}` : '');

  function added(note: FeedbackNote): void {
    if (page) page.notes = [note, ...page.notes];
  }

  function stamp(at: number): string {
    return at > 0 ? new Date(at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '';
  }
</script>

<section class="report" data-testid="report-page">
  <header>
    <nav class="crumbs">
      <a href={upHref} data-testid="report-back">{backLabel}</a>
      <span class="sep">/</span>
      <span class="mono rid">{runId}</span>
      <span class="sep">/</span>
      <span>report</span>
    </nav>

    <div class="spacer"></div>

    <!-- THE CHROME MUST DESCRIBE WHAT IS ON SCREEN. While the body is live, the pill, the version and
         the export links all name the STORED version, which is a different document — and the trap is
         the asymmetry beside it: Print calls `window.print()` and prints the live DOM, while Export
         links to `?version=N` and downloads the stored one. Two chips a pixel apart, one gesture, two
         answers. Found in a browser; no unit test can see it, and it only appears when a stored
         version already exists, which is why it is the re-run case that would have hit it.
         LABELLED RATHER THAN HIDDEN: an operator mid-run still wants to know a previous version is
         there, so the answer is to say which one each control means. -->
    {#if isLive}
      <span class="pill live" data-testid="report-status">live</span>
    {/if}
    {#if report}
      {#if !isLive}
        <span class="pill {report.status === 'ok' ? 'ok' : 'bad'}" data-testid="report-status">
          {report.status === 'ok' ? 'rendered' : 'render failed'}
        </span>
      {/if}
      {#if page && page.versions.length > 1}
        <label class="versions">
          <span class="sr">version</span>
          <select
            data-testid="report-version"
            value={String(report.version)}
            onchange={(e) => (chosen = Number((e.currentTarget as HTMLSelectElement).value))}
          >
            {#each page.versions as v (v.version)}
              <option value={String(v.version)}
                >{isLive ? 'stored ' : ''}v{v.version} · {v.status} · {stamp(v.renderedAt)}</option
              >
            {/each}
          </select>
        </label>
      {:else}
        <span class="muted">{isLive ? `stored v${report.version}` : `v${report.version}`}</span>
      {/if}
      <a class="chip" href="{exportBase}?format=md{exportQuery}" data-testid="report-export-md"
        >Export {isLive ? `stored v${report.version} ` : ''}.md</a
      >
      <a class="chip" href="{exportBase}?format=html{exportQuery}">.html</a>
      <!-- PRINT IS THE PDF STORY. §7.3: a PDF is not a server feature, and the print CSS in these
           components is what makes the printed page readable. -->
      <button type="button" class="chip" onclick={() => window.print()} data-testid="report-print">Print</button>
    {/if}
  </header>

  {#if loading && page === null}
    <p class="muted">loading…</p>
  {:else if page === null}
    <p class="err" role="alert">the report could not be read</p>
  {:else}
    {#if page.missing.length > 0}
      <!-- NAMED, NOT COUNTED. An operator chasing an empty thread needs to know WHICH read failed. -->
      <ul class="missing" role="alert" data-testid="report-missing">
        {#each page.missing as m (m.url)}
          <li><span class="mono">{m.url}</span> — {m.why}</li>
        {/each}
      </ul>
    {/if}

    {#if snapshot?.warnings}
      {#each snapshot.warnings as warning (warning)}
        <p class="warning" data-testid="report-warning">{warning}</p>
      {/each}
    {/if}

    {#if report && report.status === 'error'}
      <div class="card">
        <h1>This report did not render</h1>
        <p class="muted">
          The run itself is unaffected — a render failure stores a version saying why and changes
          nothing about the work. The template is at fault, and
          <span class="mono">kontra report preview {runId}</span> renders an edited one without storing it.
        </p>
        <pre class="err-text" data-testid="report-error">{report.error}</pre>
        <p class="muted small">template {report.templateHash}</p>
      </div>
    {:else if isLive && liveBlocks}
      <!-- LIVE: the blocks the stream has sent, patched in place by index. No reveal/raw here —
           those routes default to the latest STORED version, so a reveal against a live block of the
           same ordinal would serve a different block's bytes. -->
      <div class="card" data-testid="report-live">
        <p class="provenance">
          live · re-rendering as the run progresses{liveStatus ? ` · ${liveStatus}` : ''}
        </p>
        {#if liveDegraded}
          <p class="warning" data-testid="report-degraded">{liveDegraded}</p>
        {/if}
        {#each liveBlocks as node, i (i)}
          <Node node={node as never} blocks={{}} {runId} version={0} />
        {/each}
      </div>
    {:else if snapshot}
      <div class="card" data-testid="report-body">
        <p class="provenance">
          rendered {stamp(report?.renderedAt ?? 0)} by {report?.renderedBy} · template
          <span class="mono">{report?.templateHash}</span>
        </p>
        <Node node={snapshot.root} blocks={snapshot.blocks} {runId} version={report?.version ?? 1} />
      </div>
    {:else if page.absent}
      <div class="card">
        <h1>No report yet</h1>
        <p class="muted">
          A report is rendered after a run reaches a terminal state, so a run that just finished may not
          have one for a few minutes. A run that never had a <span class="mono">report.md</span> still
          gets a default report built from what it returned — if this stays empty, the run may predate
          reports, or the renderer may be switched off
          (<span class="mono">KONTRA_REPORT_RENDER=off</span>).
        </p>
      </div>
    {/if}

    <Feedback {runId} notes={page.notes} onAdded={added} />
  {/if}
</section>

<style>
  .report {
    max-width: 56rem;
    margin: 0 auto;
    padding: var(--s-4) var(--s-4) var(--s-6);
  }

  header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-2);
    padding-bottom: var(--s-3);
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--s-4);
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-small);
    color: var(--dim);
  }

  .crumbs a {
    color: var(--accent);
  }

  .sep {
    color: var(--line);
  }

  .rid {
    color: var(--fg);
  }

  .spacer {
    flex: 1;
  }

  .pill {
    font-size: var(--t-micro);
    border-radius: 999px;
    padding: 2px var(--s-3);
    border: 1px solid var(--line);
  }

  .pill.ok {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }

  .pill.bad {
    color: var(--bad);
    border-color: color-mix(in srgb, var(--bad) 40%, transparent);
  }

  /* Deliberately NOT `ok` green. A live report is not a verdict — it is a document still being
     written, and borrowing the rendered-successfully colour would say it had finished. */
  .pill.live {
    color: var(--accent, var(--fg));
    border-color: color-mix(in srgb, var(--accent, var(--fg)) 40%, transparent);
  }

  .chip,
  select {
    font: inherit;
    font-size: var(--t-small);
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: var(--s-1) var(--s-2);
    text-decoration: none;
    cursor: pointer;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-5);
  }

  .provenance {
    margin: 0 0 var(--s-4);
    font-size: var(--t-micro);
    color: var(--dim);
    text-transform: none;
  }

  h1 {
    margin: 0 0 var(--s-3);
    font-size: var(--t-head);
  }

  .muted {
    color: var(--dim);
    font-size: var(--t-small);
  }

  .small {
    font-size: var(--t-micro);
  }

  .mono {
    font-family: var(--mono);
  }

  .warning {
    margin: 0 0 var(--s-3);
    padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    border-radius: var(--radius);
    font-size: var(--t-small);
    color: var(--fg);
  }

  .missing {
    margin: 0 0 var(--s-3);
    padding: var(--s-2) var(--s-3) var(--s-2) var(--s-5);
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    border-radius: var(--radius);
    font-size: var(--t-small);
    color: var(--fg);
  }

  .err {
    color: var(--bad);
  }

  .err-text {
    margin: 0;
    padding: var(--s-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-family: var(--mono);
    font-size: var(--t-small);
    color: var(--bad);
    white-space: pre-wrap;
  }

  @media print {
    .report {
      max-width: none;
      padding: 0;
    }

    header .chip,
    header select,
    .crumbs {
      display: none;
    }

    .card {
      border: 0;
      padding: 0;
      background: none;
    }
  }
</style>
