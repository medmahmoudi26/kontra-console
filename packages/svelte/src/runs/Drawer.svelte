<script lang="ts">
  /**
   * A panel that slides in from the right, over the page rather than beside it.
   *
   * ── WHY THE EVIDENCE IS BEHIND ONE OF THESE ─────────────────────────────────────────────────────
   *
   * The run page has one region that grows without bound — the steps — and two more that grow as
   * the run produces them: the log rail and the Dataset rows. Stacked in a column, all three push
   * everything under them down for the whole run, so a reader watching one region loses their place
   * every few seconds. Measured on the canary: 1622px of movement over 57 seconds.
   *
   * Capping heights bounds that but cannot remove it — a region that starts as a one-line "nothing
   * yet" and ends as a full table still grows, unless the page reserves space it has no reason to
   * show empty. Taking the two live regions OUT OF THE FLOW does remove it: what is left above is
   * the input and the start time, which are the same at second 1 and second 57.
   *
   * ── IT OVERLAYS AND DOES NOT PUSH ───────────────────────────────────────────────────────────────
   *
   * A drawer that displaced the page would reintroduce exactly the movement it exists to stop. The
   * scrim is what says the page behind is not the thing being read right now, and `body.locked` is
   * what stops the two scroll containers fighting over the wheel.
   *
   * ── THE COST, NAMED ─────────────────────────────────────────────────────────────────────────────
   *
   * Hiding a live feed means somebody can miss it arriving. That is the handle's job, not this
   * component's: it keeps counting while this is shut and marks itself when something landed that
   * nobody has looked at. See `Runs.svelte`.
   *
   * ── AND FOR TWO RELEASES NOTHING IN IT COULD BE SCROLLED ────────────────────────────────────────
   *
   * `.dbody` was `flex: 1; min-height: 0` with no `overflow` at all, so a child taller than the
   * panel was simply PAINTED past the bottom of a `position: fixed` box — off the viewport, with
   * `body.drawer-open { overflow: hidden }` guaranteeing the page underneath could not be scrolled
   * to reach it either. Measured in Chromium at 1280x700 with 40 log lines: the rail rendered 819px
   * of content into a 646px body and the last line's bottom edge landed at y=885 in a 700px window.
   * 185px of it did not exist as far as any wheel, key or scrollbar was concerned, and a real run
   * writes hundreds of lines rather than forty. At 1280x420 the same fixture hid 465px.
   *
   * The reason it was the LOG rail and not the Dataset table is worth keeping, and it is checkable
   * in the file rather than from a measurement: `LogsRail.svelte:159` sizes its own `.scroller`
   * against the VIEWPORT — `height: calc(100vh - 220px)` — which is a perfectly good rule for the
   * full-page rail it was written for and meaningless inside a drawer. The panel is a `position:
   * fixed` box whose height is the panel's, not the window's, so the rail asked for a height derived
   * from something that is not its container and overflowed whenever the two disagreed. The Dataset
   * table never had that problem because its cap (`max-height`) was at least a constant. The fix is
   * a chain of definite heights from the panel down to the scroller, in `Runs.svelte`, which
   * overrides that `calc` with a share of the panel.
   *
   * (An earlier draft of this comment blamed `flex: 1` on `.scroller`. That was wrong and worth
   * recording: `flex: 1` is what `Runs.svelte:1131` now SETS as part of the fix — the comment
   * described its own new declaration as the pre-existing cause.)
   *
   * WHICH LEAVES TWO SCROLLERS ON PURPOSE, and that is not an accident to be tidied away. The inner
   * one (the table, the rail) is what makes `thead { position: sticky }` and the rail's filter bar
   * stay put while rows move under them — sticky only works against the box that is actually
   * scrolling. The outer one, here, is the floor: when the panel is too short to give the inner
   * scroller its `min-height`, the chrome around it (a heading, a wrapped footnote) overflows this
   * box and this box takes the scroll. In the ordinary case it has nothing to do and no second
   * scrollbar appears.
   */
  import type { Snippet } from 'svelte';
  import {
    DEFAULT_WIDTH,
    MIN_WIDTH,
    browserStore,
    clampWidth,
    isSheet,
    maxWidth,
    readWidth,
    widthForKey,
    writeWidth,
  } from './drawerWidth';

  interface Props {
    open: boolean;
    /** Names the dialog for a screen reader — the tab strip is inside `head`. */
    label: string;
    onclose: () => void;
    head: Snippet;
    children: Snippet;
  }
  let { open, label, onclose, head, children }: Props = $props();

  /**
   * The page must not scroll under an open drawer.
   *
   * ON `document.body` AND CLEANED UP ON TEARDOWN. A class left behind by a component that
   * unmounted while open — navigating away with the drawer up — would lock the whole console with
   * nothing on screen to explain it.
   */
  $effect(() => {
    document.body.classList.toggle('drawer-open', open);
    return () => document.body.classList.remove('drawer-open');
  });

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onclose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /* ── HOW WIDE ─────────────────────────────────────────────────────────────────────────────────
   *
   * 620px was hard-coded with no way to change it, which is fine until the thing in the drawer is
   * an eight-column table: the Dataset preview is `white-space: nowrap` by design — a host and an
   * endpoint that wrap are unreadable — so a wide row is read 620px at a time through a sideways
   * scrollbar on a 1280px screen with 660px of run page sitting behind the scrim, unread.
   *
   * The reader's choice is remembered; the viewport only clamps what is DRAWN. See `drawerWidth.ts`
   * for why those are two different numbers.
   */
  let vw = $state(window.innerWidth);
  /** The reader's chosen width, as stored — NOT necessarily what fits in this window. */
  let chosen = $state(readWidth(browserStore()));
  /** Below `SHEET_BELOW` the stylesheet's `94vw` owns the width and there is nothing to drag. */
  const sheet = $derived(isSheet(vw));
  const width = $derived(clampWidth(chosen, vw));

  /**
   * The gesture in flight, or `null`.
   *
   * IT REMEMBERS WHERE THE GRAB STARTED rather than tracking the pointer's absolute position. The
   * handle is 12px wide straddling the edge, so "set the width to the distance from the pointer to
   * the right of the window" would jump the edge by up to 6px the instant the button went down. The
   * offset is preserved by measuring the DELTA from where the drag began.
   */
  let drag = $state<{ id: number; x: number; from: number } | null>(null);

  function grab(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    // POINTER CAPTURE, so the drag survives the pointer leaving a 12px-wide element — which it does
    // immediately, because dragging is the point. It is also what makes one code path serve mouse,
    // pen and touch instead of three sets of listeners.
    el.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, from: width };
    // Stops the browser starting a text selection under the gesture. `touch-action: none` on the
    // handle does the same job for the finger, where the default is to scroll.
    e.preventDefault();
  }

  function move(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.id) return;
    // Right-anchored: pulling the edge LEFT (a smaller clientX) makes the panel WIDER.
    chosen = clampWidth(drag.from + (drag.x - e.clientX), vw);
  }

  /** Persist on release, not on every move — a drag is ~200 pointer events and one preference. */
  function drop(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.id) return;
    drag = null;
    writeWidth(browserStore(), chosen);
  }

  function nudge(e: KeyboardEvent): void {
    const next = widthForKey(e.key, e.shiftKey, width, vw);
    if (next === null) return;
    // The arrows would otherwise be the page's; the page is locked, but Home/End are not.
    e.preventDefault();
    chosen = next;
    writeWidth(browserStore(), next);
  }

  /** The way back from a width you regret, on the gesture everybody already tries. */
  function reset(): void {
    chosen = DEFAULT_WIDTH;
    writeWidth(browserStore(), DEFAULT_WIDTH);
  }
</script>

<!-- The window's width decides whether this is a panel or a sheet, so it has to be a live value and
     not one read once at mount: the console is opened in a 400px IDE panel that gets dragged wider. -->
<svelte:window bind:innerWidth={vw} />

<!-- A CLICK ON THE GROUND CLOSES IT, which is the gesture everybody already has. `aria-hidden`
     because the same job is done by the labelled button inside, and a second focusable "close"
     with no name would be one more tab stop between the reader and the rows. -->
<div class="scrim" class:on={open} aria-hidden="true" onclick={onclose}></div>

<!-- A `div` rather than an `aside`: `role="dialog"` is interactive and a landmark element may not
     take an interactive role. The role is what matters here — it is a dialog, not a sidebar.

     `--drawer-w` is set only when this is a panel. On a sheet the attribute is absent and the
     stylesheet's fallback applies, so the layout that ships if this script never runs is the
     layout the drawer had before it existed. -->
<div
  class="drawer"
  class:open
  class:sizing={drag !== null}
  style={sheet ? undefined : `--drawer-w: ${width}px`}
  role="dialog"
  aria-label={label}
  aria-hidden={open ? 'false' : 'true'}
  data-testid="run-drawer"
>
  {#if open}
    <!-- THE EDGE, AS A CONTROL.

         `separator` is the one ARIA role whose category depends on its own focusability: WAI-ARIA
         1.2 makes it a structure while it is not focusable and a WIDGET — with `aria-valuenow`,
         `aria-valuemin`, `aria-valuemax` and arrow keys — the moment it is. That is exactly what
         this is: the line between the page and the panel, and a thing you can move. The value it
         publishes is the DRAWER'S WIDTH rather than an abstract position, so `aria-valuenow` is a
         number a reader can check against the two ends `Home` and `End` reach.

         It is one more tab stop before the tab strip, which the scrim was deliberately kept from
         being. The difference is that this one does something no other control on the surface does,
         and a resize handle reachable only by pointer is not reachable at all for the people most
         likely to need a wider panel. It is first in the DOM because it is leftmost on screen.

         Not rendered at all when shut: a focusable element inside `aria-hidden="true"` is a tab stop
         into a dialog that is not there. -->
    <!-- The two rules below model the structure half of that role and not the widget half, so a
         `tabindex` and a `keydown` on it read as `tabindex` sprayed onto decoration. Dropping
         either is what would actually break it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    {#if !sheet}
      <div
        class="grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize this drawer"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth(vw)}
        tabindex="0"
        title="Drag to resize · ← → to nudge, with Shift for larger steps · double-click to reset"
        data-testid="drawer-resize"
        onpointerdown={grab}
        onpointermove={move}
        onpointerup={drop}
        onpointercancel={drop}
        onlostpointercapture={drop}
        onkeydown={nudge}
        ondblclick={reset}
      ></div>
    {/if}
    <div class="dhead">{@render head()}</div>
    <div class="dbody" data-testid="drawer-body">{@render children()}</div>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
    z-index: 40;
  }
  .scrim.on { opacity: 1; pointer-events: auto; }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    /* `dvh` FIRST-WINS, `vh` AS THE FALLBACK FOR A BROWSER WITHOUT IT. On a phone `100vh` is the
       viewport with the URL bar hidden, so the bottom ~90px of a `100vh` panel sits under browser
       chrome that is currently on screen — which is the same "cannot reach the last row" complaint
       as the missing overflow, arriving by a different route. */
    height: 100vh;
    height: 100dvh;
    /* 94vw so it is a sheet on a phone and a panel on a desktop, with one rule. `--drawer-w` is the
       reader's remembered width and is only ever set above 660px (`SHEET_BELOW`), where the JS has
       already clamped it under this same 94% — so the `min()` is a guarantee, not a mechanism. */
    width: min(var(--drawer-w, 620px), 94vw);
    z-index: 50;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: -18px 0 44px rgb(0 0 0 / 50%);
    transform: translateX(100%);
    transition: transform 200ms cubic-bezier(0.32, 0.72, 0.35, 1);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .drawer.open { transform: none; }
  /* Selecting the panel's text is not what a drag of its edge is for. */
  .drawer.sizing { user-select: none; }

  /*
   * THE HANDLE: a 12px target, a 2px mark.
   *
   * Centred ON the border rather than inside the panel, so half of it hangs over the scrim and the
   * edge is grabbable from either side. 12px is the width; the line that appears under the pointer
   * is 2px, because a permanently-visible drag rail on a panel most people never resize is chrome
   * competing with the rows.
   *
   * REDUCED MOTION IS ALREADY HANDLED, and not here: `tokens.css` clamps every `transition-duration`
   * in the bundle to 0.01ms under `prefers-reduced-motion: reduce`, with `!important`, which covers
   * the slide, the scrim and the mark below. Restating it in this file would be a second place for
   * it to drift out of. What that rule deliberately does NOT cover is width, and width is not
   * transitioned at any setting: a drag is direct manipulation and easing it means the edge lags the
   * finger holding it.
   */
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 12px;
    transform: translateX(-50%);
    cursor: col-resize;
    /* Without this a touch drag on the edge is claimed by the scroller as a pan and the panel never
       moves. Pointer capture cannot recover a gesture the browser has already taken. */
    touch-action: none;
    z-index: 1;
  }
  .grip::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: transparent;
    transition: background-color 120ms ease;
  }
  .grip:hover::after,
  .grip:focus-visible::after,
  .sizing .grip::after {
    background: var(--accent);
  }

  .dhead {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
  }
  .dbody {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) var(--s-4);
    /* THE SCROLLER OF LAST RESORT — see the header. In the ordinary case the region inside fills
       this box exactly and nothing here scrolls; this is what catches the heading and the wrapped
       footnote when the panel is shorter than the inner scroller's own `min-height`. */
    overflow-y: auto;
    /* NEVER SIDEWAYS. Wide content is the Dataset table's problem and it solves it in its own box
       (`.tbl-wrap`, `overflow: auto`); a second horizontal scrollbar here would mean a row could be
       scrolled out from under its own sticky header. `overflow-y: auto` alone would compute the x
       axis to `auto` as well, so it is pinned explicitly. */
    overflow-x: hidden;
    /* The page behind is already `overflow: hidden`, but that does not stop a touch overscroll from
       chaining into the browser's own pull-to-refresh at the top of the list. */
    overscroll-behavior: contain;
  }
</style>
