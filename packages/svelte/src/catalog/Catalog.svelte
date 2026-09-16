<script lang="ts">
  /**
   * Catalog — everything registered on this control plane, in one searchable list.
   *
   * ── THE FILTER IS `matchEntry`, NOT A `.includes` ───────────────────────────────────────────────
   *
   * `@kontra/console-core` already decides what a query matches, and the React console uses the same
   * function. A second implementation here would drift within a week and the two consoles would
   * disagree about whether a search found something.
   *
   * ── `name` AND `target` ARE DIFFERENT FIELDS, DELIBERATELY ──────────────────────────────────────
   *
   * A workflow's surface selects by FOLDER name while its registered type is `DnsSweep` where the
   * directory is `dns_sweep`. A card that opened its display name would navigate to a workflow that
   * does not exist. They were very nearly one field.
   */
  import { NO_FILTER, matchEntry, resultLabel, type CatalogEntry } from '@kontra/console-core/panels/catalog';

  import { loadCatalog } from './load';
  import { go } from '../lib/surfaces';

  let entries = $state<CatalogEntry[]>([]);
  let degraded = $state<string[]>([]);
  let loading = $state(true);
  let q = $state('');

  $effect(() => {
    void loadCatalog().then((r) => {
      entries = r.entries;
      degraded = r.degraded;
      loading = false;
    });
  });

  // SPREAD FROM `NO_FILTER`, not a literal. The filter carries four fields and the three this
  // surface does not offer yet have a meaning — empty means EVERY state, not none — so building one
  // by hand is how a search silently starts excluding things.
  const shown = $derived(entries.filter((e) => matchEntry(e, { ...NO_FILTER, q })));

  function open(e: CatalogEntry): void {
    // A workflow lives on a React surface today; an actor's Method call is our own `/dev`.
    const href = e.kind === 'actor'
      ? `/dev?actor=${encodeURIComponent(e.target)}&method=`
      : go('workflows', 'catalog').href + `/${encodeURIComponent(e.target)}`;
    location.assign(href);
  }
</script>

<section>
  <div class="bar">
    <h1>Catalog</h1>
    <input
      type="search"
      placeholder="filter by name, kind or queue"
      bind:value={q}
      aria-label="Filter the catalog"
    />
  </div>

  {#if degraded.length}
    <p class="degraded" role="status">
      Partial: {degraded.length} endpoint(s) did not answer, so some rows may be missing detail.
    </p>
  {/if}

  {#if loading}
    <p class="muted">reading the registry…</p>
  {:else if entries.length === 0}
    <p class="muted">
      Nothing registered yet. <code class="mono">kontra actor register &lt;dir&gt;</code> and
      <code class="mono">kontra workflow register &lt;dir&gt;</code> put things here.
    </p>
  {:else}
    <p class="count muted">{resultLabel(shown.length, entries.length)}</p>
    <ul>
      {#each shown as e (e.id)}
        <li>
          <button onclick={() => open(e)}>
            <span class="kind {e.kind}">{e.kind}</span>
            <span class="nm mono">{e.name}</span>
            {#if e.version}<span class="ver mono">{e.version}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if shown.length === 0}
      <p class="muted">No match for <b>{q}</b>.</p>
    {/if}
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  .bar { display: flex; flex-direction: column; gap: var(--s-2); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  input {
    width: 100%; background: var(--track); border: 1px solid var(--line);
    border-radius: var(--radius); color: var(--fg);
    padding: var(--s-2) var(--s-3); font-size: var(--t-small);
  }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .count { margin: 0; }
  .degraded {
    font-size: var(--t-small); color: var(--warn); margin: 0;
    border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
    border-radius: var(--radius); padding: var(--s-2) var(--s-3);
  }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  li button {
    width: 100%; display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap;
    text-align: left; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); color: var(--fg);
  }
  .kind {
    font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim);
  }
  .kind.actor { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .nm { font-size: var(--t-small); overflow-wrap: anywhere; }
  .ver { font-size: var(--t-micro); color: var(--dim); }
  code { font-size: var(--t-small); }

  @media (min-width: 720px) {
    .bar { flex-direction: row; align-items: center; justify-content: space-between; }
    input { max-width: 320px; }
  }
</style>
