<script lang="ts">
  /**
   * Which surface this document is showing, and nothing else.
   *
   * ── THE ROUTE IS READ, NOT ROUTED ───────────────────────────────────────────────────────────────
   *
   * There is no router. The orchestrator already decided which bundle serves this path (ADR 0048
   * §1), so by the time this runs the answer is in `location.pathname`; a client-side router would
   * be a second opinion about a question already settled.
   *
   * ── EVERY SURFACE IS A DYNAMIC IMPORT, AND THAT IS NOT PREMATURE ────────────────────────────────
   *
   * Static imports here put every surface's dependencies in the ENTRY. Measured, on this file:
   * importing `Datasets` statically dragged ag-grid in and the entry went from 93 KB to
   * **1.18 MB** — precisely the thing this migration criticises the React console for, where
   * `@xyflow/react` sits in the entry and everybody downloads the canvas to open Secrets.
   *
   * THAT PARTICULAR 1.18 MB IS GONE: `Datasets` no longer uses ag-grid at all — it renders
   * `DataTable.svelte`, which is a `<table>` styled from the same tokens as everything else. The
   * dynamic import stays, because the argument was never about one dependency: the canvas is still
   * behind one, and the rule is that nobody pays for a surface they did not open.
   */
  import { formatAddress, parseAddress } from '@kontra/console-core/state/address';
  import { DEFAULT_VIEW, RETIRED } from '@kontra/console-core/state/surfaces';

  import Login from './lib/Login.svelte';
  import Shell from './lib/Shell.svelte';
  import { SURFACES, go } from './lib/surfaces';

  /**
   * The surface this document is showing.
   *
   * `/` IS THE DEFAULT SURFACE, not a page of its own. The console is opened at the origin more
   * often than at any single surface — a bookmark, a `docker compose up` message, the extension's
   * "open console" — and an empty shell there reads as a broken install. `DEFAULT_VIEW` is the
   * console's own answer to "where does work start", shared with the address parser.
   */
  const segment = location.pathname.split('/')[1] ?? '';
  const first = segment === '' ? DEFAULT_VIEW : segment;
  const params = new URLSearchParams(location.search);

  /**
   * A RETIRED ADDRESS IS NOT A DEAD URL.
   *
   * `/runs/nscheck-123` is in somebody's tab, somebody's notes and somebody's Slack. A run is
   * reached through its workflow now, so the address still MEANS something and the id survives the
   * move: `parseAddress` turns it into the live address and this replaces it. The React console did
   * this and the orchestrator still serves both segments so the shell can load and perform it.
   *
   * `replace`, NOT `assign`: a redirect must not leave a back button that returns to the address it
   * just left, which would bounce forever.
   */
  if (RETIRED[first] !== undefined) {
    const to = parseAddress(location.pathname + location.search);
    location.replace(to === null ? '/workflows' : formatAddress(to));
  }

  /** One loader per surface. A missing key is not a surface this bundle serves. */
  const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
    catalog: () => import('./catalog/Catalog.svelte'),
    actors: () => import('./actors/Actors.svelte'),
    workflows: () => import('./workflows/Workflows.svelte'),
    runs: () => import('./runs/Runs.svelte'),
    reports: () => import('./report/Reports.svelte'),
    datasets: () => import('./datasets/Datasets.svelte'),
    secrets: () => import('./secrets/Secrets.svelte'),
    settings: () => import('./secrets/Settings.svelte'),
    logs: () => import('./logs/Logs.svelte'),
    dev: () => import('./dev/DevPane.svelte'),
  };

  let View = $state<unknown>(undefined);
  let failed = $state('');

  $effect(() => {
    const load = LOADERS[first];
    if (!load) return;
    void load()
      .then((m) => (View = m.default))
      // A CHUNK THAT WILL NOT LOAD IS USUALLY A REDEPLOY, and the fix is a reload — so say that
      // rather than leaving a blank surface that looks like the control plane is down.
      .catch(() => (failed = 'could not load this surface — it may have been redeployed. Reload the page.'));
  });
</script>

<Login>
{#if first === 'dev'}
  <!-- NO SHELL. The editor owns the chrome; a nav bar here would compete with the tab strip above
       it. See CONTEXT.md, `Embed`. -->
  {#if failed}<p class="err" role="alert">{failed}</p>
  {:else if View}
    {@const V = View as typeof import('./dev/DevPane.svelte').default}
    <V actor={params.get('actor') ?? ''} method={params.get('method') ?? ''} />
  {:else}<p class="loading">loading…</p>{/if}
{:else if LOADERS[first]}
  <!-- DATASETS IS A TABLE, NOT PROSE, AND LOGS IS A TERMINAL. The 1180px cap protects line length,
       which a nine-column grid does not have; the same cap is what made Datasets feel narrower than
       the grid it replaced. Logs is the same argument from the other direction: a row there is
       `time · actor · message`, and the first two columns cost 21 characters before the message
       starts — capped at 1180px that is a third of the line spent on identity, and long lines wrap
       that would not have to. Named here rather than inside either view, because the width belongs
       to the SHELL. -->
  <Shell view={first} views={SURFACES} wide={first === 'datasets' || first === 'logs' || first === 'runs'}
         onnavigate={(id) => location.assign(go(id, first).href)}>
    {#if failed}<p class="err" role="alert">{failed}</p>
    {:else if View}
      {@const V = View as typeof import('./catalog/Catalog.svelte').default}
      <V />
    {:else}<p class="loading">loading…</p>{/if}
  </Shell>
{:else}
  <!-- A SEGMENT NOTHING SERVES. The orchestrator only falls back to this document for a segment in
       its own allowlist, so arriving here means the two lists disagree — which is worth saying
       rather than drawing an empty shell that looks like a surface that failed to load. -->
  <Shell view={first} views={SURFACES} onnavigate={(id) => location.assign(go(id, first).href)}>
    <p class="err" role="alert">
      There is no surface called <b>{first}</b>. Pick one above.
    </p>
  </Shell>
{/if}
</Login>

<style>
  .err {
    margin: var(--s-3); padding: var(--s-2) var(--s-3); font-size: var(--t-small); color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  .loading { margin: var(--s-3); font-size: var(--t-small); color: var(--dim); }
</style>
