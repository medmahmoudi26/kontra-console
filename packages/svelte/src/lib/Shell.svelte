<script lang="ts">
  import Workspace from './Workspace.svelte';

  /**
   * The console's chrome, designed at ~390px.
   *
   * ── PANEL-FIRST IS A LAYOUT RULE, NOT A BREAKPOINT ──────────────────────────────────────────────
   *
   * The narrow layout is the DEFAULT — no media query produces it — and wider viewports add to it.
   * That inversion is the whole of ADR 0048 §4: a layout that only works when there is room is a bug
   * here, not an unfinished state, and it is unrepresentable if narrow is what the CSS says first.
   *
   * The prototype was built the other way and had 59px of horizontal overflow at 390px from four
   * separate desktop assumptions. None was findable by shrinking; all four are avoided by this.
   *
   * ── NAV WRAPS AND THE CONTEXT HIDES ─────────────────────────────────────────────────────────────
   *
   * Tabs are navigation and survive at every width. The tenant chip is CONTEXT and does not — it was
   * one of the things pushing the prototype's document sideways. Hiding it below the panel width is a
   * decision about what is load-bearing, not a concession.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    view: string;
    views: readonly { id: string; label: string }[];
    tenant?: string;
    onnavigate?: (id: string) => void;
    children: Snippet;
  }
  let { view, views, tenant = 'default', onnavigate, children }: Props = $props();
</script>

<div class="app">
  <nav aria-label="Surfaces">
    <span class="brand">kontra</span>
    {#each views as v (v.id)}
      <!-- `data-testid` AND `data-active` ARE THE E2E SUITE'S GRIP. The specs predate this bundle
           and must pass against it unedited — that is the only evidence a ported surface still
           behaves like the one it replaced — so the hooks they reach for are part of the markup
           rather than something React happened to have. -->
      <button class:on={view === v.id} aria-current={view === v.id ? 'page' : undefined}
              data-testid="nav-{v.id}" data-active={view === v.id ? 'true' : 'false'}
              onclick={() => onnavigate?.(v.id)}>{v.label}</button>
    {/each}
    <span class="spacer"></span>
    <!-- WHICH WORKSPACE, top right, because it decides what every surface below lists. The tenant
         chip sits beside it: one says whose cluster, the other says whose code. -->
    <Workspace />
    <span class="tenant">tenant <b>{tenant}</b></span>
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  /* NARROW FIRST. Everything here is the ~390px layout; the media query below ADDS. */
  .app { padding: var(--s-3) var(--s-3) var(--s-6); }

  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1);
    padding-bottom: var(--s-3);
    margin-bottom: var(--s-4);
    border-bottom: 1px solid var(--line);
  }
  .brand { font-size: var(--t-body); font-weight: 600; margin-right: var(--s-2); }
  nav button {
    font-size: var(--t-small);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--radius);
    border: 1px solid transparent;
    background: none;
    color: var(--dim);
    cursor: pointer;
  }
  nav button.on { color: var(--fg); background: var(--panel); border-color: var(--line); }
  .spacer { flex: 1; }

  /* CONTEXT, not navigation: it goes when there is no room, and it is the default that it has none. */
  .tenant { display: none; font-size: var(--t-small); color: var(--dim); }
  .tenant b { color: var(--fg); font-weight: 500; }

  main { min-width: 0; } /* grid/flex children default to min-width:auto and widen the page */

  /* ── WIDER VIEWPORTS EARN THIS ───────────────────────────────────────────────────────────────── */
  @media (min-width: 720px) {
    .app { padding: var(--s-4) var(--s-5) var(--s-6); max-width: 1180px; margin: 0 auto; }
    .brand { margin-right: var(--s-4); }
    nav button { padding: var(--s-1) var(--s-3); }
    .tenant { display: inline; }
  }
</style>
