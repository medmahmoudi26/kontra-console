<script lang="ts">
  /**
   * Monitor — the wall of read-only Terminals a Fleet's tmux exposes.
   *
   * ── A TERMINAL IS A SCREEN, NOT A LOG ───────────────────────────────────────────────────────────
   *
   * tmux is the only path off a Worker (ADR 0020), and what it gives is the pane as it looks right
   * now. A snapshot is a whole screen preceded by clear-home; the tile repaints rather than appends,
   * which is what keeps a wall of sixty tiles bounded.
   *
   * ── EVERY TILE IS A MACHINE THAT EXISTS ─────────────────────────────────────────────────────────
   *
   * A Machine with no session is a tile saying so with a converge beside it, never a gap in the
   * wall. The distinction matters because the wall is how an operator counts what is up: an absence
   * is indistinguishable from a Machine nobody asked for.
   *
   * ── THE READING IS NEVER COLLAPSED INTO ONE LIGHT ───────────────────────────────────────────────
   *
   * Four health signals, separately readable, and `unknown` never renders as healthy. The case is
   * the round-3 incident: one Machine failing 81 of 82 resource loads while its run reported
   * `completed`, which a single rolled-up indicator would have drawn green.
   */
  import Tile from './Tile.svelte';
  import { Wall } from './wall.svelte';

  const wall = new Wall();
  $effect(() => wall.start());

  let health = $state<{ ok?: boolean; namespace?: string } | undefined>(undefined);
  $effect(() => {
    void fetch('/api/health', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((h) => (health = h as { ok?: boolean; namespace?: string } | undefined))
      .catch(() => (health = undefined));
  });
</script>

<section>
  <header class="top">
    <h1>Monitor</h1>
    <span class="phase" data-phase={wall.phase}>{wall.phase}</span>
    {#if health?.namespace}<span class="tenant mono">{health.namespace}</span>{/if}
  </header>

  <p class="muted">
    a Terminal is a screen, not a log: these panes are <b>read-only</b> and accept no input, and what
    they show is what the Machine's tmux is showing right now.
  </p>

  {#if wall.error}
    <!-- THE STREAMER'S OWN SENTENCE, VERBATIM. A 503 here names the variable an operator has to set,
         which is the difference between "the Dashboard is switched off" and "the streamer is down" —
         two different machines to go and look at. -->
    <p class="err" data-testid="dashboard-error" role="alert">{wall.error}</p>
  {/if}

  {#if wall.terminals.length > 0}
    <div class="wall">
      {#each wall.terminals as t (t.id)}
        <Tile terminal={t} tile={wall.tiles[t.id]} {wall} />
      {/each}
    </div>
  {:else}
    <!-- A PLACEHOLDER TILE, NOT AN EMPTY PAGE. Nothing is streaming and nothing pretends to be: no
         socket was opened, and the wall says which of the two reasons applies. -->
    <div class="pending" data-testid="terminal-pending">
      {#if wall.phase === 'error'}
        No Terminals are being served. The wall is empty because the streamer refused, not because
        the fleet is idle.
      {:else if wall.phase === 'listing' || wall.phase === 'idle'}
        reading the Terminal inventory…
      {:else}
        No Terminals. A Fleet that is up exposes one per Machine.
      {/if}
    </div>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: var(--s-3); }
  .top { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  .phase { font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
  .phase[data-phase='streaming'] { color: var(--ok); }
  .phase[data-phase='error'] { color: var(--bad); }
  .tenant { font-size: var(--t-small); color: var(--dim); margin-left: auto; }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0; line-height: var(--lh-body);
    padding: var(--s-2) var(--s-3); border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent);
    border-radius: var(--radius); overflow-wrap: anywhere;
  }

  /* ONE COLUMN AT PANEL WIDTH, and wider viewports EARN more. A wall that starts at three columns
     and squeezes gives every tile a screen too narrow to read at 390px. */
  .wall { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
  @media (min-width: 760px) { .wall { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1200px) { .wall { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

  .pending {
    font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body);
    padding: var(--s-4) var(--s-3); border: 1px dashed var(--line); border-radius: var(--radius);
    max-width: 62ch;
  }
</style>
