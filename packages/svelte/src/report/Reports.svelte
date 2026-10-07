<!--
  THE REPORTS SURFACE — every run that found something, and one of them open.

  ── WHY THIS IS A SURFACE AND NOT A TAB ON THE RUN PAGE ──────────────────────────────────────────

  A report answers "what did this run FIND", which is a different question from "what did this run
  DO" — and it is the question somebody comes back to days later, after the Run's Parquet has aged
  out and the Temporal history has gone. It also outlives both: a report is the thing that gets
  forwarded. So it is addressed in its own right, and it does not take a position in the run page's
  header, which already has one job (`‹ Runs`, how you leave).

  The run page links DOWN here from the bottom of its record, which is the natural reading order: you
  finish the input, the output and the phases, and then read what the run said about all of it.

  ── LIST OR ONE, THE SAME SHAPE THE RUNS SURFACE USES ───────────────────────────────────────────

  `/reports` is the list, `/reports/<runId>` is one. Addressed by the RUN id, because there is no
  report id: one Run has one report with versions inside it.
-->
<script lang="ts">
  import { formatAddress, parseAddress } from '@kontra/console-core/state/address';

  import Report from './Report.svelte';
  import { ago, loadReportList, type ReportListing } from './load';

  function fromUrl(): string | null {
    const a = parseAddress(location.pathname + location.search);
    return a !== null && a.view === 'reports' ? a.run : null;
  }

  let open = $state<string | null>(fromUrl());
  let listing = $state<ReportListing | null>(null);
  let loading = $state(true);

  $effect(() => {
    const onPop = (): void => {
      open = fromUrl();
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  });

  $effect(() => {
    // The list is read once and kept: opening a report and coming back should not re-read it, and a
    // report is immutable so there is nothing to refresh.
    if (listing !== null) return;
    loading = true;
    void loadReportList().then((l) => {
      listing = l;
      loading = false;
    });
  });

  function show(runId: string | null): void {
    history.pushState({}, '', formatAddress({ view: 'reports', run: runId }));
    open = runId;
  }

  function stamp(at: number): string {
    return at > 0 ? new Date(at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') : '';
  }

  const rows = $derived(listing?.rows ?? []);
</script>

{#if open !== null}
  <!-- The report itself, with its own breadcrumb back to this list. -->
  <Report runId={open} backHref={formatAddress({ view: 'reports', run: null })} backLabel="reports" />
{:else}
  <section class="list" data-testid="reports-list">
    <h1>Reports</h1>
    <p class="lede">
      What each run FOUND, rendered through the <code>report.md</code> beside its workflow. A report is
      immutable and versioned, credentials are redacted before it is stored, and the thread under one is
      readable by your agent over MCP.
    </p>

    {#if loading}
      <p class="muted">loading…</p>
    {:else}
      {#if listing && listing.missing.length > 0}
        <!-- NAMED, NOT COUNTED. An empty list and an unreadable one must not look the same. -->
        <ul class="missing" role="alert" data-testid="reports-missing">
          {#each listing.missing as m (m.url)}
            <li><span class="mono">{m.url}</span> — {m.why}</li>
          {/each}
        </ul>
      {/if}

      {#if rows.length === 0 && (listing?.missing.length ?? 0) === 0}
        <p class="muted empty" data-testid="reports-empty">
          No reports yet. One is rendered when a run reaches a terminal state — a run that just
          finished may not have one for a few minutes, and a run from before reports existed has none.
        </p>
      {:else}
        <ul class="reports">
          {#each rows as r (r.runId)}
            <li>
              <a
                class="row"
                href={formatAddress({ view: 'reports', run: r.runId })}
                data-testid="report-row-{r.runId}"
                onclick={(e) => {
                  // Left-click without a modifier navigates in place; everything else is left to the
                  // browser, because this is an address somebody pastes and middle-click must work.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  show(r.runId);
                }}
              >
                <span class="rid mono">{r.runId}</span>
                <span class="wf">{r.workflow ?? '—'}</span>
                <span class="ws">{r.workspace ?? ''}</span>
                <span class="word {r.status === 'ok' ? 'ok' : 'bad'}">
                  {r.status === 'ok' ? 'rendered' : 'failed'}
                </span>
                <span class="vers" title="{r.versions} version{r.versions === 1 ? '' : 's'}">
                  v{r.version}{r.versions > 1 ? ` of ${r.versions}` : ''}
                </span>
                <span class="when mono" title={stamp(r.renderedAt)}>{ago(r.renderedAt)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .list {
    max-width: 68rem;
    margin: 0 auto;
    padding: var(--s-4) var(--s-4) var(--s-6);
  }

  h1 {
    margin: 0 0 var(--s-2);
    font-size: var(--t-head);
  }

  .lede {
    margin: 0 0 var(--s-5);
    max-width: 48rem;
    color: var(--dim);
    font-size: var(--t-small);
  }

  .lede code {
    font-family: var(--mono);
    font-size: var(--t-micro);
  }

  .muted {
    color: var(--dim);
    font-size: var(--t-small);
  }

  .empty {
    max-width: 44rem;
  }

  .missing {
    margin: 0 0 var(--s-4);
    padding: var(--s-2) var(--s-3) var(--s-2) var(--s-5);
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    border-radius: var(--radius);
    font-size: var(--t-small);
  }

  .reports {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: grid;
    /* The run id is the identity and takes the room; everything else is a fact about it. At phone
       width the grid collapses to two columns — see the media query. */
    grid-template-columns: minmax(12rem, 2fr) minmax(6rem, 1fr) minmax(0, 0.8fr) 6rem 7rem 5.5rem;
    align-items: baseline;
    gap: var(--s-3);
    padding: var(--s-3);
    border-bottom: 1px solid var(--line);
    text-decoration: none;
    color: var(--fg);
  }

  .row:hover {
    background: var(--panel);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .mono {
    font-family: var(--mono);
  }

  .rid {
    font-size: var(--t-small);
  }

  .wf,
  .ws,
  .vers,
  .when {
    font-size: var(--t-small);
    color: var(--dim);
  }

  .word {
    font-size: var(--t-micro);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .word.ok {
    color: var(--ok);
  }

  .word.bad {
    color: var(--bad);
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr auto;
    }

    .ws,
    .vers {
      display: none;
    }
  }
</style>
