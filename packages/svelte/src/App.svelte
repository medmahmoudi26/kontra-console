<script lang="ts">
  /**
   * Which surface this document is showing.
   *
   * ── THE ROUTE IS READ, NOT ROUTED ───────────────────────────────────────────────────────────────
   *
   * There is no router. The orchestrator already decided which bundle serves this path (ADR 0048
   * §1), so by the time this runs the answer is in `location.pathname` and a client-side router
   * would be a second opinion about a question already settled. When there are several Svelte
   * surfaces this becomes a `switch`; it does not become a routing library.
   */
  import Dev from './dev/Dev.svelte';
  import Skeleton from './lib/Skeleton.svelte';
  import { watchContract, type LiveContract } from './dev/live';

  const first = location.pathname.split('/')[1] ?? '';
  const params = new URLSearchParams(location.search);

  let live = $state<LiveContract>({ contract: { state: 'loading' }, link: 'connecting', revisions: 0 });

  // THE EFFECT RETURNS ITS OWN TEARDOWN. An EventSource left open holds a connection the server
  // counts, and the schema stream refuses past a limit with "close a runner tab and retry" — which
  // is a message an operator gets for a leak they did not cause.
  $effect(() => {
    if (first !== 'dev') return;
    return watchContract(params.get('actor') ?? '', params.get('method') ?? '', (s) => (live = s));
  });
</script>

{#if first === 'dev'}
  <Dev
    actor={params.get('actor') ?? ''}
    version={live.contract.state === 'ready' ? live.contract.version : ''}
    method={params.get('method') ?? ''}
    schema={live.contract.state === 'ready' ? live.contract.schema : undefined}
    loading={live.contract.state === 'loading'}
    link={live.link}
    revisions={live.revisions}
  />
  {#if live.contract.state === 'error'}
    <p class="err" role="alert">{live.contract.error}</p>
  {/if}
{:else}
  <Skeleton />
{/if}

<style>
  .err {
    margin: 0 var(--s-3) var(--s-3);
    padding: var(--s-2) var(--s-3);
    font-size: var(--t-small);
    color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
    border-radius: var(--radius);
  }
</style>
