<script lang="ts">
  /**
   * What a run is WAITING FOR, and the form that unblocks it.
   *
   * ── A PARKED RUN IS NOT A STUCK RUN, AND THE CONSOLE HAS TO SAY WHICH ───────────────────────────
   *
   * `ask` parks a workflow on a question until a person answers. From every other angle — the run
   * list, the timeline, Temporal's own status — that is indistinguishable from a run that is simply
   * going, and this console had no way to answer at all: three `approve` runs sat in `running` for
   * ten minutes on a live install, each waiting on a question nobody could see.
   *
   * ── THE ANSWER FORM IS DERIVED, LIKE EVERY OTHER FORM HERE ──────────────────────────────────────
   *
   * The ask carries a JSON Schema for what it will accept, so `schemaFields` builds the controls and
   * the server refuses anything that does not fit — naming the field. There is no second place an
   * answer's shape is described.
   *
   * ── AN ANSWER IS ATTRIBUTED ─────────────────────────────────────────────────────────────────────
   *
   * `by` rides with the value because "who said yes" is the question asked after a run does
   * something expensive, and an unattributed approval cannot answer it.
   */
  import { readAsks, waitedWords, deadlineWords, standingWords } from '@kontra/console-core/panels/ask';
  import { schemaFields, type FieldNode } from '@kontra/console-core/panels/schemaTree';
  import { BASE } from '@kontra/console-core/run/api';
  import type { RunAsk } from '@kontra/console-core/run/turns';
  import type { JsonSchema } from '@kontra/console-core/types';

  import Field from '../dev/Field.svelte';
  import { missing, payloadOf, type FieldValue } from '../dev/payload';

  interface Props {
    runId: string;
    /**
     * Bumped by the run stream whenever this run changed.
     *
     * AN ANSWER IS NOT INSTANT. The POST returns when the signal is DELIVERED, not when the
     * workflow has acted on it — so re-reading in the same tick showed the question still pending
     * under a run that had already completed. The stream says when it actually moved.
     */
    revision?: number;
  }
  let { runId, revision = 0 }: Props = $props();

  let asks = $state<RunAsk[]>([]);
  /**
   * Only the FIRST read is a loading state.
   *
   * This re-reads on every stream frame, and it used to set `loading = true` each time — so on a
   * run that is actively emitting, the component was "loading" almost always and the question it
   * exists to show never appeared. A re-read holds the last answer on screen; nothing here has to
   * blank to be correct.
   */
  let firstRead = $state(true);
  let error = $state('');
  let sending = $state('');
  let values = $state<Record<string, Record<string, FieldValue>>>({});
  /** Who is answering. Kept for the session rather than typed per answer. */
  let by = $state('');

  async function read(): Promise<void> {
    const id = runId;
    try {
      const res = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/asks`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // A run with no asks and a run the server cannot read are different facts; 404 is the run,
        // not the asks, and neither is worth shouting about on a surface that is mostly about runs.
        if (id !== runId) return;
        asks = [];
        error = res.status === 404 ? '' : `could not read what this run is waiting for: HTTP ${res.status}`;
        return;
      }
      const got = ((await res.json()) as { asks?: RunAsk[] }).asks ?? [];
      // A LATE ANSWER FOR THE PREVIOUS RUN IS DROPPED. Two reads can be in flight when the
      // selection changes, and the slower one would otherwise hang the old run's question under the
      // new run's id.
      if (id !== runId) return;
      asks = got;
      error = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      firstRead = false;
    }
  }

  $effect(() => {
    // Both are read so this re-runs on either: a different run, or the same run having moved.
    void runId;
    void revision;
    void read();
  });

  // READ AGAINST ONE `now`, so two asks in the same list cannot disagree about how long they have
  // been waiting by the milliseconds between two clock calls.
  const readings = $derived(readAsks(asks, Date.now()));
  const waiting = $derived(readings.filter((r) => r.standing === 'waiting'));

  async function answer(ask: RunAsk): Promise<void> {
    const payload = payloadOf(values[ask.id] ?? {});
    sending = ask.id;
    try {
      const res = await fetch(
        `${BASE}/runs/${encodeURIComponent(runId)}/asks/${encodeURIComponent(ask.id)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ value: payload, ...(by.trim() ? { by: by.trim() } : {}) }),
        }
      );
      if (!res.ok) {
        const said = (await res.json().catch(() => ({}))) as { error?: string };
        error = said.error ?? `the answer was refused: HTTP ${res.status}`;
        return;
      }
      error = '';
      // Read once now — an ask that was refused or already answered updates immediately — and
      // again when the stream says the run moved, which is what clears a question the workflow has
      // actually consumed.
      await read();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      sending = '';
    }
  }

  function fieldsOf(ask: RunAsk): FieldNode[] {
    // `Ask.schema` is `unknown` on the contract — an ask carries whatever its author declared, and
    // the SDK does not narrow it. `schemaFields` answers `null` for anything it cannot read, which
    // is the same handling a Method with no schema gets.
    return (schemaFields(ask.schema as JsonSchema | undefined) ?? []).filter(
      (n): n is FieldNode => n.kind === 'leaf'
    );
  }
</script>

{#if !firstRead && (waiting.length > 0 || error)}
  <section class="asks" data-testid="run-asks">
    {#if error}<p class="err" role="alert">{error}</p>{/if}

    {#each waiting as r (r.ask.id)}
      {@const fields = fieldsOf(r.ask)}
      {@const required = fields.filter((f) => f.required).map((f) => f.name)}
      {@const gaps = missing(required, payloadOf(values[r.ask.id] ?? {}))}
      <article data-testid="ask-{r.ask.id}">
        <header>
          <h3>{r.ask.prompt}</h3>
          <span class="waited" title={standingWords(r).because}>{waitedWords(r)}</span>
          {#if deadlineWords(r)}<span class="deadline" class:overdue={r.overdue}>{deadlineWords(r)}</span>{/if}
        </header>

        {#if r.unreadable}
          <!-- KEPT AND MARKED, never dropped: a malformed ask is still a run parked on something. -->
          <p class="err">this ask is not readable — answer it with `kontra ask answer`.</p>
        {:else}
          <div class="form">
            {#each fields as f (f.path)}
              <Field
                name={f.name}
                title={f.name}
                control={f.control ?? 'text'}
                options={f.enum ?? []}
                required={f.required ?? false}
                placeholder={f.default ?? ''}
                value={(values[r.ask.id] ?? {})[f.name]}
                onchange={(v) => {
                  values[r.ask.id] = { ...(values[r.ask.id] ?? {}), [f.name]: v };
                }}
              />
            {/each}
            <label class="by">
              <span>answered by</span>
              <input bind:value={by} placeholder="your name — recorded with the answer" />
            </label>
          </div>

          <button
            data-testid="answer-{r.ask.id}"
            disabled={sending === r.ask.id || gaps.length > 0 || !r.answerable}
            onclick={() => void answer(r.ask)}
          >
            {#if sending === r.ask.id}sending…
            {:else if gaps.length}{gaps.join(', ')} required
            {:else if !r.answerable}{standingWords(r).label}
            {:else}answer{/if}
          </button>
        {/if}
      </article>
    {/each}
  </section>
{/if}

<style>
  .asks { display: flex; flex-direction: column; gap: var(--s-2); }
  article {
    display: flex; flex-direction: column; gap: var(--s-3);
    padding: var(--s-3); border-radius: var(--radius);
    background: var(--panel);
    /* A PARKED RUN IS THE ONE THING ON THIS SURFACE THAT NEEDS A PERSON, so it is the one thing
       drawn in the attention colour. */
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
  }
  header { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  h3 { font-size: var(--t-body); font-weight: 600; margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .waited { font-size: var(--t-micro); color: var(--dim); margin-left: auto; }
  .deadline { font-size: var(--t-micro); color: var(--dim); }
  .deadline.overdue { color: var(--bad); }
  .form { display: flex; flex-direction: column; gap: var(--s-3); }
  .by { display: flex; flex-direction: column; gap: var(--s-1); }
  .by span { font-size: var(--t-small); color: var(--dim); font-family: var(--mono); }
  .by input {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-1) var(--s-2); font-size: var(--t-small);
  }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); line-height: var(--lh-body); }
  button {
    align-self: flex-start; font-size: var(--t-small); padding: var(--s-2) var(--s-4);
    border-radius: var(--radius); cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
    background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn);
  }
  button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
</style>
