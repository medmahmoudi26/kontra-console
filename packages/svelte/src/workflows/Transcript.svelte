<script lang="ts">
  /**
   * The run page's transcript — a Run's account of itself, in kontra's words (kontra-console#5).
   *
   * ── WHAT THIS RENDERS, AND WHY IT IS NOT THE TIMELINE ───────────────────────────────────────────
   *
   * `Timeline.svelte` draws the reduced Temporal EVENTS — bars over a clock, one per event. This
   * draws TURNS: the domain account `transcript.ts` folds those events into, so a fleet coming up is
   * one row rather than four opaque ones, and a dispatch is the Method it called rather than three
   * rows named after Temporal's scheduler. ADR 0048's Outcome lists this as the "workflow thread +
   * turn drill" item, and until now `readRunTurns` had tests and no surface: `grep -rn readRunTurns
   * packages/svelte/src/` returned nothing.
   *
   * ── DERIVED CLIENT-SIDE. THERE IS NO `/api/runs/:id/turns`, AND THERE MUST NOT BE ───────────────
   *
   * `turns.ts:13` records that decision: a turns route would re-serialise a nine-arm union the client
   * already derives from a history it has to fetch anyway. `fetchRunTurns` reads the history route and
   * folds it here. Adding a route would put the vocabulary on the server, where changing a word means
   * a deploy.
   *
   * ── NARRATION IS A HISTORICAL ARM NOW ───────────────────────────────────────────────────────────
   *
   * ADR 0050 §2 removed `speak`, so no NEW run writes a narration turn — an author writes `note` or
   * `partial` and those reach the log store, which is what the rail beside this draws. Runs that
   * already narrated still HAVE those events, and they still render here, because history is
   * immutable and a completed run's account may not get quieter because the writer was retired.
   */
  import { onMount } from 'svelte';
  import { fetchRunTurns, type RunTurnsRead } from '@kontra/console-core/run/turns';

  export let runId: string;

  let read: RunTurnsRead | null = null;
  let loading = true;

  onMount(async () => {
    try {
      read = await fetchRunTurns(runId);
    } catch (e) {
      read = { ok: false, runId, gone: false, detail: String((e as Error)?.message ?? e) };
    } finally {
      loading = false;
    }
  });

  /** `t` is seconds since the run's first event. `+12.4s` reads better than a wall clock here,
   *  because the question a transcript answers is "in what order and how far apart". */
  const at = (t: number): string => `+${t.toFixed(1)}s`;

  /** The `failed` turn, if the run ended badly. `cancelled` stays its own word — an operator who
   *  cancelled expects it, and one whose run failed is finding out that it did. */
  $: failed = read?.ok
    ? (read.turns.named.turns.find((n) => n.turn.kind === 'failed')?.turn as
        | { kind: 'failed'; outcome: 'failed' | 'cancelled'; because: string; where?: { t: number; detail: string } }
        | undefined)
    : undefined;
</script>

<section class="transcript">
  <header>
    <h3>transcript</h3>
    {#if read?.ok}
      <span class="count mono">{read.turns.named.turns.length} turns</span>
      {#if read.turns.live}<span class="live">live</span>{/if}
    {/if}
  </header>

  {#if loading}
    <p class="muted">reading…</p>
  {:else if read && !read.ok && read.gone}
    <!--
      `gone` IS NOT AN ERROR AND IS NOT AN EMPTY TRANSCRIPT (turns.ts). Temporal drops an execution
      at retention long before anyone stops caring what it did, and the archive answers for most of
      those — a run that reaches here has been lost by BOTH. Rendering it as "no turns" would say
      the run did nothing; rendering it as a failure would say the appliance is broken.
    -->
    <p class="muted">
      Neither Temporal nor the archive still holds this run's history. That is retention, not a
      failure — the Datasets it wrote outlive it.
    </p>
  {:else if read && !read.ok}
    <p class="err" role="alert">{read.detail}</p>
  {:else if read?.ok && read.turns.named.turns.length === 0}
    <p class="muted">No turns yet.</p>
  {:else if read?.ok}
    <ol>
      {#each read.turns.named.turns as n, i (i)}
        <li class="turn {n.tone}" class:untranslated={n.untranslated}>
          <span class="t mono">{at(n.turn.t)}</span>
          <span class="label">{n.label}</span>
          <!--
            WHAT THE NAME RESTS ON, shown rather than hidden. `because` quotes something the reduced
            log actually carries — a type, an attempt, a state — so an operator who disagrees with a
            name can see what it was read from instead of guessing.
          -->
          <span class="why mono" title={n.turn.types.join(' · ')}>{n.because}</span>
        </li>
      {/each}
    </ol>

    {#if failed}
      <!--
        A FAILED RUN SAYS WHY, HERE AND NOT ONLY IN THE STATUS CHIP. A chip reading `failed` with the
        reason one drill-down away is the shape that sends somebody to `temporal workflow show`.

        AND IT SAYS *WHERE*, WHICH IS THE PART THAT IS ACTUALLY ACTIONABLE. A workflow's own failure
        event says the run failed and at best repeats the message; `where` is the activity, dispatch
        or child that broke BEFORE it — an earlier event with its own metadata. `transcript.ts` notes
        that its absence is informative too: the run failed on its own terms.
      -->
      <p class="err" role="alert">
        <strong>{failed.outcome === 'cancelled' ? 'cancelled' : 'failed'}</strong>
        — {failed.because}
        {#if failed.where}<br /><span class="where mono">at +{failed.where.t.toFixed(1)}s · {failed.where.detail}</span>{/if}
      </p>
    {/if}
  {/if}
</section>

<style>
  .transcript { display: flex; flex-direction: column; gap: var(--s-2); }
  header { display: flex; align-items: baseline; gap: var(--s-2); }
  h3 { font-size: var(--t-small); font-weight: 600; margin: 0; }
  .count { font-size: var(--t-micro); color: var(--dim); }
  .live {
    font-size: var(--t-micro); color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--radius); padding: 0 var(--s-1);
  }

  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .turn {
    display: grid;
    grid-template-columns: 5em minmax(0, 1fr) minmax(0, 1.4fr);
    gap: var(--s-2);
    align-items: baseline;
    font-size: var(--t-small);
    line-height: var(--lh-tight);
    padding: 2px var(--s-1);
    border-left: 2px solid transparent;
  }
  .t { color: var(--dim); }
  .label { overflow-wrap: anywhere; }
  .why { color: var(--dim); font-size: var(--t-small); overflow-wrap: anywhere; }

  /* Tone is the run's own reading, not a severity we invented: ok / busy / wrong / unknown. */
  .turn.wrong { border-left-color: var(--bad); }
  .turn.wrong .label { color: var(--bad); }
  .turn.busy { border-left-color: var(--accent); }
  /* AN UNTRANSLATED TURN RENDERS AS ITSELF — its label is Temporal's own word. Marked so nobody
     reads a raw type as a kontra term. */
  .turn.untranslated .label { color: var(--dim); font-family: var(--mono); }

  .muted { font-size: var(--t-small); color: var(--dim); margin: var(--s-2) 0; line-height: var(--lh-body); max-width: 62ch; }
  .where { color: var(--dim); font-size: var(--t-small); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: var(--s-2) 0;
    padding: var(--s-1) var(--s-2);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
    border-radius: var(--radius);
    line-height: var(--lh-body);
  }
</style>
