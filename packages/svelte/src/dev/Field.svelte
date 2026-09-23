<script lang="ts">
  /**
   * One field, drawn as whatever its declared type earned.
   *
   * NOTHING HERE IS CONFIGURED. `control` comes from `@kontra/console-core`'s `schemaTree` — the
   * same derivation the React console uses — so a field added to a Method appears with the right
   * control and no edit here. There is no second place a form is described, which is what stops a
   * form and its Method from disagreeing.
   */
  import type { FieldControl } from '@kontra/console-core/panels/schemaTree';

  import { cycle, label, type Tri } from './toggle';
  import type { FieldValue } from './payload';
  import { fieldValueOf, filesFrom, uploadAll, type Upload } from './upload';

  interface Props {
    name: string;
    title: string;
    control: FieldControl;
    options?: readonly string[];
    required: boolean;
    placeholder?: string;
    /** The author's own sentence about this field. Rendered BESIDE the control, not inside it. */
    description?: string;
    value: FieldValue;
    onchange: (v: FieldValue) => void;
  }
  let { name, title, control, options = [], required, placeholder = '', description = '',
        value, onchange }: Props = $props();

  /**
   * THE BYTES GO UP BEFORE THE RUN STARTS, and only a ref rides in the argument.
   *
   * A Method's input is a workflow argument, replayed on every worker that picks the run up — a
   * dropped corpus in there is refused or offloaded by the claim-check codec. So the drop uploads
   * to `/api/uploads` now and the field keeps `{name, sha256, size}`.
   */
  let up = $state<Upload>({ state: 'idle' });
  let over = $state(false);
  let input: HTMLInputElement | undefined = $state();

  async function take(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    const kind = control === 'folder' ? 'folder' : 'file';
    up = await uploadAll(files, (u) => (up = u));
    if (up.state === 'done') onchange(fieldValueOf(kind, up.refs));
  }

  async function dropped(e: DragEvent): Promise<void> {
    e.preventDefault();
    over = false;
    if (e.dataTransfer) await take(await filesFrom(e.dataTransfer));
  }

  function clear(): void {
    up = { state: 'idle' };
    onchange(undefined);
    if (input) input.value = '';
  }
</script>

<!--
  TWO CELLS, AND THE CONTROL IS IN THE SECOND ONE. This used to be a bare grid with three direct
  children — label, hint, control — and `grid-template-columns: 140px 1fr` at ≥720px. Grid fills
  row by row, so the label took (1,1), the HINT took (1,2), and the control wrapped onto row 2 back
  in COLUMN 1: a 140px box under its own label, with the sentence describing it stranded up and to
  the right. Measured on `/workflows`: every input in the canary form rendered at a fraction of the
  available width with its description in a different row.

  Wrapping the control and its sentence in one cell is what makes the two columns mean what they
  look like — a name on the left, everything about the field on the right.
-->
<label class="field">
  <span class="lbl">{title}{#if required}<i aria-hidden="true">*</i><span class="sr">required</span>{/if}</span>
  <span class="ctl">
  {#if control === 'select'}
    <select value={value ?? ''} onchange={(e) => onchange(e.currentTarget.value || undefined)}>
      <option value="">— not set —</option>
      {#each options as o (o)}<option value={o}>{o}</option>{/each}
    </select>

  {:else if control === 'toggle'}
    <button type="button" class="toggle" role="switch"
            aria-checked={value === true ? 'true' : value === false ? 'false' : 'mixed'}
            onclick={() => onchange(cycle(value as Tri, required))}>
      <span class="knob" class:on={value === true} class:off={value === false}></span>
      <span class="state">{label(value as Tri)}</span>
    </button>

  {:else if control === 'file' || control === 'folder'}
    <!-- A DROP TARGET AND A PICKER, because a drop is not reachable from a keyboard. The zone takes
         the drop; the same element opens the file dialog on click or Enter. -->
    <div
      class="drop"
      class:filled={value !== undefined}
      class:over
      class:busy={up.state === 'uploading'}
      role="button"
      tabindex="0"
      aria-label="{title}: drop a {control} here, or press Enter to choose"
      ondragover={(e) => { e.preventDefault(); over = true; }}
      ondragleave={() => (over = false)}
      ondrop={(e) => void dropped(e)}
      onclick={() => input?.click()}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input?.click(); } }}
    >
      {#if up.state === 'uploading'}
        <b>uploading {up.done + 1} of {up.total}</b><span class="mono dim">{up.name}</span>
      {:else if value && typeof value === 'object' && 'files' in value}
        <b>{value.files.length} files</b><span class="mono dim">{value.files[0]?.sha256?.slice(0, 12)}…</span>
      {:else if value && typeof value === 'object'}
        <b>{value.name}</b><span class="mono dim">{value.sha256.slice(0, 12)}… · {value.size} B</span>
      {:else}
        drop a {control} here — or choose
      {/if}
    </div>
    <!-- `webkitdirectory` IS THE ONLY WAY a picker returns a tree. It is the non-standard spelling
         every engine implements; `directory` is the standard one nobody does. -->
    <input
      bind:this={input}
      class="sr"
      type="file"
      {name}
      multiple={control === 'folder'}
      webkitdirectory={control === 'folder' ? true : undefined}
      onchange={(e) => void take([...(e.currentTarget.files ?? [])])}
    />
    {#if up.state === 'done' && up.error}
      <!-- WHAT LANDED IS STILL THERE. A folder whose tenth file failed keeps its nine; saying only
           the error would read as "nothing uploaded" when most of it did. -->
      <p class="err" role="alert">{up.refs.length} uploaded, then: {up.error}</p>
    {/if}
    {#if value !== undefined}<button type="button" class="clear" onclick={clear}>clear</button>{/if}

  {:else}
    <input type="text" value={value ?? ''} {placeholder} {name}
           oninput={(e) => onchange(e.currentTarget.value)} />
  {/if}

  <!-- THE AUTHOR'S SENTENCE, UNDER THE BOX AND NOT INSIDE IT.
       The default used to be the only hint and it rode in the `placeholder`, which vanishes the
       moment somebody types — so the one explanation of a field disappeared exactly when it was
       being filled in. A description stays, and it sits under the control it describes rather
       than beside the label, because that is the order it is read in: what is this box, then
       what does it mean. -->
  {#if description}<span class="hint">{description}</span>{/if}
  </span>
</label>

<style>
  /* NARROW FIRST: the label sits above its control, so a drop zone gets the full width — which is
     most of what makes this usable in a 400px panel. The two-column form is what width earns. */
  .field { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-1); }
  /* The control, its errors and its sentence, as ONE grid cell — see the note on the markup.
     `min-width: 0` on the TRACK rather than `max-width: 100%` on the children: the child rule was
     `.ctl > *`, which outranks the bare `input` selector below it and quietly won the `max-width`
     fight — measured, every box rendered at the full 1150px of the column. */
  .ctl { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-1); min-width: 0; }
  .lbl { font-size: var(--t-small); color: var(--dim); font-family: var(--mono); }
  .lbl i { color: var(--warn); font-style: normal; margin-left: 3px; }
  /* --t-micro is the floor for incidental text (ADR 0048 §5); the hint wraps rather than
     truncating, because half a sentence is worse than none. */
  .hint { font-size: var(--t-micro); color: var(--dim); line-height: var(--lh-body);
          max-width: 62ch; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

  input, select {
    width: 100%;
    /* A BOX AS WIDE AS THE COLUMN IS A LIE ABOUT WHAT GOES IN IT. `machines` takes `1`; a 900px
       field for it reads as "paste something long here" and makes a row of them impossible to
       scan. 26rem is about 60 characters of the mono face — past a path or a hostname, which is
       the longest thing any of these actually hold. The drop zone is exempt: it is a TARGET, and
       a small target is a worse one. */
    max-width: 26rem;
    background: var(--track);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--fg);
    padding: var(--s-1) var(--s-2);
    font-size: var(--t-small);
  }

  .toggle { display: flex; align-items: center; gap: var(--s-2); background: none; border: 0; padding: 0; cursor: pointer; }
  .knob { width: 32px; height: 18px; border-radius: 999px; background: var(--track); border: 1px solid var(--line); position: relative; transition: background 120ms; }
  .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--dim); transition: transform 120ms, background 120ms; }
  .knob.on { background: color-mix(in srgb, var(--ok) 35%, transparent); }
  .knob.on::after { transform: translateX(14px); background: var(--ok); }
  .knob.off::after { background: var(--bad); }
  .state { font-size: var(--t-small); color: var(--dim); font-family: var(--mono); }

  .drop {
    width: 100%; border: 1px dashed var(--line); border-radius: var(--radius); background: var(--track);
    padding: var(--s-2); font-size: var(--t-small); color: var(--dim); cursor: pointer;
    display: flex; gap: var(--s-2); align-items: baseline; justify-content: center; flex-wrap: wrap;
  }
  .drop.filled { border-style: solid; border-color: color-mix(in srgb, var(--ok) 40%, transparent); color: var(--fg); }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--fg); }
  .drop.busy { border-style: solid; border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--fg); }
  .dim { color: var(--dim); }
  .clear {
    justify-self: start; background: none; border: 0; padding: 0; cursor: pointer;
    font-size: var(--t-small); color: var(--dim); text-decoration: underline;
  }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); overflow-wrap: anywhere; }

  @media (min-width: 720px) {
    /* `align-items: start`, NOT `center`. A field whose description runs to three lines is three
       times the height of one that has none, and centring pushed its label into the middle of the
       paragraph — so a column of labels no longer lined up with anything. The label belongs to the
       TOP of its cell, level with the box it names. */
    .field { grid-template-columns: 170px minmax(0, 1fr); align-items: start; gap: var(--s-3); }
    /* Optical, not structural: the label is text and the input has a border and padding, so
       matching their box tops leaves the two baselines visibly out of step. */
    .lbl { padding-top: 0.35em; }
  }
</style>
