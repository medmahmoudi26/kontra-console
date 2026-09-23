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
   * Tabs are navigation and survive at every width. The workspace picker is CONTEXT and does not —
   * it was one of the things pushing the prototype's document sideways. Hiding it below the panel
   * width is a decision about what is load-bearing, not a concession.
   *
   * ── THERE IS NO TENANT CHIP, AND THAT IS THE MODEL ───────────────────────────────────────────
   *
   * This used to print `tenant default` beside the picker. It never had a source: the prop was
   * declared, nothing ever passed it, and the literal `'default'` in its own default value was
   * what every install read. A label that is the same string on every screen it will ever appear
   * on is not information.
   *
   * It is also wrong about the model. One user, one tenant: the INSTALL is the tenant, so naming
   * it on screen is like printing the hostname of the machine you are already sitting at. What
   * varies — and what decides what every surface below lists — is the WORKSPACE, which is the one
   * thing left here.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    view: string;
    views: readonly { id: string; label: string }[];
    onnavigate?: (id: string) => void;
    /**
     * Let a data-dense view use the whole viewport.
     *
     * 1180px is the right cap for PROSE — a form, a run page, anything with paragraphs — because a
     * line longer than about 90 characters is measurably harder to track back to the next one. It
     * is the wrong cap for a TABLE: Datasets renders nine columns, and squeezing them into 1180px
     * is what made the surface feel cramped next to the grid it replaced. A table has no line
     * length to protect.
     */
    wide?: boolean;
    children: Snippet;
  }
  let { view, views, onnavigate, wide = false, children }: Props = $props();
</script>

<div class="app" class:wide>
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
    <!-- WHICH WORKSPACE, top right, because it decides what every surface below lists — and it is
         the only context here, for the reason in the header. -->
    <Workspace />
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


  main { min-width: 0; } /* grid/flex children default to min-width:auto and widen the page */

  /* ── WIDER VIEWPORTS EARN THIS ───────────────────────────────────────────────────────────────── */
  @media (min-width: 720px) {
    .app { padding: var(--s-4) var(--s-5) var(--s-6); max-width: 1180px; margin: 0 auto; }
    /* A table earns the viewport; 2200px still stops it becoming unreadable on an ultrawide. */
    .app.wide { max-width: min(2200px, 96vw); }
    .brand { margin-right: var(--s-4); }
    nav button { padding: var(--s-1) var(--s-3); }
  }
</style>
