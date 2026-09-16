<script lang="ts">
  /**
   * Secrets — the names this control plane holds, and nothing else.
   *
   * ── A VALUE NEVER COMES BACK, AND NOTHING HERE SUGGESTS IT COULD ────────────────────────────────
   *
   * `GET /api/secrets/:name` answers the name, the versions and which is current. There is no
   * endpoint that returns a value and there must not be a control implying one: no reveal, no masked
   * field holding a placeholder, no copy button for something the API never sent.
   *
   * A masked field that holds `••••••••` and is not a secret is worse than an empty one. It teaches
   * that the value is here and recoverable, which is the belief that leads somebody to stop
   * recording it somewhere it actually is.
   *
   * ── CREATING A NAME THAT EXISTS ROTATES IT, AND SAYS SO ─────────────────────────────────────────
   *
   * The API answers `rotated: true`. A UI that silently replaced would hide a destructive act behind
   * a create button; one that silently failed would leave somebody believing they had updated a
   * credential they had not.
   */
  interface Version { version: number; createdAt: number }
  interface Secret { name: string; createdAt: number; updatedAt: number; versions: Version[]; current: number }

  let secrets = $state<Secret[]>([]);
  let backend = $state('');
  let loading = $state(true);
  let error = $state('');

  let name = $state('');
  let value = $state('');
  let busy = $state(false);
  let said = $state('');

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/secrets', { credentials: 'same-origin' });
      if (!res.ok) {
        error = res.status === 503
          ? 'the secret store is disabled on this installation'
          : `could not read secrets: HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { backend?: string; secrets?: Secret[] };
      secrets = body.secrets ?? [];
      backend = body.backend ?? '';
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  async function put(): Promise<void> {
    busy = true;
    said = '';
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        said = `not stored: HTTP ${res.status}`;
        return;
      }
      const body = (await res.json()) as { rotated?: boolean; version?: number };
      // NAMED EITHER WAY. "Saved" over a rotation hides that an existing credential was replaced.
      said = body.rotated
        ? `${name} rotated to version ${body.version}`
        : `${name} stored as version ${body.version}`;
      value = '';
      await load();
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>Secrets</h1>
  <p class="muted">
    A value is written and never read back. What is stored here is what a workflow names — a Fleet
    spends <code class="mono">credential="do-prod"</code>, never a token — so the value reaches the
    converge without entering a run's arguments or its history.
  </p>

  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if loading}
    <p class="muted">reading…</p>
  {:else}
    {#if backend}<p class="muted">store: <span class="mono">{backend}</span></p>{/if}
    {#if secrets.length === 0}
      <p class="muted">No secrets yet.</p>
    {:else}
      <ul>
        {#each secrets as s (s.name)}
          <li>
            <span class="nm mono">{s.name}</span>
            <span class="vers">v{s.current} of {s.versions.length}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); void put(); }}>
      <h2>Store or rotate</h2>
      <label><span>name</span><input bind:value={name} placeholder="do-prod" required /></label>
      <label>
        <span>value</span>
        <!-- `password` so a shoulder cannot read it, and never populated: this field is WRITE-ONLY
             because the API has nothing to put in it. -->
        <input type="password" bind:value autocomplete="off" placeholder="written once, never shown again" required />
      </label>
      <button disabled={busy || !name || !value}>{busy ? 'storing…' : 'store'}</button>
      {#if said}<p class="said" role="status">{said}</p>{/if}
    </form>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  h2 { font-size: var(--t-body); font-weight: 600; margin: 0 0 var(--s-2); }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0; padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  ul li {
    display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
  }
  .nm { font-size: var(--t-small); overflow-wrap: anywhere; }
  .vers { font-size: var(--t-micro); color: var(--dim); margin-left: auto; }
  form {
    display: flex; flex-direction: column; gap: var(--s-2);
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); padding: var(--s-3);
  }
  label { display: grid; gap: var(--s-1); }
  label span { font-size: var(--t-small); color: var(--dim); font-family: var(--mono); }
  input {
    width: 100%; background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-1) var(--s-2); font-size: var(--t-small);
  }
  form button {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); cursor: pointer;
  }
  form button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  .said { font-size: var(--t-small); color: var(--ok); margin: 0; }
  code { font-size: var(--t-small); }
</style>
