<script lang="ts">
  /**
   * Settings — what this installation is, read from it rather than typed here.
   *
   * Everything on this page is a FACT the control plane already knows: its namespace, its bind
   * address, which surfaces each bundle serves. A settings page that let you type them would be a
   * second source for values the appliance reads from `config.yaml` at boot.
   *
   * ── AND NOW WHAT IT RUNS ON: `Infra` (ADR 0052 §6) ──────────────────────────────────────────────
   *
   * "Settings gains `Infra`, and it is how an install is verified" — every Machine this control plane
   * owns and what is serving on each, which is the same KIND of fact as the three above: read off the
   * install, never authored here. It is a section rather than a ninth nav Surface, and that is a
   * decision with a cross-repo reason recorded in `infra/Infra.svelte`: a nav entry the orchestrator's
   * `SPA_SURFACES` does not carry 404s on a COLD load and only on a cold load, which is what let the
   * same bug ride a release once already (`lib/surfaces.ts:4-9`).
   *
   * IT IS STATICALLY IMPORTED, unlike a surface. `App.svelte:11-21`'s argument is that nobody pays for
   * a surface they did not open; this one has no heavy dependency — no grid, no canvas, no terminal —
   * so a second chunk for it would buy a round trip and nothing else.
   */
  import { SURFACES } from '../lib/surfaces';
  import Infra from '../infra/Infra.svelte';

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
    <!-- NAMED FOR WHAT IT IS. `/api/health` returns the TEMPORAL NAMESPACE; calling it "tenant"
         made the install's one tenant look like a thing you could have several of, and it is the
         workspace that varies. -->
    {#if health?.namespace}<dt>temporal namespace</dt><dd class="mono">{health.namespace}</dd>{/if}
    {#if health?.version}<dt>version</dt><dd class="mono">{health.version}</dd>{/if}
  </dl>

  <h2>Surfaces</h2>
  <p class="muted">
    <!-- COUNTED FROM THE LIST, not typed beside it. This read "the seven things this console is"
         while `SURFACES` held eight — the prose and the list it introduces cannot disagree if only
         one of them is written down. -->
    The {SURFACES.length} things this console is. Each is addressable — its first path segment names
    it — and each is declared once, here and in the control plane, which is what stops a surface from
    being built, tested and unreachable.
  </p>
  <ul>
    {#each SURFACES as s (s.id)}
      <li><span class="nm">{s.label}</span><span class="b mono">/{s.id}</span></li>
    {/each}
  </ul>

  <Infra />
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
  .bad { color: var(--bad); }
</style>
