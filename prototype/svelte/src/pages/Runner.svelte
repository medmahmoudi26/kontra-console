<script>
  /**
   * The Runner: a Method's form, derived from its schema, plus what the call would send.
   *
   * THE FORM IS NOT AUTHORED. Every control below is chosen from the JSON Schema the served Actor
   * published — `enum` is a dropdown, `boolean` a three-state toggle, `x-kontra-input` a drop zone.
   * Add a field to the Method and it appears here; there is no second place to edit.
   *
   * `not set` IS A THIRD STATE and the reason the toggle is not a checkbox. Leaving an optional
   * boolean alone omits the key, so the AUTHOR's default applies — which is a different outcome
   * from sending `false`, and a checkbox cannot express it.
   */
  import { app } from '../lib/model.svelte.js';

  let actorKey = $state(app.actors[0].key);
  const actor = $derived(app.actors.find((a) => a.key === actorKey));
  const op = $derived(actor.operations[0]);

  let values = $state({});
  let dropped = $state({});

  // Reset the form when the Actor changes — carrying `host` over to a Method with no `host` is how
  // a form sends a field the Method will reject.
  $effect(() => { actorKey; values = {}; dropped = {}; });

  function control(f) {
    if (f['x-kontra-input'] === 'file') return 'file';
    if (f['x-kontra-input'] === 'folder') return 'folder';
    if (f.enum) return 'select';
    if (f.type === 'boolean') return 'toggle';
    return 'text';
  }

  // THE CYCLE, WRITTEN AS A CYCLE. Nested ternaries here once skipped `false` entirely.
  function cycle(k, required) {
    const v = values[k];
    if (v === true) { values[k] = false; return; }
    if (v === false) { values[k] = required ? true : undefined; return; }
    values[k] = true;
  }

  const payload = $derived.by(() => {
    const out = {};
    for (const [k, f] of Object.entries(op.input.properties)) {
      const c = control(f);
      if (c === 'file' || c === 'folder') {
        if (dropped[k]) out[k] = dropped[k];
      } else if (values[k] !== undefined && values[k] !== '') {
        out[k] = values[k];
      }
    }
    return out;
  });

  const missing = $derived((op.input.required ?? []).filter((k) => payload[k] === undefined));

  function drop(k, kind) {
    // A real drop uploads to /api/uploads and keeps the ref. The SHAPE is the point: what rides in
    // the workflow argument is ~100 bytes, never the bytes.
    dropped[k] = kind === 'folder'
      ? { files: [{ name: 'a.txt', sha256: '9f86d0818…', size: 1204, path: 'corpus/a.txt' },
                   { name: 'b.txt', sha256: 'b1946ac92…', size: 880, path: 'corpus/b.txt' }] }
      : { name: 'wordlist.txt', sha256: '2c26b46b68…', size: 41203 };
  }
</script>

<section class="page">
  <h2>Runner</h2>

  <div class="pick">
    {#each app.actors as a (a.key)}
      <button class:on={actorKey === a.key} onclick={() => (actorKey = a.key)}>
        {a.name}<span class="dim">.{a.operations[0].name}</span>
      </button>
    {/each}
  </div>

  <div class="split">
    <div class="card">
      <h3>{actor.name}.{op.name}</h3>
      {#if !actor.pollers}
        <p class="warn">No poller on this Actor's queue. A call would be accepted and then wait.</p>
      {/if}

      <div class="form">
        {#each Object.entries(op.input.properties) as [k, f] (k)}
          {@const c = control(f)}
          {@const req = op.input.required?.includes(k)}
          <label class="field">
            <span class="lbl">{f.title ?? k}{#if req}<i>*</i>{/if}</span>

            {#if c === 'select'}
              <select bind:value={values[k]}>
                <option value={undefined}>— {f.default ?? 'choose'} —</option>
                {#each f.enum as o}<option value={o}>{o}</option>{/each}
              </select>

            {:else if c === 'toggle'}
              <button type="button" class="toggle" role="switch"
                      aria-checked={values[k] === true}
                      onclick={() => cycle(k, req)}>
                <span class="knob" class:on={values[k] === true} class:off={values[k] === false}></span>
                <span class="state">
                  {values[k] === true ? 'true' : values[k] === false ? 'false' : 'not set'}
                </span>
              </button>

            {:else if c === 'file' || c === 'folder'}
              <button type="button" class="drop" class:filled={dropped[k]} onclick={() => drop(k, c)}>
                {#if dropped[k]}
                  {#if c === 'folder'}
                    <b>{dropped[k].files.length} files</b>
                    <span class="dim mono">{dropped[k].files[0].sha256}…</span>
                  {:else}
                    <b>{dropped[k].name}</b>
                    <span class="dim mono">{dropped[k].sha256} · {dropped[k].size} B</span>
                  {/if}
                {:else}
                  drop a {c} — or choose
                {/if}
              </button>

            {:else}
              <input type="text" bind:value={values[k]} placeholder={f.default ?? ''} />
            {/if}
          </label>
        {/each}
      </div>

      <div class="actions">
        <button class="go" disabled={missing.length > 0}>
          {missing.length ? `${missing.join(', ')} required` : `call ${op.name}`}
        </button>
      </div>
    </div>

    <div class="card">
      <h3>What gets sent</h3>
      <pre>{JSON.stringify({ actor: actor.name, version: actor.version, method: op.name, units: [payload] }, null, 2)}</pre>
      <p class="note">
        One Unit per row. A dropped file rides as <span class="mono">{'{name, sha256, size}'}</span> —
        the bytes went to the object store before the run started, because a Method's input is a
        workflow argument and a workflow argument is replayed on every worker that picks the run up.
      </p>
    </div>
  </div>
</section>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; }
  h2 { font-size: 15px; margin: 0; font-weight: 600; }
  h3 { font-size: 12px; margin: 0 0 12px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
  .pick { display: flex; gap: 6px; flex-wrap: wrap; }
  .pick button { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--line);
                 background: var(--panel); color: var(--fg); cursor: pointer; font-family: var(--mono); }
  .pick button.on { border-color: color-mix(in srgb, var(--blue) 50%, transparent); color: var(--blue); }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  @media (max-width: 860px) { .split { grid-template-columns: 1fr; } }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--panel); }
  .form { display: flex; flex-direction: column; gap: 12px; }
  .field { display: grid; grid-template-columns: 130px 1fr; align-items: center; gap: 12px; }
  .lbl { font-size: 12px; color: var(--dim); font-family: var(--mono); }
  .lbl i { color: var(--amber); font-style: normal; margin-left: 3px; }
  input, select { background: var(--track); border: 1px solid var(--line); border-radius: 5px;
                  color: var(--fg); padding: 5px 8px; font-size: 12px; font-family: inherit; width: 100%; }
  .toggle { display: flex; align-items: center; gap: 9px; background: none; border: 0; cursor: pointer; padding: 0; }
  .knob { width: 30px; height: 17px; border-radius: 999px; background: var(--track); border: 1px solid var(--line);
          position: relative; transition: background 120ms; }
  .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%;
                 background: var(--dim); transition: transform 120ms, background 120ms; }
  .knob.on { background: color-mix(in srgb, var(--green) 35%, transparent); }
  .knob.on::after { transform: translateX(13px); background: var(--green); }
  .knob.off::after { background: var(--red); }
  .state { font-size: 11px; color: var(--dim); font-family: var(--mono); }
  .drop { width: 100%; border: 1px dashed var(--line); border-radius: 6px; background: var(--track);
          padding: 9px; font-size: 11px; color: var(--dim); cursor: pointer; display: flex; gap: 8px;
          align-items: baseline; justify-content: center; }
  .drop.filled { border-style: solid; border-color: color-mix(in srgb, var(--green) 40%, transparent); color: var(--fg); }
  .actions { margin-top: 16px; }
  .go { font-size: 12px; padding: 7px 16px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--blue) 50%, transparent);
        background: color-mix(in srgb, var(--blue) 18%, transparent); color: var(--blue); cursor: pointer; }
  .go:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  .warn { font-size: 11px; color: var(--amber); margin: 0 0 12px; }
  pre { margin: 0; font-size: 11px; font-family: var(--mono); color: var(--fg); background: var(--track);
        border-radius: 6px; padding: 12px; overflow-x: auto; line-height: 1.55; }
  .note { font-size: 11px; color: var(--dim); line-height: 1.55; margin: 12px 0 0; }
  .mono { font-family: var(--mono); }
  .dim { color: var(--dim); }

  /* ── PHONE ────────────────────────────────────────────────────────────────────────────────
     A 130px label gutter left ~200px for the input. Stacked, the control gets the full width —
     which matters most for the drop zones, whose whole job is being a target. */
  @media (max-width: 560px) {
    .field { grid-template-columns: 1fr; gap: 5px; }
    .card { padding: 12px; }
    .pick button { flex: 1 1 auto; }
    pre { font-size: 10px; }
  }
  .card { min-width: 0; }
  pre { max-width: 100%; }
</style>
