<script lang="ts">
  /**
   * The walking skeleton from slice 02, still served at `/_svelte`.
   *
   * It stays until a second real surface exists, because it is what the overflow check runs against
   * when `/dev` needs query parameters it cannot invent. A check with nothing to check is the
   * failure that check exists to prevent.
   */
  import Shell from './Shell.svelte';
  import { whoami, type Who } from '../session';

  const VIEWS = [{ id: '_svelte', label: 'Skeleton' }] as const;
  let who = $state<Who>({ state: 'checking' });
  $effect(() => {
    void whoami().then((w) => (who = w));
  });
</script>

<Shell view="_svelte" views={VIEWS}>
  <section>
    <h1>The second bundle</h1>
    <p class="lede">
      Svelte, served by the orchestrator beside the React console. <code class="mono">/dev</code> is
      the first real surface; this page proves the plumbing and the type scale.
    </p>
    <dl>
      <dt>route</dt><dd class="mono">{location.pathname}</dd>
      <dt>bundle</dt><dd class="mono">svelte</dd>
      <dt>reachable</dt>
      <dd>
        {#if who.state === 'checking'}checking…
        {:else if who.state === 'signed-in'}the API answers on this origin
        {:else if who.state === 'signed-out'}signed out
        {:else}<span class="bad">{who.error}</span>{/if}
      </dd>
    </dl>
  </section>
</Shell>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; text-wrap: balance; }
  .lede { font-size: var(--t-body); color: var(--dim); margin: 0; max-width: 62ch; }
  dl {
    display: grid; grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--s-1) var(--s-3); margin: 0; padding: var(--s-3);
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  }
  dt { font-size: var(--t-small); color: var(--dim); }
  dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  code { font-size: var(--t-small); }
  .bad { color: var(--bad); }
</style>
