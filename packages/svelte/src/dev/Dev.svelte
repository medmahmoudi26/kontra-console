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

  import { callMethod, type Call } from './call';
  import Field from './Field.svelte';
  import { missing, payloadOf, type FieldValue } from './payload';

  interface Props {
    actor: string;
    version: string;
    method: string;
    schema: JsonSchema | undefined;
    /** Absent while the contract is being fetched; `null` once it is known there is none. */
    loading?: boolean;
    link?: 'connecting' | 'live' | 'reconnecting' | 'unsupported';
    /** How many times the contract has been re-read. Shown because "live" is a claim otherwise. */
    revisions?: number;
  }
  let { actor, version, method, schema, loading = false, link = 'connecting', revisions = 0 }: Props = $props();

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

  /**
   * THE BUTTON CALLS THE METHOD. It used to be a disabled preview, which made this pane a form that
   * described a call nobody could make — the one thing the embed exists for.
   */
  let run = $state<Call>({ state: 'idle' });
  let stop: () => void = () => {};

  function go(): void {
    stop();
    // `$state.snapshot` because the payload is a reactive proxy and it is about to be JSON-encoded
    // and sent; a proxy crossing `structuredClone` inside `fetch` is a class of bug that only shows
    // up on the wire.
    stop = callMethod(actor, version, method, [$state.snapshot(payload)], (c) => (run = c));
  }

  // A PANE THAT CLOSES MID-CALL STOPS LISTENING. `EventSource` reconnects by itself, so a source
  // left open against a finished run reopens forever — a poll, reinvented.
  $effect(() => () => stop());
</script>

<div class="dev">
  <header>
    <h1 class="mono">{actor}.{method}</h1>
    <span class="ver mono">{version}</span>
    <!-- THE LINK IS SHOWN, because a pane holding a four-minute-old contract with no indication is
         worse than one that says it is stale. `live` earns a dot; the others say the word. -->
    <span class="link {link}" title="the contract has been read {revisions} time(s)">
      {#if link === 'live'}<span class="dot" aria-hidden="true"></span>live
      {:else if link === 'reconnecting'}reconnecting…
      {:else if link === 'unsupported'}not live
      {:else}connecting…{/if}
    </span>
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
    <button disabled={gaps.length > 0 || run.state === 'starting' || run.state === 'running'} onclick={go}>
      {#if gaps.length}{gaps.join(', ')} required
      {:else if run.state === 'starting'}starting…
      {:else if run.state === 'running'}{run.status.toLowerCase()}…
      {:else}call {method}{/if}
    </button>
  </div>

  {#if run.state === 'error'}
    <p class="err" role="alert">{run.error}</p>
  {:else if run.state === 'running' || run.state === 'done'}
    <dl class="result">
      <dt>run</dt><dd class="mono">{run.runId}</dd>
      {#if run.state === 'done'}
        <dt>status</dt>
        <dd class="mono" class:bad={run.reading.status === 'FAILED'}>{run.reading.status.toLowerCase()}</dd>
        {#if run.reading.result}
          <dt>units</dt><dd class="mono">{run.reading.result.units}</dd>
          <dt>rows</dt><dd class="mono">{run.reading.result.results}</dd>
          <!-- ISOLATED IS ALWAYS SHOWN. Zero rows from a Method that dropped every Unit and zero
               from one that found nothing look identical without it (ADR 0028 §4). -->
          <dt>isolated</dt>
          <dd class="mono" class:bad={run.reading.result.isolated > 0}>{run.reading.result.isolated}</dd>
          <dt>machine</dt><dd class="mono">{run.reading.result.machine}</dd>
          {#if run.reading.result.dataset}<dt>dataset</dt><dd class="mono">{run.reading.result.dataset}</dd>{/if}
        {/if}
        {#if run.reading.failure}<dt>failure</dt><dd class="bad">{run.reading.failure}</dd>{/if}
      {/if}
    </dl>
  {/if}

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
  .link { font-size: var(--t-small); color: var(--dim); margin-left: auto; display: inline-flex; align-items: center; gap: var(--s-1); }
  .link.live { color: var(--ok); }
  .link.reconnecting { color: var(--warn); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .form { display: flex; flex-direction: column; gap: var(--s-3); }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .go button {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); cursor: pointer; width: 100%;
  }
  .go button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); line-height: var(--lh-body); overflow-wrap: anywhere; }
  .result {
    display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3);
    margin: 0; padding: var(--s-3); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  .result dt { font-size: var(--t-small); color: var(--dim); }
  .result dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  .bad { color: var(--bad); }
  details { border-top: 1px solid var(--line); padding-top: var(--s-3); }
  summary { font-size: var(--t-small); color: var(--dim); cursor: pointer; }
  pre { margin: var(--s-2) 0; font-size: var(--t-small); background: var(--track); border-radius: var(--radius); padding: var(--s-3); overflow-x: auto; line-height: var(--lh-body); }
  code { font-size: var(--t-small); }
  @media (min-width: 720px) { .go button { width: auto; } }
</style>
