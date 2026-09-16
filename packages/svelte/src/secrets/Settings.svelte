<script lang="ts">
  /**
   * Settings — what this installation is, read from it rather than typed here.
   *
   * Everything on this page is a FACT the control plane already knows: its namespace, its bind
   * address, which surfaces each bundle serves. A settings page that let you type them would be a
   * second source for values the appliance reads from `config.yaml` at boot.
   */
  import { SURFACES } from '../lib/surfaces';

  interface Health { ok?: boolean; namespace?: string; version?: string }
  let health = $state<Health | undefined>(undefined);
  let reachable = $state(true);

  $effect(() => {
    void fetch('/api/health', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h) => (health = h as Health))
      .catch(() => (reachable = false));
  });
</script>

<section>
  <h1>Settings</h1>

  <dl>
    <dt>control plane</dt>
    <dd>{#if reachable}reachable{:else}<span class="bad">not answering</span>{/if}</dd>
    {#if health?.namespace}<dt>tenant</dt><dd class="mono">{health.namespace}</dd>{/if}
    {#if health?.version}<dt>version</dt><dd class="mono">{health.version}</dd>{/if}
  </dl>

  <h2>Surfaces</h2>
  <p class="muted">
    The console is being rebuilt one surface at a time (ADR 0048). Each is served by exactly one
    bundle; moving between them is a page load.
  </p>
  <ul>
    {#each SURFACES as s (s.id)}
      <li><span class="nm">{s.label}</span><span class="b {s.bundle}">{s.bundle}</span></li>
    {/each}
  </ul>
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  h2 { font-size: var(--t-body); font-weight: 600; margin: 0; }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  dl {
    display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3);
    margin: 0; padding: var(--s-3); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  dt { font-size: var(--t-small); color: var(--dim); }
  dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  ul li {
    display: flex; gap: var(--s-2); align-items: baseline;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); font-size: var(--t-small);
  }
  .nm { flex: 1; }
  .b { font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }
  .b.svelte { color: var(--ok); }
  .bad { color: var(--bad); }
</style>
