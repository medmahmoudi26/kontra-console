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
   * So the entry is the shell and the surface you asked for. Nobody pays for a grid to read a
   * secret.
   */
  import Shell from './lib/Shell.svelte';
  import Skeleton from './lib/Skeleton.svelte';
  import { SURFACES, go } from './lib/surfaces';

  const first = location.pathname.split('/')[1] ?? '';
  const params = new URLSearchParams(location.search);

  /** One loader per surface. A missing key is not a surface this bundle serves. */
  const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
    catalog: () => import('./catalog/Catalog.svelte'),
    actors: () => import('./actors/Actors.svelte'),
    workflows: () => import('./workflows/Workflows.svelte'),
    datasets: () => import('./datasets/Datasets.svelte'),
    secrets: () => import('./secrets/Secrets.svelte'),
    settings: () => import('./secrets/Settings.svelte'),
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

{#if first === 'dev'}
  <!-- NO SHELL. The editor owns the chrome; a nav bar here would compete with the tab strip above
       it. See CONTEXT.md, `Embed`. -->
  {#if failed}<p class="err" role="alert">{failed}</p>
  {:else if View}
    {@const V = View as typeof import('./dev/DevPane.svelte').default}
    <V actor={params.get('actor') ?? ''} method={params.get('method') ?? ''} />
  {:else}<p class="loading">loading…</p>{/if}
{:else if LOADERS[first]}
  <Shell view={first} views={SURFACES} onnavigate={(id) => location.assign(go(id, first).href)}>
    {#if failed}<p class="err" role="alert">{failed}</p>
    {:else if View}
      {@const V = View as typeof import('./catalog/Catalog.svelte').default}
      <V />
    {:else}<p class="loading">loading…</p>{/if}
  </Shell>
{:else}
  <Skeleton />
{/if}

<style>
  .err {
    margin: var(--s-3); padding: var(--s-2) var(--s-3); font-size: var(--t-small); color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  .loading { margin: var(--s-3); font-size: var(--t-small); color: var(--dim); }
</style>
