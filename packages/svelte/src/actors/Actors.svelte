<script lang="ts">
  /**
   * Actors — what is deployed, what is polling it, and what each Method takes.
   *
   * ── SERVING IS THE COLUMN THAT MATTERS ──────────────────────────────────────────────────────────
   *
   * An Actor with no poller is not broken and not missing: it is registered and nothing is serving
   * it, so a dispatch WAITS rather than failing. That is the single most common reason for a run
   * that looks hung, so it is a state with a sentence beside it, not a coloured dot.
   *
   * The contract table reuses `schemaFields` — the same derivation `/dev` draws its form from. Two
   * copies would disagree about what a Method takes, which is precisely the thing that must not
   * happen between a table describing a call and the form making it.
   */
  import { schemaFields } from '@kontra/console-core/panels/schemaTree';
  import {
    AlreadyServingError,
    fetchSources,
    serveActorSource,
    type Source,
  } from '@kontra/console-core/run/api';
  import type { JsonSchema } from '@kontra/console-core/types';

  import { servingHint, servingState, type PollerReport } from './serving';

  interface Operation { name: string; description?: string; input?: JsonSchema }
  interface ActorRow { key: string; name: string; version: string; operations?: Operation[] }

  let actors = $state<ActorRow[]>([]);
  let pollers = $state<Record<string, PollerReport>>({});
  /**
   * The workspace folders, joined to the catalog by name.
   *
   * TWO INVENTORIES, AND NEITHER IS THE OTHER'S INDEX. The catalog is what a running worker
   * registered about ITSELF — 29 entries on this install, going back months. The workspace is the
   * code on this disk right now. An Actor in the catalog with no folder here cannot be served from
   * this console (its code is somewhere else, or gone), and saying which is which is the difference
   * between "press Serve" and "go and find the code".
   */
  let folders = $state<Source[]>([]);
  let serving = $state('');
  let serveError = $state('');
  let served = $state('');
  let loading = $state(true);
  let open = $state<string | undefined>(undefined);
  const now = Date.now();

  $effect(() => {
    void (async () => {
      const [a, p, f] = await Promise.all([
        fetch('/api/actors', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch('/api/pollers', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        fetchSources('actor').then((d) => d.sources).catch(() => []),
      ]);
      actors = Array.isArray(a) ? (a as ActorRow[]) : [];
      pollers = (p ?? {}) as Record<string, PollerReport>;
      folders = f;
      open = actors[0]?.key;
      loading = false;
    })();
  });

  // The queue an actor's Method calls land on. Named here rather than guessed at each use.
  const queueOf = (a: ActorRow) => `${a.name}-${a.version}`;
  const stateOf = (a: ActorRow) => servingState(pollers[queueOf(a)], now);
  const shown = $derived(actors.find((a) => a.key === open));
  /** The workspace folder that holds this Actor's code, if one does. */
  const folderOf = (a: ActorRow): Source | undefined => folders.find((f) => f.name === a.name);

  async function serve(a: ActorRow, restart = false): Promise<void> {
    const folder = folderOf(a);
    if (!folder) return;
    serving = a.key;
    serveError = '';
    served = '';
    try {
      const result = await serveActorSource(folder.id, { restart });
      served = result.attach || result.session;
      // The poller table is what decides the state chip; re-read it rather than assuming.
      pollers = await fetch('/api/pollers', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : pollers))
        .catch(() => pollers);
    } catch (err) {
      // A WORKER IS ALREADY THERE IS A QUESTION, NOT A FAILURE — and the answer is a second press
      // that restarts it, which is why the server gives that case its own status and its own class.
      serveError =
        err instanceof AlreadyServingError
          ? `${err.message} — press Re-serve to replace it.`
          : err instanceof Error
            ? err.message
            : String(err);
    } finally {
      serving = '';
    }
  }
</script>

<section>
  <h1>Actors</h1>

  {#if loading}
    <p class="muted">reading the registry…</p>
  {:else if actors.length === 0}
    <p class="muted">
      No actor is serving. <code class="mono">kontra serve --actor &lt;dir&gt; --watch</code>
      publishes one and its contract.
    </p>
  {:else}
    <ul class="grid">
      {#each actors as a (a.key)}
        {@const s = stateOf(a)}
        <li>
          <button class:open={open === a.key} onclick={() => (open = a.key)}>
            <span class="nm mono">{a.name}</span>
            <span class="ver mono">{a.version}</span>
            <span class="state {s}">{s === 'idle' ? 'no poller' : s}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if shown}
      {@const s = stateOf(shown)}
      <div class="detail">
        <h2 class="mono">{shown.name}@{shown.version}</h2>
        <p class="hint {s}">{servingHint(s)}</p>

        <div class="acts">
          {#if folderOf(shown)}
            {@const folder = folderOf(shown)!}
            <button
              data-testid="serve-actor"
              disabled={serving === shown.key}
              onclick={() => void serve(shown, s === 'serving')}
            >
              {#if serving === shown.key}serving…{:else if s === 'serving'}Re-serve{:else}Serve{/if}
            </button>
            <span class="where mono" title={folder.path}>{folder.path}</span>
          {:else}
            <!-- NOT IN THE WORKSPACE. The catalog remembers Actors a worker registered from
                 anywhere; this console can only serve code it can see. -->
            <span class="where">
              no folder for <b>{shown.name}</b> in the workspace — this entry is what a worker
              registered, and the code is not here to serve.
            </span>
          {/if}
        </div>
        {#if serveError}<p class="err" role="alert">{serveError}</p>{/if}
        {#if served}
          <p class="muted">worker started — <code class="mono">{served}</code>, and its pane is on the Monitor.</p>
        {/if}

        {#each shown.operations ?? [] as op (op.name)}
          {@const fields = schemaFields(op.input) ?? []}
          <div class="op">
            <h3 class="mono">{op.name}</h3>
            {#if op.description}<p class="muted">{op.description}</p>{/if}
            {#if fields.length === 0}
              <p class="muted">Takes no input.</p>
            {:else}
              <ul class="fields">
                {#each fields as f (f.path)}
                  <li>
                    <span class="fname mono">{f.name}</span>
                    {#if f.required}<span class="req">required</span>{/if}
                    <span class="ftype">{f.enum ? f.enum.join(' | ') : f.type}</span>
                    <span class="fctl">{f.control ?? 'text'}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            <a class="call" href="/dev?actor={encodeURIComponent(shown.name)}&method={encodeURIComponent(op.name)}">
              call {op.name} →
            </a>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  .acts { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  .acts button {
    font-size: var(--t-small); padding: var(--s-1) var(--s-3); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); cursor: pointer;
  }
  .acts button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  .where { font-size: var(--t-small); color: var(--dim); overflow-wrap: anywhere; }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); overflow-wrap: anywhere; line-height: var(--lh-body); }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  h2 { font-size: var(--t-lead); font-weight: 600; margin: 0 0 var(--s-1); overflow-wrap: anywhere; }
  h3 { font-size: var(--t-body); font-weight: 600; margin: 0 0 var(--s-1); }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }

  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: var(--s-2); }
  .grid button {
    width: 100%; display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; text-align: left;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); color: var(--fg); cursor: pointer;
  }
  .grid button.open { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .nm { font-size: var(--t-small); }
  .ver { font-size: var(--t-micro); color: var(--dim); }

  .state {
    margin-left: auto; font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim);
  }
  .state.serving { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
  .state.idle { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .state.unknown { color: var(--dim); border-style: dashed; }

  .detail { border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); padding: var(--s-3); }
  .hint { font-size: var(--t-small); margin: 0 0 var(--s-3); color: var(--dim); }
  .hint.serving { color: var(--ok); }
  .hint.idle { color: var(--warn); }
  .op { border-top: 1px solid var(--line); padding-top: var(--s-3); margin-top: var(--s-3); }
  .op:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }

  .fields { list-style: none; margin: var(--s-2) 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  .fields li { display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap; font-size: var(--t-small); }
  .fname { color: var(--fg); }
  .req { font-size: var(--t-micro); color: var(--warn); }
  .ftype { color: var(--dim); }
  .fctl { font-size: var(--t-micro); font-family: var(--mono); color: var(--accent); background: var(--track); padding: 1px 6px; border-radius: 3px; }
  .call { font-size: var(--t-small); color: var(--accent); text-decoration: none; }
  code { font-size: var(--t-small); }

  @media (min-width: 720px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .state { margin-left: 0; }
  }
</style>
