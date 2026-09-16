<script lang="ts">
  /**
   * One Terminal: a screen, its geometry, its health, and the two things an operator may do to it.
   *
   * ── xterm IS A MOUNT, NOT A PORT ────────────────────────────────────────────────────────────────
   *
   * It attaches to a DOM element and has no framework in it. So this component is the element, the
   * lifecycle and the measurement — and `applyFrame`, which decides repaint-or-append, comes from
   * `@kontra/console-core/panels/frames` unchanged. The rule is a property of the wire.
   *
   * ── THE MEASUREMENT IS LOAD-BEARING ─────────────────────────────────────────────────────────────
   *
   * `addon-fit` measures what the tile can actually show, and that measurement is what the streamer
   * `stty`s before attaching. A tile mounted before layout — or inside a hidden parent — measures
   * 0×0, typechecks, renders a rectangle and shows nothing forever, so the measured size is
   * published as `data-cols`/`data-rows` where a browser test can assert it.
   *
   * ── READ-ONLY IS THE SURFACE, NOT THE TERMINAL ──────────────────────────────────────────────────
   *
   * `disableStdin` is xterm's own guard and it is defence in depth. The boundary is that no message
   * this page can send carries bytes for a session (ADR 0020 finding 3 — a read-only tmux client is
   * not read-only; both `run-shell` and `send-keys` executed as root through one).
   */
  import { applyFrame, holdsRepaint, SCROLLBACK_LINES } from '@kontra/console-core/panels/frames';
  import { healthEntries, type Terminal } from '@kontra/console-core/panels/panelsClient';
  import { leadingFinding, leadingUnmeasured } from '@kontra/console-core/panels/health';
  import { barTone } from '@kontra/console-core/panels/statusTone';
  import { tileRefFor } from '@kontra/console-core/panels/chrome/tileRef';
  import { readOnlyTerminalOptions } from '@kontra/console-core/panels/terminalOptions';

  import type { TileState, Wall } from './wall.svelte';

  interface Props {
    terminal: Terminal;
    tile: TileState | undefined;
    wall: Wall;
  }
  let { terminal, tile, wall }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let article: HTMLElement | undefined = $state();
  let cols = $state(0);
  let rows = $state(0);
  let menu = $state(false);
  let drawer = $state(false);

  const mode = $derived(tile?.mode ?? 'snapshot');
  /**
   * The EXECUTION mode — fleet, docker or local — which decides which health signals can say
   * anything at all. It is not on the wire: `tileRefFor` reads it out of the Terminal id, which is
   * where it has always been (`chrome/tileRef.ts` records why the streamer does not send it).
   *
   * NOT the same `mode` as the feed above, and the collision is the streamer's vocabulary rather
   * than a choice here — one says how bytes arrive, the other says what kind of Machine they came
   * from, and swapping them would silently drop two signals off every fleet tile.
   */
  const where = $derived(tileRefFor(terminal).mode);
  const health = $derived(
    tile?.health ?? { reachable: 'unknown' as const, session: 'unknown' as const, poller: 'unknown' as const, loads: 'unknown' as const }
  );
  /** A Machine that is up with no session is still a tile — never an absence. */
  const sessionGone = $derived(health.session === 'absent' || health.session === 'no-tmux');
  const finding = $derived(leadingFinding(health, where));
  const unmeasured = $derived(leadingUnmeasured(health, where));
  const tone = $derived(
    barTone({
      process: health.process,
      feed: mode,
      stale: false,
      frameAgeMs: null,
      failing: finding !== undefined,
      unmeasured: unmeasured !== undefined,
    })
  );
  const entries = $derived(healthEntries(health, where));

  $effect(() => {
    const element = host;
    if (!element) return;
    let term: import('@xterm/xterm').Terminal | undefined;
    let fit: import('@xterm/addon-fit').FitAddon | undefined;
    let observer: ResizeObserver | undefined;
    let detach = (): void => {};
    let disposed = false;

    // LAZY, because xterm and its fit addon are ~250 KB and only the Monitor needs them. A static
    // import here would put them in every surface's entry.
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      /**
       * xterm's OWN STYLESHEET, and leaving it out is why every pane was blank.
       *
       * The DOM renderer writes one absolutely-positioned `<div>` per row and depends entirely on
       * this file for the metrics that place them: without it the rows exist, carry the right text,
       * and are drawn at zero size on top of each other. Measured on the live wall — 116 of 180
       * rows had text in the DOM and the screen showed nothing, which reads as "the stream is
       * broken" and sent me looking at the socket.
       *
       * Imported HERE rather than in the entry so it travels with the chunk that needs it.
       */
      import('@xterm/xterm/css/xterm.css'),
    ]).then(([xterm, addon]) => {
      if (disposed) return;
      term = new xterm.Terminal(
        readOnlyTerminalOptions({
          fontSize: 11,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          scrollback: SCROLLBACK_LINES,
          theme: { background: '#0b0f14', foreground: '#dbe5ef' },
        })
      );
      fit = new addon.FitAddon();
      term.loadAddon(fit);
      term.open(element);

      /**
       * PUBLISH WHAT THE TERMINAL SAYS, NOT WHAT WAS MEASURED BEFORE IT SETTLED.
       *
       * `onResize` fires whenever xterm's own dimensions change — including changes this code did
       * not cause, and including the ones that land a frame after `fit()` returns. Reading
       * `term.cols` straight after a fit reported 34 rows while the DOM renderer had drawn 37: the
       * attribute was a claim about a moment that had already passed, and the streamer was told to
       * `stty` a screen three rows shorter than the one on screen.
       */
      const publish = (c: number, r: number): void => {
        cols = c;
        rows = r;
        // WRITTEN SYNCHRONOUSLY, not left to the next render. Reactive state flushes on a microtask
        // and the wall reflows as tiles arrive, so for a frame or two the attribute said 34 while
        // the renderer had already drawn 37 rows. Anything reading the two together — a browser
        // test, or a person comparing the badge to the screen — sees a tile lying about its size.
        article?.setAttribute('data-cols', String(c));
        article?.setAttribute('data-rows', String(r));
        // 0×0 IS NEVER PUBLISHED. Subscribing at zero asks a Machine for a zero-sized screen, and
        // the streamer would `stty 0 0` before attaching.
        if (c > 0 && r > 0) wall.measured(terminal.id, c, r);
      };
      term.onResize(({ cols: c, rows: r }) => publish(c, r));

      const measure = (): void => {
        if (!term || !fit) return;
        try {
          fit.fit();
        } catch {
          // A tile that is not laid out yet cannot be fitted; the observer fires again when it is.
          return;
        }
        // A fit that changed nothing fires no `onResize`, so the first geometry is published here.
        publish(term.cols, term.rows);
      };
      measure();
      // FIT AGAIN ON THE NEXT FRAME. `term.open()` has not measured a cell yet when it returns, so
      // the first fit is against an estimate; the second is against the real one.
      requestAnimationFrame(measure);
      observer = new ResizeObserver(() => measure());
      observer.observe(element);

      detach = wall.attach(terminal.id, (bytes) => {
        if (!term) return;
        // HELD WHILE SOMEBODY IS READING BACK. A repaint calls `reset()`, which throws the
        // scrollback away — so a wall that repainted unconditionally pulled an operator back to the
        // tail faster than they could read a line.
        const scrolledBack = term.buffer.active.baseY - term.buffer.active.viewportY;
        if (holdsRepaint(bytes, scrolledBack)) return;
        applyFrame(
          {
            reset: () => term?.reset(),
            write: (payload: Uint8Array) => term?.write(payload),
          },
          bytes
        );
      });
    });

    return () => {
      disposed = true;
      detach();
      observer?.disconnect();
      term?.dispose();
    };
  });
</script>

<article
  bind:this={article}
  class="tile"
  data-testid="terminal-{terminal.id}"
  data-mode={mode}
  data-cols={cols}
  data-rows={rows}
>
  <header>
    <span class="machine mono">{terminal.machine}</span>
    <span class="who mono">{terminal.actor}{terminal.version ? `@${terminal.version}` : ''}</span>
    <button
      class="menu"
      data-testid="tile-menu-{terminal.id}"
      aria-expanded={menu}
      aria-label="what this tile knows"
      onclick={() => (menu = !menu)}
    >⋯</button>
    {#if menu}
      <div class="pop" role="menu">
        <button data-testid="tile-menu-drawer-{terminal.id}" onclick={() => { drawer = true; menu = false; }}>
          health and identity
        </button>
      </div>
    {/if}
  </header>

  <!-- THE SCREEN IS ALWAYS MOUNTED, even with no session: xterm has to be laid out to measure, and a
       tile that only mounts once bytes arrive can never report the geometry that would bring them. -->
  <div class="screen" bind:this={host}></div>

  {#if sessionGone}
    <div class="empty" data-testid="tile-empty-{terminal.id}">
      <p>no session on {terminal.machine}</p>
      <!-- THE AFFORDANCE CARRIES THE ID. On a wall, a converge reachable only by its accessible name
           would be ambiguous between Machines. -->
      <button data-testid="converge-{terminal.id}" onclick={() => wall.converge(terminal.id)}>
        converge to create it
      </button>
    </div>
  {/if}

  <footer
    class="status"
    data-testid="tile-status-{terminal.id}"
    data-tone={tone}
    data-finding={finding?.signal}
  >
    <span class="word">{mode === 'snapshot' ? 'snapshots' : mode === 'live' ? 'live' : 'error'}</span>
    <span class="size mono">{cols}×{rows}</span>
    {#if finding}
      <span class="says" title={finding.text}>▲ {finding.label}</span>
    {:else if unmeasured}
      <!-- NOT GREEN. `unknown` must never render as healthy: a pane whose poller was never measured
           is not a pane that was checked and found fine. -->
      <span class="says" title={unmeasured.text}>? {unmeasured.label}</span>
    {/if}
    {#if tile && tile.elided > 0}<span class="says">{tile.elided} B elided</span>{/if}
  </footer>

  {#if drawer}
    <div class="drawer" data-testid="detail-{terminal.id}">
      <header>
        <b>{terminal.id}</b>
        <button onclick={() => (drawer = false)} aria-label="close">✕</button>
      </header>
      <dl>
        <dt>machine</dt><dd class="mono">{terminal.machine}</dd>
        <dt>host</dt><dd class="mono">{terminal.host}{terminal.publicIp ? ` (${terminal.publicIp})` : ''}</dd>
        <dt>session</dt><dd class="mono">{terminal.window || '—'}</dd>
        {#if terminal.paneCols}<dt>pane</dt><dd class="mono">{terminal.paneCols}×{terminal.paneRows}</dd>{/if}
        {#if terminal.exitStatus}<dt>exit</dt><dd class="mono">{terminal.exitStatus}</dd>{/if}
        <dt>scrollback</dt><dd class="mono">{SCROLLBACK_LINES} lines</dd>
      </dl>
      <!-- FOUR SIGNALS, ONE SENTENCE EACH, never collapsed into one light. The round-3 incident —
           81 of 82 loads failing while the run reported `completed` — is what that rule is for. -->
      <ul class="signals">
        {#each entries as e (e.signal)}
          <li data-signal={e.signal} data-ok={e.ok === null ? 'unknown' : String(e.ok)}>{e.text}</li>
        {/each}
      </ul>
    </div>
  {/if}
</article>

<style>
  .tile {
    position: relative; display: flex; flex-direction: column; min-width: 0;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    overflow: hidden;
  }
  header { display: flex; align-items: baseline; gap: var(--s-2); padding: var(--s-1) var(--s-2); border-bottom: 1px solid var(--line); }
  .machine { font-size: var(--t-small); color: var(--fg); overflow-wrap: anywhere; }
  .who { font-size: var(--t-micro); color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu { margin-left: auto; background: none; border: 0; color: var(--dim); cursor: pointer; font-size: var(--t-small); padding: 0 var(--s-1); }
  .pop {
    position: absolute; right: var(--s-2); top: 26px; z-index: 2;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  }
  .pop button { background: none; border: 0; color: var(--fg); font-size: var(--t-small); padding: var(--s-2) var(--s-3); cursor: pointer; white-space: nowrap; }

  /* A FIXED HEIGHT, AND THAT IS NOT A STYLE CHOICE.
     240px IS A SCREEN, NOT A STRIP: below about that an 80-column pane wraps into unreadability.
     It is fixed rather than `flex: 1` because the tile's CONTENT arrives later — a `state` frame
     saying the session is gone used to add a block, which changed the grid row's height, which
     refitted every terminal in that row. A terminal that resizes is a terminal that re-`stty`s a
     live attach, and on screen it is the operator's output jumping while they read it. Nothing
     below the screen may change its size. */
  .screen { height: 240px; min-width: 0; overflow: hidden; padding: var(--s-1); }

  /* OVER THE SCREEN, NOT BELOW IT. A sibling would change the tile's height the moment a session
     went away — see `.screen`. The pane underneath is the last thing that Machine showed, which is
     worth keeping visible behind the words. */
  .empty {
    position: absolute; left: 0; right: 0; bottom: 28px;
    display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-2);
    padding: var(--s-2) var(--s-3); border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--panel) 92%, transparent);
  }
  .empty p { margin: 0; font-size: var(--t-small); color: var(--warn); }
  .empty button {
    font-size: var(--t-small); padding: var(--s-1) var(--s-3); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); cursor: pointer;
  }

  .status {
    display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap;
    padding: var(--s-1) var(--s-2); border-top: 1px solid var(--line); font-size: var(--t-micro);
    color: var(--dim); background: var(--track);
  }
  .status[data-tone='ok'] { color: var(--ok); }
  .status[data-tone='warn'] { color: var(--warn); }
  .status[data-tone='bad'] { color: var(--bad); }
  .status[data-tone='unmeasured'] { color: var(--dim); }
  .size { margin-left: auto; }
  .says { width: 100%; overflow-wrap: anywhere; }

  .drawer {
    position: absolute; inset: 0; z-index: 3; overflow-y: auto;
    background: var(--panel); padding: var(--s-3);
    display: flex; flex-direction: column; gap: var(--s-3);
  }
  .drawer header { border: 0; padding: 0; }
  .drawer header button { margin-left: auto; background: none; border: 0; color: var(--dim); cursor: pointer; }
  .drawer b { font-size: var(--t-small); overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3); margin: 0; }
  dt { font-size: var(--t-small); color: var(--dim); }
  dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  .signals { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  .signals li { font-size: var(--t-small); line-height: var(--lh-body); overflow-wrap: anywhere; }
  .signals li[data-ok='false'] { color: var(--bad); }
  .signals li[data-ok='unknown'] { color: var(--warn); }
</style>
