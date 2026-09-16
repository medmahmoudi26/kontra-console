<script lang="ts">
  /**
   * Slice 02's whole surface: proof that a second bundle is built, served, routed and authenticated.
   *
   * IT IS DELIBERATELY PLAIN. The design language arrives in slice 03; a styled page here would make
   * a failure ambiguous between the plumbing and the CSS, and the plumbing is what is on trial.
   *
   * What it shows is chosen to be evidence rather than decoration: the path the server routed here,
   * and whether the session cookie established on a React surface is already valid — which is the
   * one-login requirement (ADR 0048, ADR 0045) and the thing most likely to be quietly wrong.
   */
  import { whoami, type Who } from './session';

  let who = $state<Who>({ state: 'checking' });
  $effect(() => {
    void whoami().then((w) => (who = w));
  });
</script>

<main>
  <h1>kontra — svelte bundle</h1>
  <dl>
    <dt>route</dt>
    <dd>{location.pathname}</dd>
    <dt>bundle</dt>
    <dd>svelte</dd>
    <dt>session</dt>
    <dd>
      {#if who.state === 'checking'}checking…
      {:else if who.state === 'signed-in'}signed in as <b>{who.user}</b> — no second login
      {:else if who.state === 'signed-out'}signed out
      {:else}could not ask: {who.error}{/if}
    </dd>
  </dl>
</main>

<style>
  main { font: 400 14px/1.6 ui-sans-serif, system-ui, sans-serif; padding: 24px; max-width: 60ch; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
  dt { font-family: ui-monospace, monospace; font-size: 12px; opacity: 0.7; }
  dd { margin: 0; }
</style>
