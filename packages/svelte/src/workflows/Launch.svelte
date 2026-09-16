<script lang="ts">
  /**
   * Start a run: the registered folders, the type each declares, its input form, and Run.
   *
   * ── THE FORM IS THE CONTRACT, AND A BLANK REQUIRED FIELD IS REFUSED HERE ────────────────────────
   *
   * The same `schemaFields` derivation the `/dev` embed uses, against the workflow descriptor a
   * serving worker published. A value that will not do is named on this screen rather than posted
   * and failed minutes later inside a tmux pane.
   *
   * ── THE QUEUE IS NOT A FIELD ────────────────────────────────────────────────────────────────────
   *
   * The server derives it from the folder's content digest (GitHub #15), so a Run cannot be aimed at
   * a queue string. It is SHOWN, because an operator needs to know which workers will pick this up,
   * and a run whose queue has no pollers is refused by the server with a sentence that says so.
   *
   * ── STARTING STAYS ON THIS PAGE ─────────────────────────────────────────────────────────────────
   *
   * Pressing Run used to leave for a global Runs surface, which took the author's code, their input
   * and the run itself off screen at the exact moment they wanted all three. The run is watched here.
   */
  import { schemaFields, type FieldNode } from '@kontra/console-core/panels/schemaTree';
  import { mergeWorkflowFolders } from '@kontra/console-core/panels/sourceFolders';
  import { guessTypeFromFilename, workflowDefns } from '@kontra/console-core/panels/workflowSource';
  import {
    fetchPollers,
    fetchSources,
    fetchWorkflowSource,
    fetchWorkflows,
    serveWorkflow,
    startRun,
    type Source,
    type WorkflowDescriptor,
    type WorkflowFile,
  } from '@kontra/console-core/run/api';
  import {
    stateWords,
    workflowState,
    type PollerReport,
  } from '@kontra/console-core/run/workflowState';

  import Field from '../dev/Field.svelte';
  import { missing, payloadOf, type FieldValue } from '../dev/payload';

  interface Props {
    /** The folder the ADDRESS names, if it names one. `/workflows/approve` opens `approve`. */
    open?: string;
    /** The run that was just started. The surface watches it; this component does not. */
    onstarted: (runId: string) => void;
    /**
     * Which folder is open and what `@workflow.defn` type it declares.
     *
     * THE TYPE TRAVELS WITH THE NAME because only this component knows both: it reads the source to
     * find the type, and the run list upstream needs the type to scope itself. Passing the name
     * alone would make the other end guess the mapping — `dhmonitor` declares `DockerLeakMonitor`.
     */
    onopened?: (name: string, type: string) => void;
  }
  let { open: openName = '', onstarted, onopened }: Props = $props();

  interface Row { name: string; folder: Source; file?: WorkflowFile }

  let rows = $state<Row[]>([]);
  let dir = $state('');
  let registered = $state<WorkflowDescriptor[]>([]);
  let loading = $state(true);
  let listError = $state('');

  let selected = $state('');
  /** The `@workflow.defn` classes the open file declares. A file may declare several. */
  let types = $state<string[]>([]);
  let type = $state('');
  let sourceError = $state('');
  let starting = $state(false);
  let startError = $state('');

  /**
   * IS ANYTHING POLLING THIS WORKFLOW'S QUEUE.
   *
   * A Run against a queue with no live worker is refused by the server, and that refusal arrives
   * after the press. Reading the pollers up front turns it into a state the operator can see and
   * act on — which is what the Serve button is for.
   *
   * `null` means NOT ASKED (no queue to ask about, because nothing has ever served this folder).
   * A report with `error` set means ASKED AND UNKNOWN, which `workflowState` keeps distinct from
   * "nothing is serving"; the two send an operator to different places.
   */
  let pollers = $state<PollerReport | null>(null);
  let serving = $state(false);
  let serveError = $state('');
  let served = $state('');

  async function readPollers(queue: string | undefined): Promise<void> {
    if (!queue) {
      pollers = null;
      return;
    }
    // ON DEMAND, NEVER ON A TIMER: opening a folder and serving one are the two moments this can
    // change, and both are events this component already has.
    pollers = await fetchPollers(queue).catch(() => null);
  }

  const serveState = $derived(workflowState([], pollers, Date.now()));
  const words = $derived(stateWords(serveState));

  let values = $state<Record<string, FieldValue>>({});

  $effect(() => {
    void (async () => {
      try {
        const [listed, folders] = await Promise.all([fetchWorkflows(), fetchSources('workflow')]);
        dir = listed.dir;
        registered = listed.registered;
        // A workflow is a FOLDER holding `workflow.py`, so the rows come from the folder listing and
        // the file listing only decorates them. Reading either alone renders half a page.
        rows = mergeWorkflowFolders(listed.workflows, folders.sources);
        // THE ADDRESS WINS, then the first folder. A surface whose primary action appears only
        // after a click reads as "there is nothing to run here"; a surface that ignores the folder
        // in its own URL is worse, because it answers a question nobody asked.
        const wanted = rows.find((r) => r.name === openName || r.name === `${openName}.py`);
        if (selected === '' && (wanted ?? rows[0])) await open((wanted ?? rows[0]!).name);
      } catch (err) {
        listError = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    })();
  });

  async function open(name: string): Promise<void> {
    selected = name;
    sourceError = '';
    startError = '';
    serveError = '';
    served = '';
    pollers = null;
    types = [];
    type = '';
    try {
      const source = await fetchWorkflowSource(name);
      // THE TYPE COMES FROM THE SOURCE, not from the file name — `dhmonitor.py` declares
      // `DockerLeakMonitor`, and starting `Dhmonitor` is a workflow nobody registered.
      types = workflowDefns(source);
      type = types[0] ?? guessTypeFromFilename(name);
      onopened?.(name, type);
      await readPollers(registered.find((d) => d.name === type)?.queue);
    } catch (err) {
      sourceError = err instanceof Error ? err.message : String(err);
      // A file that cannot be read still has a startable guess, and saying so beats a dead form.
      type = guessTypeFromFilename(name);
      onopened?.(name, type);
    }
  }

  const descriptor = $derived(registered.find((d) => d.name === type));
  const nodes = $derived(schemaFields(descriptor?.input) ?? []);
  const leaves = $derived(nodes.filter((n): n is FieldNode => n.kind === 'leaf'));
  const payload = $derived(payloadOf(values));
  const gaps = $derived(missing(leaves.filter((n) => n.required).map((n) => n.name), payload));

  // A NEW SELECTION MUST NOT CARRY THE LAST FORM'S VALUES. Keys the current type does not declare
  // are dropped; anything it still declares keeps what was typed, which is what makes a live
  // contract change (`serve --watch`) survivable mid-form.
  $effect(() => {
    const declared = new Set(leaves.map((n) => n.name));
    for (const k of Object.keys(values)) if (!declared.has(k)) delete values[k];
  });

  /**
   * Serve this folder: start a detached worker polling the queue its content digest names.
   *
   * IT IS THE OTHER HALF OF RUN, and the console had only one of them — so a folder nothing was
   * serving offered a button whose only possible outcome was the server refusing it. The queue is
   * NOT a parameter (GitHub #15): the server derives `wf-<name>-<digest12>` from the folder, which
   * is the only string the worker will actually poll.
   */
  async function serve(): Promise<void> {
    if (!selected) return;
    serving = true;
    serveError = '';
    served = '';
    try {
      const result = await serveWorkflow(selected);
      served = result.attach || result.session;
      // THE DESCRIPTOR IS RE-READ, because serving is what publishes it: a folder nobody had served
      // has no input schema, and the form that was empty a second ago is the one this call fills.
      registered = (await fetchWorkflows()).registered;
      const queue = registered.find((d) => d.name === type)?.queue ?? result.queue;
      await readPollers(queue);
      /**
       * ONE LATE RE-READ, because a worker that has just started has not polled yet.
       *
       * MEASURED: the tmux session exists immediately and the first poll reaches Temporal a few
       * seconds later, so reading once on return reported `idle` under a worker that was starting
       * perfectly well — the console calling its own successful action a failure.
       *
       * A `setTimeout`, not an interval: this is one deferred read tied to one press, and it stops
       * whether or not anything came of it. Nothing here repeats.
       */
      window.setTimeout(() => void readPollers(queue), 5_000);
    } catch (err) {
      serveError = err instanceof Error ? err.message : String(err);
    } finally {
      serving = false;
    }
  }

  async function go(): Promise<void> {
    if (!selected || !type.trim() || gaps.length > 0) return;
    starting = true;
    startError = '';
    try {
      const started = await startRun(selected, type.trim(), $state.snapshot(payload));
      onstarted(started.runId);
    } catch (err) {
      // The server's sentence verbatim: a refusal here names its own fix — most often that no worker
      // is serving this folder's current code.
      startError = err instanceof Error ? err.message : String(err);
    } finally {
      starting = false;
    }
  }
</script>

<div class="launch">
  {#if loading}
    <p class="muted">reading {dir || 'the workflow folders'}…</p>
  {:else if listError}
    <p class="err" role="alert">{listError}</p>
  {:else if rows.length === 0}
    <p class="muted">
      No workflow folders in <code class="mono">{dir || '.kontra/workflows'}</code>.
      <code class="mono">kontra workflow register &lt;dir&gt;</code> adds one.
    </p>
  {:else}
    <div class="files">
      {#each rows as r (r.folder.id)}
        <!-- KEYED BY THE FOLDER: two checkouts of `nscheck` are two rows with one name. -->
        <button
          data-testid="workflow-file-{r.name}"
          class:on={selected === r.name}
          title={r.folder.path}
          onclick={() => void open(r.name)}
        >
          <span class="mono">{r.name}</span>
          {#if r.folder.absent}<span class="gone">absent</span>{/if}
        </button>
      {/each}
    </div>

    {#if selected}
      <div class="form">
        <header>
          <h3 class="mono">{selected}</h3>
          {#if types.length > 1}
            <!-- ONE FILE, SEVERAL `@workflow.defn` CLASSES. Each registers separately, so which one
                 starts is a choice and not a detail. -->
            <select bind:value={type} aria-label="workflow type">
              {#each types as t (t)}<option value={t}>{t}</option>{/each}
            </select>
          {:else}
            <span class="type mono">{type || 'no type declared'}</span>
          {/if}
          {#if descriptor?.queue}
            <span class="queue mono" title="derived from the folder's content digest — never typed">
              {descriptor.queue}
            </span>
          {/if}
          <span class="state {serveState}" class:live={words.live} title={words.title}>{words.label}</span>
        </header>

        {#if sourceError}<p class="err" role="alert">{sourceError}</p>{/if}

        {#if descriptor?.error}
          <!-- THE FILE NO LONGER IMPORTS. A broken workflow is a state, not a silence: the worker
               posts the import error here and the form drops with it. -->
          <p class="err" role="alert">this workflow does not import: {descriptor.error}</p>
        {:else if leaves.length > 0}
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
        {:else if descriptor}
          <p class="muted">This workflow declares no input. Run sends none.</p>
        {:else}
          <!-- NO DESCRIPTOR IS NOT "NO INPUT". Nobody has served this type, so nothing has published
               what it takes — and starting it would be refused by the server anyway. -->
          <p class="muted">
            Nothing is serving <code class="mono">{type}</code>, so its input is unknown.
            <code class="mono">kontra workflow serve {selected}</code> publishes it.
          </p>
        {/if}

        {#if serveError}<p class="err" role="alert">{serveError}</p>{/if}
        {#if startError}<p class="err" role="alert">{startError}</p>{/if}
        {#if served}
          <p class="muted">
            worker started — <code class="mono">{served}</code> attaches to it, and its pane is on
            the Monitor.
          </p>
        {/if}

        <!-- SERVE AND RUN, IN THAT ORDER, because that is the order they have to happen in: a Run
             aimed at a queue nothing polls is refused by the server. -->
        <div class="acts">
          <button class="serve" data-testid="serve-button" disabled={serving || !selected} onclick={() => void serve()}>
            {serving ? 'serving…' : serveState === 'serving' ? 'Re-serve' : 'Serve'}
          </button>
          <button
            class="run"
            data-testid="run-button"
            disabled={starting || !type.trim() || gaps.length > 0}
            onclick={() => void go()}
          >
            {#if starting}starting…{:else if gaps.length}{gaps.join(', ')} required{:else}Run{/if}
          </button>
        </div>

        {#if serveState === 'idle'}
          <p class="muted">
            Nothing is polling this queue, so Run will be refused. Serve starts a worker on the
            control plane's host; <code class="mono">kontra workflow serve {selected}</code> does the
            same thing from your own machine, which is what you want if the code is there and not
            here.
          </p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .launch { display: flex; flex-direction: column; gap: var(--s-3); }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .err { font-size: var(--t-small); color: var(--bad); margin: 0; line-height: var(--lh-body); overflow-wrap: anywhere; }

  /* WRAPPING, NOT SCROLLING. At 390px a row of folder chips that scrolls sideways hides the folder
     you want behind a gesture; wrapped chips stay reachable. */
  .files { display: flex; flex-wrap: wrap; gap: var(--s-1); }
  .files button {
    display: inline-flex; align-items: baseline; gap: var(--s-1);
    font-size: var(--t-small); padding: var(--s-1) var(--s-2); border-radius: var(--radius);
    border: 1px solid var(--line); background: var(--panel); color: var(--dim); cursor: pointer;
    max-width: 100%; overflow-wrap: anywhere; text-align: left;
  }
  .files button.on { color: var(--fg); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .gone { font-size: var(--t-micro); color: var(--warn); }

  .form {
    display: flex; flex-direction: column; gap: var(--s-3);
    padding: var(--s-3); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  .form header { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  h3 { font-size: var(--t-body); font-weight: 600; margin: 0; overflow-wrap: anywhere; }
  .type, .queue { font-size: var(--t-small); color: var(--dim); }
  .queue { margin-left: auto; }
  select {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-1) var(--s-2); font-size: var(--t-small);
  }
  .acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
  .state { font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
  .state.serving { color: var(--ok); }
  .state.running { color: var(--accent); }
  .state.unknown { color: var(--warn); }
  .serve {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid var(--line); background: var(--track); color: var(--fg); cursor: pointer;
  }
  .serve:disabled { color: var(--dim); cursor: not-allowed; }
  .run {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); cursor: pointer;
  }
  .run:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
  .acts button { flex: 1; }
  @media (min-width: 720px) { .acts button { flex: 0 0 auto; } }
</style>
