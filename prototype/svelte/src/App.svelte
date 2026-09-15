<script>
  /**
   * The shell: three surfaces and the clock that drives the simulation.
   *
   * ONE `requestAnimationFrame` LOOP FOR THE WHOLE APP. The timeline is the only thing that needs
   * to move, and it moves by writing two or three fields per frame — so there is no interval per
   * component and no polling. That is the shape the real console should have against the SSE run
   * stream: one source of change, everything else derived.
   */
  import Workflows from './pages/Workflows.svelte';
  import Actors from './pages/Actors.svelte';
  import Runner from './pages/Runner.svelte';
  import { app, tick } from './lib/model.svelte.js';

  const VIEWS = [
    { id: 'workflows', label: 'Workflows' },
    { id: 'actors', label: 'Actors' },
    { id: 'runner', label: 'Runner' },
  ];

  $effect(() => {
    let raf, last = performance.now();
    const loop = (t) => {
      tick(Math.min(t - last, 100)); // clamp, so a backgrounded tab does not jump the run to the end
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="app">
  <nav>
    <div class="brand">kontra <span>svelte prototype</span></div>
    {#each VIEWS as v (v.id)}
      <button class:on={app.view === v.id} onclick={() => (app.view = v.id)}>{v.label}</button>
    {/each}
    <div class="spacer"></div>
    <span class="tenant">tenant <b>default</b></span>
  </nav>

  <main>
    {#if app.view === 'workflows'}<Workflows />
    {:else if app.view === 'actors'}<Actors />
    {:else}<Runner />{/if}
  </main>
</div>

<style>
  .app { max-width: 1180px; margin: 0 auto; padding: 18px 20px 48px; }
  nav { display: flex; align-items: center; gap: 4px; padding-bottom: 14px; margin-bottom: 18px;
        border-bottom: 1px solid var(--line); }
  .brand { font-size: 13px; font-weight: 600; margin-right: 16px; }
  .brand span { color: var(--dim); font-weight: 400; font-size: 11px; margin-left: 6px; }
  nav button { font-size: 12px; padding: 5px 11px; border-radius: 6px; border: 1px solid transparent;
               background: none; color: var(--dim); cursor: pointer; }
  nav button.on { color: var(--fg); background: var(--panel); border-color: var(--line); }
  .spacer { flex: 1; }
  .tenant { font-size: 11px; color: var(--dim); }
  .tenant b { color: var(--fg); font-weight: 500; }

  /* ── PHONE ────────────────────────────────────────────────────────────────────────────────
     The brand's subtitle and the tenant chip together were wider than the three tabs they sat
     beside, so the nav row pushed the document sideways. Both are context, not navigation. */
  @media (max-width: 560px) {
    .app { padding: 14px 12px 40px; }
    nav { flex-wrap: wrap; gap: 6px; }
    .brand { margin-right: 8px; font-size: 12px; }
    .brand span, .tenant { display: none; }
    nav button { padding: 5px 9px; }
  }
</style>
