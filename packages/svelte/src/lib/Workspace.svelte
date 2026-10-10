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
   * ── THE CHOICE IS THIS TAB'S, AND THE SERVER CHECKS IT ─────────────────────────────────────────
   *
   * Every API request names the picked workspace (`x-kontra-workspace`, kontra ADR 0070), and the
   * server answers from that workspace's own namespace and stores, after checking this session is a
   * member of it. So two tabs can look at two workspaces. It is not a client-side filter: the
   * server never returns another workspace's rows to filter.
   *
   * A member of every workspace also moves the install's default (`PUT /api/workspaces/current`),
   * which is what the CLI and code discovery read. A session scoped to some workspaces is refused
   * that (403), and its choice stays this tab's.
   *
   * ── IT SAYS THE PATH ────────────────────────────────────────────────────────────────────────────
   *
   * The mount is a directory the operator can open in their editor, and the most common question
   * about it is "where is it". The title carries the answer rather than making them go and look.
   */
  import { onMount } from 'svelte';

  import { selectWorkspace, selectedWorkspace } from '@kontra/console-core/run/session';

  import { readWorkspaces, type Workspaces } from './workspaces';

  let ws = $state<Workspaces | undefined>(undefined);
  let busy = $state(false);
  let error = $state('');

  async function read(): Promise<void> {
    try {
      const res = await fetch('/api/workspaces', { credentials: 'same-origin' });
      ws = res.ok ? readWorkspaces(await res.json()) : undefined;
      if (ws) {
        // THIS TAB'S CHOICE WINS while it is still a workspace this session may see; otherwise the
        // server's answer, which is the install default or the session's first workspace.
        const mine = selectedWorkspace();
        if (mine && ws.names.includes(mine)) ws = { ...ws, current: mine };
        else selectWorkspace(ws.current);
      }
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
      // 403 IS A SCOPED SESSION, which may look at the workspace but not move the install's
      // default. Anything else that failed is a real error and the choice is not kept.
      if (!res.ok && res.status !== 403) {
        error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
        return;
      }
      selectWorkspace(name);
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
