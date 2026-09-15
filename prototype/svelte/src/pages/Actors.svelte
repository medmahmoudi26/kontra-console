<script>
  /**
   * The Actors surface: what is deployed, what is polling, and what each Method takes.
   *
   * POLLERS ARE THE COLUMN THAT MATTERS. An Actor with no poller is not broken and not missing —
   * it is registered and nothing is serving it, so a dispatch waits. That distinction is the one
   * the Runner page depends on, which is why it is a first-class column and not a health dot.
   */
  import { app } from '../lib/model.svelte.js';

  let open = $state(app.actors[0].key);

  // The control a field earns from its declared type — the same rule the real console applies.
  function control(f) {
    if (f['x-kontra-input'] === 'file') return 'file';
    if (f['x-kontra-input'] === 'folder') return 'folder';
    if (f.enum) return 'select';
    if (f.type === 'boolean') return 'toggle';
    return 'text';
  }
</script>

<section class="page">
  <h2>Actors</h2>

  <div class="grid">
    {#each app.actors as a (a.key)}
      <button class="card" class:open={open === a.key} onclick={() => (open = a.key)}>
        <div class="top">
          <span class="nm">{a.name}</span>
          <span class="ver">{a.version}</span>
        </div>
        <div class="meta">
          {#if a.pollers}
            <span class="pill ok">{a.pollers} poller{a.pollers > 1 ? 's' : ''}</span>
          {:else}
            <span class="pill off">no poller</span>
          {/if}
          <span class="dim">{a.operations.length} method{a.operations.length > 1 ? 's' : ''}</span>
        </div>
      </button>
    {/each}
  </div>

  {#each app.actors.filter((a) => a.key === open) as a (a.key)}
    <div class="detail">
      <h3>{a.name}@{a.version}</h3>
      {#each a.operations as op (op.name)}
        <div class="op">
          <div class="opname"><b>{op.name}</b><span class="dim">{op.description}</span></div>
          <table>
            <thead><tr><th>field</th><th>type</th><th>control</th><th>default</th></tr></thead>
            <tbody>
              {#each Object.entries(op.input.properties) as [k, f] (k)}
                <tr>
                  <td>
                    <span class="mono">{k}</span>
                    {#if op.input.required?.includes(k)}<span class="req">required</span>{/if}
                  </td>
                  <td class="dim">{f.enum ? f.enum.join(' | ') : f['x-kontra-input'] ?? f.type}</td>
                  <td><span class="ctl {control(f)}">{control(f)}</span></td>
                  <td class="dim mono">{f.default === undefined ? '—' : String(f.default)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
      <p class="note">
        Nothing here is configured. The control comes from the declared type — <span class="mono">Literal</span>
        becomes a dropdown, <span class="mono">bool</span> a toggle, <span class="mono">File</span> and
        <span class="mono">Folder</span> a drop zone — so the form cannot drift from the Method.
      </p>
    </div>
  {/each}
</section>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; }
  h2 { font-size: 15px; margin: 0; font-weight: 600; }
  h3 { font-size: 13px; margin: 0 0 12px; font-family: var(--mono); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .card { text-align: left; border: 1px solid var(--line); border-radius: 8px; padding: 12px;
          background: var(--panel); cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
  .card.open { border-color: color-mix(in srgb, var(--blue) 50%, transparent);
               box-shadow: 0 0 0 1px color-mix(in srgb, var(--blue) 25%, transparent); }
  .top { display: flex; justify-content: space-between; align-items: baseline; }
  .nm { font-family: var(--mono); font-size: 13px; color: var(--fg); }
  .ver { font-size: 11px; color: var(--dim); }
  .meta { display: flex; gap: 8px; align-items: center; font-size: 11px; }
  .detail { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--panel); min-width: 0; }
  @media (max-width: 560px) { .detail { padding: 12px; } .grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); } }
  .op { margin-bottom: 8px; }
  .opname { display: flex; gap: 10px; align-items: baseline; margin-bottom: 10px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-weight: 500; color: var(--dim); font-size: 10px; text-transform: uppercase;
       letter-spacing: .05em; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  td { padding: 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent); }
  .mono { font-family: var(--mono); }
  .dim { color: var(--dim); }
  .req { font-size: 9px; color: var(--amber); margin-left: 6px; }
  .pill { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); }
  .pill.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 40%, transparent); }
  .pill.off { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 35%, transparent); }
  .ctl { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: var(--track); color: var(--dim); font-family: var(--mono); }
  .ctl.select, .ctl.toggle { color: var(--blue); }
  .ctl.file, .ctl.folder { color: var(--green); }
  .note { font-size: 11px; color: var(--dim); line-height: 1.55; margin: 12px 0 0; }
</style>
