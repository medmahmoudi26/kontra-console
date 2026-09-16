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
  import { contractFor, type Contract } from './dev/contract';

  const first = location.pathname.split('/')[1] ?? '';
  const params = new URLSearchParams(location.search);

  let contract = $state<Contract>({ state: 'loading' });
  $effect(() => {
    if (first !== 'dev') return;
    void contractFor(params.get('actor') ?? '', params.get('method') ?? '').then((c) => (contract = c));
  });
</script>

{#if first === 'dev'}
  <Dev
    actor={params.get('actor') ?? ''}
    version={contract.state === 'ready' ? contract.version : ''}
    method={params.get('method') ?? ''}
    schema={contract.state === 'ready' ? contract.schema : undefined}
    loading={contract.state === 'loading'}
  />
  {#if contract.state === 'error'}
    <p class="err" role="alert">{contract.error}</p>
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
