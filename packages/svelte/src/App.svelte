<script lang="ts">
  /**
   * Slice 03: the skeleton route wearing the design language.
   *
   * Still one page with no data — slices 04 onward bring surfaces. What it demonstrates is that the
   * scale, the tokens and the panel-first shell hold at 320px, and the CI check asserts it.
   */
  import Shell from './lib/Shell.svelte';
  import { whoami, type Who } from './session';

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
      Svelte, served by the orchestrator beside the React console. This page exists to prove the
      plumbing and the type scale, and is replaced by the first real surface in slice 04.
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

    <p class="note">
      Every size on this page comes from the scale — 12px floor, 14px base. The narrow layout is the
      default; the wider one is the media query.
    </p>
  </section>
</Shell>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; text-wrap: balance; }
  .lede { font-size: var(--t-body); color: var(--dim); margin: 0; max-width: 62ch; }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--s-1) var(--s-3);
    margin: 0;
    padding: var(--s-3);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  dt { font-size: var(--t-small); color: var(--dim); }
  dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  .bad { color: var(--bad); }
  .note { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; }
</style>
