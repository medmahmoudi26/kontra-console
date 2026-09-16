<script lang="ts">
  /**
   * Which workspace this console is looking at, and the switch between them.
   *
   * ── THE WORKSPACE IS WHERE YOUR CODE IS ─────────────────────────────────────────────────────────
   *
   * A folder under `<workspace>/actors/` or `<workspace>/workflows/` is what this control plane
   * serves — there is no registration beside it. So "which workspace" is the single most
   * consequential piece of context on screen: it decides what every surface below lists.
   *
   * ── SWITCHING IS A SERVER FACT, NOT A CLIENT ONE ────────────────────────────────────────────────
   *
   * `.current` in the workspace parent is what discovery reads, so switching writes that file
   * (`PUT /api/workspaces/current`) and everything re-reads. It is deliberately not a client-side
   * filter: a worker serving code from the old workspace is still serving it, and a console that
   * pretended otherwise would show an inventory nothing agrees with.
   *
   * ── IT SAYS THE PATH ────────────────────────────────────────────────────────────────────────────
   *
   * The mount is a directory the operator can open in their editor, and the most common question
   * about it is "where is it". The title carries the answer rather than making them go and look.
   */
  import { onMount } from 'svelte';

  interface Workspaces {
    parent: string;
    current: string;
    names: string[];
    currentPath: string;
    mountHint: string;
  }

  let ws = $state<Workspaces | undefined>(undefined);
  let busy = $state(false);
  let error = $state('');

  async function read(): Promise<void> {
    try {
      const res = await fetch('/api/workspaces', { credentials: 'same-origin' });
      ws = res.ok ? ((await res.json()) as Workspaces) : undefined;
    } catch {
      ws = undefined;
    }
  }

  onMount(read);

  async function pick(name: string): Promise<void> {
    if (!ws || name === ws.current) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/workspaces/current', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
        return;
      }
      ws = (await res.json()) as Workspaces;
      /**
       * A FULL RELOAD, ON PURPOSE. Every surface derives from the workspace — the actor list, the
       * workflow folders, the forms built from their contracts — and re-fetching them piecemeal
       * would leave whichever ones were open showing the previous workspace's code until touched.
       * Switching is rare and a reload is the honest way to say "everything below changed".
       */
      location.reload();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if ws && ws.names.length > 0}
  <label class="ws" title={ws.currentPath || ws.parent}>
    <span class="lbl">workspace</span>
    <select
      data-testid="workspace-picker"
      disabled={busy}
      value={ws.current}
      onchange={(e) => void pick(e.currentTarget.value)}
    >
      {#each ws.names as name (name)}<option value={name}>{name}</option>{/each}
    </select>
  </label>
  {#if error}<span class="err" role="alert">{error}</span>{/if}
{:else if ws}
  <!-- NO WORKSPACE IS A STATE WITH A FIX, and the server's own sentence carries it: the mount hint
       names the directory to create. Saying nothing here would leave an empty console with no
       explanation for why every surface is empty. -->
  <span class="none" title={ws.mountHint}>no workspace</span>
{/if}

<style>
  .ws { display: inline-flex; align-items: center; gap: var(--s-1); min-width: 0; }
  .lbl { font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
  select {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: 2px var(--s-1); font-size: var(--t-small); font-family: var(--mono);
    max-width: 14ch;
  }
  select:disabled { color: var(--dim); }
  .none { font-size: var(--t-micro); color: var(--warn); }
  .err { font-size: var(--t-micro); color: var(--bad); }
</style>
