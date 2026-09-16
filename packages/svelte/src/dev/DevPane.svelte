<script lang="ts">
  /**
   * `/dev`'s own entry: subscribe to the contract, render the form.
   *
   * Split out of `App.svelte` when every surface became a dynamic import — the subscription belongs
   * with the surface that needs it, not in a shell that may never render it.
   */
  import Dev from './Dev.svelte';
  import { watchContract, type LiveContract } from './live';

  interface Props { actor: string; method: string }
  let { actor, method }: Props = $props();

  let live = $state<LiveContract>({ contract: { state: 'loading' }, link: 'connecting', revisions: 0 });

  // THE EFFECT RETURNS ITS TEARDOWN. An EventSource left open holds a connection the server counts,
  // and the schema stream refuses past a limit with "close a runner tab and retry" — a message an
  // operator gets for a leak they did not cause.
  $effect(() => watchContract(actor, method, (s) => (live = s)));
</script>

<Dev
  {actor}
  {method}
  version={live.contract.state === 'ready' ? live.contract.version : ''}
  schema={live.contract.state === 'ready' ? live.contract.schema : undefined}
  loading={live.contract.state === 'loading'}
  link={live.link}
  revisions={live.revisions}
/>
{#if live.contract.state === 'error'}
  <p class="err" role="alert">{live.contract.error}</p>
{/if}

<style>
  .err {
    margin: 0 var(--s-3) var(--s-3); padding: var(--s-2) var(--s-3);
    font-size: var(--t-small); color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
</style>
