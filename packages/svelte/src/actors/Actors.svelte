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
  /**
   * WHAT THE DETAIL PANEL IS ABOUT — a folder, or a registration, with one shape either way.
   *
   * A workspace row is a FOLDER, and it may have no catalog entry at all (nothing has served it);
   * a catalog row has no folder. Resolving both to `{key, actor, folder?}` here is what keeps the
   * panel from branching on which list was clicked.
   */
  const detail = $derived.by(() => {
    const row = inWorkspace.find((r) => r.key === open);
    if (row) {
      return {
        key: row.key,
        folder: row.folder,
        actor: row.entry ?? {
          key: row.key,
          name: row.folder.name,
          version: row.folder.version,
          // `undefined`, NOT `[]`: "nobody has published a contract" and "this Method takes
          // nothing" are different facts and the panel says different things about them.
          operations: undefined,
        },
      };
    }
    const a = actors.find((x) => x.key === open);
    return a ? { key: a.key, folder: folderOf(a), actor: a } : undefined;
  });
  /** The workspace folder that holds this Actor's code, if one does. */
  const folderOf = (a: ActorRow): Source | undefined => folders.find((f) => f.name === a.name);

  /**
   * THE WORKSPACE SIDE IS ONE ROW PER FOLDER — not one per registration.
   *
   * This filtered the CATALOG by "has a folder with this name", and the catalog holds every version
   * a worker ever registered: four `desync` rows — 0.1.0, 0.2.1, 0.2.2, 1.0.0 — all matched the one
   * folder on disk, so the workspace section listed four actors where there is one, each with its
   * own Serve button, all of which would serve the same directory. The operator's words: "there are
   * 3 desync actors showing while there is only one in the code".
   *
   * The folder is the thing you can act on, so the folder is the row. Its version comes from its
   * own manifest, which is what a Serve would actually publish.
   */
  interface WorkspaceRow {
    folder: Source;
    /** The catalog entry for exactly this name AND version, when a worker has registered it. */
    entry?: ActorRow;
    key: string;
  }
  const inWorkspace = $derived<WorkspaceRow[]>(
    folders.map((f) => ({
      folder: f,
      entry: actors.find((a) => a.name === f.name && a.version === f.version),
      key: `folder:${f.id}`,
    }))
  );

  /**
   * Everything the catalog knows that this workspace cannot serve — including OTHER VERSIONS of an
   * Actor whose code is here. `desync@0.2.1` is not the folder's `1.0.0`: it is what some worker
   * registered from code that is not in front of you, and pretending the folder can serve it would
   * be the same conflation in the other direction.
   */
  const elsewhere = $derived(
    actors.filter((a) => !folders.some((f) => f.name === a.name && f.version === a.version))
  );

  /**
   * THE CATALOG SIDE, COLLAPSED BY NAME — one row per Actor, its versions beside it.
   *
   * The catalog keeps every version anybody ever registered: six `cachebuster` rows, three
   * `crawl4ai`, three older `desync`. Listed flat they read as twenty-five different Actors, which
   * is the same confusion that made the workspace side look like it held four `desync`s. One row
   * per name says what is actually true — one Actor, several registrations — and the versions stay
   * visible because "which one is on the fleet" is a real question.
   */
  const elsewhereByName = $derived.by(() => {
    const by = new Map<string, ActorRow[]>();
    for (const a of elsewhere) by.set(a.name, [...(by.get(a.name) ?? []), a]);
    return [...by.entries()]
      .map(([name, rows]) => ({
        name,
        // Newest first: the version anybody is asking about is the last one registered.
        rows: [...rows].sort((x, y) => y.version.localeCompare(x.version, undefined, { numeric: true })),
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  });

  /** Serve a WORKSPACE ROW — the folder is the thing that gets served. */
  async function serveFolder(row: WorkspaceRow, restart = false): Promise<void> {
    // PRESSING SERVE OPENS THAT ROW. The outcome — the session name, or the server's refusal — is
    // drawn in the detail panel, and it appeared under whichever actor happened to be open:
    // `worker started` under `bbscope` for a worker started for `redditapi`.
    open = row.key;
    await serveSource(row.folder, row.key, restart);
  }

  async function serveSource(folder: Source, key: string, restart = false): Promise<void> {
    serving = key;
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
    {#if inWorkspace.length > 0}
      <h2 class="group">in this workspace</h2>
      <ul class="grid">
        {#each inWorkspace as row (row.key)}
          {@const a = row.entry ?? { key: row.key, name: row.folder.name, version: row.folder.version }}
          {@const s = stateOf(a)}
          <li>
            <button class:open={open === row.key} onclick={() => (open = row.key)}>
              <span class="nm mono">{row.folder.name}</span>
              <span class="ver mono">{row.folder.version || 'no version'}</span>
              <span class="state {s}">{s === 'idle' ? 'no poller' : s}</span>
            </button>
            <!-- THE BUTTON IS ON THE ROW, not behind a click. An Actor nothing is polling is the
                 single most common reason a call sits there, and the fix is one press. -->
            <button
              class="serve"
              data-testid="serve-actor-{row.folder.name}"
              disabled={serving === row.key}
              onclick={() => void serveFolder(row, s === 'serving')}
            >
              {#if serving === row.key}…{:else if s === 'serving'}re-serve{:else}serve{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if elsewhere.length > 0}
      <h2 class="group">
        not in this workspace
        <span class="why">
          registered by a worker from somewhere else — their code is not here to serve
        </span>
      </h2>
      <ul class="grid quiet">
        {#each elsewhereByName as group (group.name)}
          <!-- NOT A BUTTON WRAPPING BUTTONS. The versions are the actions here, and a nested button
               is invalid markup whose inner control stops receiving clicks in some browsers — so
               the row is a plain box and every version is its own button. -->
          <li class="card" class:open={group.rows.some((r) => r.key === open)}>
            <span class="nm mono">{group.name}</span>
            <span class="vers">
              {#each group.rows as r (r.key)}
                <button class="ver mono" class:on={open === r.key} onclick={() => (open = r.key)}>
                  {r.version}
                </button>
              {/each}
            </span>
            <span class="state {stateOf(group.rows[0]!)}">
              {stateOf(group.rows[0]!) === 'idle' ? 'no poller' : stateOf(group.rows[0]!)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if detail}
      {@const s = stateOf(detail.actor)}
      <div class="detail">
        <h2 class="mono">{detail.actor.name}@{detail.actor.version}</h2>
        <p class="hint {s}">{servingHint(s)}</p>

        <div class="acts">
          {#if detail.folder}
            {@const folder = detail.folder}
            <button
              data-testid="serve-actor"
              disabled={serving === detail.key}
              onclick={() => void serveSource(folder, detail.key, s === 'serving')}
            >
              {#if serving === detail.key}serving…{:else if s === 'serving'}Re-serve{:else}Serve{/if}
            </button>
            <span class="where mono" title={folder.path}>{folder.path}</span>
          {:else}
            <!-- NOT IN THE WORKSPACE. The catalog remembers Actors a worker registered from
                 anywhere — including OTHER VERSIONS of one whose code is here — and this console
                 can only serve the code it can see. -->
            <span class="where">
              no folder for <b>{detail.actor.name}@{detail.actor.version}</b> in the workspace —
              this entry is what a worker registered, and that code is not here to serve.
            </span>
          {/if}
        </div>
        {#if serveError}<p class="err" role="alert">{serveError}</p>{/if}
        {#if served}
          <p class="muted">worker started — <code class="mono">{served}</code>, and its pane is on the Monitor.</p>
        {/if}

        {#if detail.actor.operations === undefined}
          <!-- A FOLDER NOBODY HAS SERVED HAS NO PUBLISHED CONTRACT. The methods come from a running
               worker, not from the directory — so this says which state it is in rather than
               drawing an empty method list. -->
          <p class="muted">
            Nothing has served <code class="mono">{detail.actor.name}@{detail.actor.version}</code>
            yet, so it has published no Methods. Press Serve and they appear here.
          </p>
        {/if}
        {#each detail.actor.operations ?? [] as op (op.name)}
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
            <a class="call" href="/dev?actor={encodeURIComponent(detail.actor.name)}&method={encodeURIComponent(op.name)}">
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
  .group {
    font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--dim); font-weight: 600; margin: var(--s-2) 0 0;
    display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap;
  }
  .group .why { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .grid.quiet li button { opacity: 0.72; }
  .grid li.card {
    display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); opacity: 0.72;
  }
  .grid li.card.open { opacity: 1; border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .vers { display: inline-flex; gap: 4px; flex-wrap: wrap; min-width: 0; }
  /* SPECIFIC ENOUGH TO WIN. `.grid button:not(.serve) { width: 100% }` has the same specificity and
     comes later in this sheet, so the chips rendered as a stack of full-width blocks — which is
     why one `cachebuster` card was six rows tall. */
  .grid li.card .vers button.ver {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--dim); font-size: var(--t-micro); padding: 0 4px; cursor: pointer; width: auto;
  }
  .vers button.ver.on { color: var(--fg); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  /* ONE ROW PER ACTOR: the card, then its action. The card grows; the button is as wide as its
     word. Both are buttons, so the card styling below has to exclude the second one — without
     that, `width: 100%` made `serve` a full-size card of its own and the list read as twice as
     many actors. */
  .grid li { display: flex; align-items: stretch; gap: var(--s-1); min-width: 0; }
  .grid li > button:not(.serve) { flex: 1; min-width: 0; }
  .serve {
    font-size: var(--t-micro); padding: 0 var(--s-2); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent);
    cursor: pointer; white-space: nowrap;
  }
  .serve:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
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
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1200px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .grid button:not(.serve) {
    width: 100%; display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; text-align: left;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3); color: var(--fg); cursor: pointer;
  }
  .grid button:not(.serve).open { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
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
