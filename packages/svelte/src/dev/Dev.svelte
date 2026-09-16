<script lang="ts">
  /**
   * `/dev` — the IDE embed. A Method's form, and what the call would send.
   *
   * ── NO CHROME, BECAUSE SOMETHING ELSE OWNS IT ───────────────────────────────────────────────────
   *
   * This renders inside a VS Code webview at ~400px. It has no navigation: the editor decides what
   * is on screen, and a nav bar here would be a second one competing with the tab strip above it.
   * That is what `CONTEXT.md` means by an Embed — the same console, addressed straight at the thing
   * it is showing.
   *
   * ── THE FORM IS DERIVED, ALL OF IT ──────────────────────────────────────────────────────────────
   *
   * `schemaFields` from `@kontra/console-core` turns the Method's published schema into nodes with a
   * `control` each; `Field.svelte` draws whatever that says. Add a field to the Method and it
   * appears here. There is no list of fields in this file, which is the point.
   */
  import { schemaFields, type FieldNode } from '@kontra/console-core/panels/schemaTree';
  import type { JsonSchema } from '@kontra/console-core/types';

  import Field from './Field.svelte';
  import { missing, payloadOf, type FieldValue } from './payload';

  interface Props {
    actor: string;
    version: string;
    method: string;
    schema: JsonSchema | undefined;
    /** Absent while the contract is being fetched; `null` once it is known there is none. */
    loading?: boolean;
  }
  let { actor, version, method, schema, loading = false }: Props = $props();

  const nodes = $derived(schemaFields(schema) ?? []);
  const leaves = $derived(nodes.filter((n): n is FieldNode => n.kind === 'leaf'));

  let values = $state<Record<string, FieldValue>>({});

  // A CONTRACT CHANGE MUST NOT WIPE WHAT SOMEBODY IS TYPING. Only keys the new schema no longer has
  // are dropped; everything still declared keeps its value. Slice 05 makes this happen live, and
  // without this that would clear the form on every save.
  $effect(() => {
    const declared = new Set(leaves.map((n) => n.name));
    for (const k of Object.keys(values)) if (!declared.has(k)) delete values[k];
  });

  const payload = $derived(payloadOf(values));
  const required = $derived(leaves.filter((n) => n.required).map((n) => n.name));
  const gaps = $derived(missing(required, payload));

  const call = $derived({ actor, version, method, units: [payload] });
</script>

<div class="dev">
  <header>
    <h1 class="mono">{actor}.{method}</h1>
    <span class="ver mono">{version}</span>
  </header>

  {#if loading}
    <p class="muted">reading the contract…</p>
  {:else if leaves.length === 0}
    <p class="muted">
      This Method declares no input. A call sends one empty Unit.
    </p>
  {:else}
    <div class="form">
      {#each leaves as f (f.path)}
        <Field
          name={f.name}
          title={f.name}
          control={f.control ?? 'text'}
          options={f.enum ?? []}
          required={f.required ?? false}
          placeholder={f.default ?? ''}
          value={values[f.name]}
          onchange={(v) => (values[f.name] = v)}
        />
      {/each}
    </div>
  {/if}

  <div class="go">
    <button disabled={gaps.length > 0}>
      {gaps.length ? `${gaps.join(', ')} required` : `call ${method}`}
    </button>
  </div>

  <details>
    <summary>what gets sent</summary>
    <pre class="mono">{JSON.stringify(call, null, 2)}</pre>
    <p class="muted">
      One Unit per row. A dropped file rides as <code class="mono">{'{name, sha256, size}'}</code> —
      the bytes went to the object store before the run started, because a Method's input is a
      workflow argument and a workflow argument is replayed on every worker that picks the run up.
    </p>
  </details>
</div>

<style>
  .dev { display: flex; flex-direction: column; gap: var(--s-4); padding: var(--s-3); }
  header { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  h1 { font-size: var(--t-lead); font-weight: 600; margin: 0; overflow-wrap: anywhere; }
  .ver { font-size: var(--t-small); color: var(--dim); }
  .form { display: flex; flex-direction: column; gap: var(--s-3); }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .go button {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); cursor: pointer; width: 100%;
  }
  .go button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  details { border-top: 1px solid var(--line); padding-top: var(--s-3); }
  summary { font-size: var(--t-small); color: var(--dim); cursor: pointer; }
  pre { margin: var(--s-2) 0; font-size: var(--t-small); background: var(--track); border-radius: var(--radius); padding: var(--s-3); overflow-x: auto; line-height: var(--lh-body); }
  code { font-size: var(--t-small); }
  @media (min-width: 720px) { .go button { width: auto; } }
</style>
