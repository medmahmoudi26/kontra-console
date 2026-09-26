/**
 * How wide the run drawer is. Arithmetic only — no DOM, no component, no layout.
 *
 * ── WHY THIS IS NOT IN `Drawer.svelte` ──────────────────────────────────────────────────────────
 *
 * Everything here is a decision with an edge on it: what a stored value of `"nope"` means, what
 * happens to a 1200px preference opened in a 390px IDE panel, which way an arrow key moves a panel
 * that is anchored to the RIGHT. None of that is geometry, and none of it needs a browser to be
 * wrong. The geometry — that the panel actually ends up that wide — does, and is asserted in
 * `e2e/runs.spec.ts`, because jsdom reports `clientHeight === 0` for every element and would pass a
 * drawer rendered at zero by zero.
 *
 * ── THE STORED WIDTH IS THE CHOICE, NOT THE APPLIED WIDTH ───────────────────────────────────────
 *
 * `readWidth` deliberately does not clamp and `clampWidth` deliberately does not read. A reader who
 * drags to 1200px at their desk and then opens the same console in a 390px panel must get a sheet
 * there AND their 1200px back when they go home; if the viewport clamped what is STORED, the trip
 * through the narrow window would quietly destroy the preference. So the viewport clamps only what
 * is drawn, on every render, and the number in storage is left alone until the reader moves the
 * handle again.
 */

/** What the drawer has always been (`min(620px, 94vw)`), and what a double-click returns to. */
export const DEFAULT_WIDTH = 620;

/**
 * The narrowest it may be dragged.
 *
 * Under this the Dataset table stops being a table. Its cells are `white-space: nowrap`, and
 * measured in Chromium against the fixture in `e2e/runs.spec.ts` — `host-00.vonage.example` and
 * `/api/v2/resource/0/detail` at 12px mono — those two columns are 182px and 206px. A 320px drawer
 * spends 34px on its own padding and border and shows 286px of table, so it is already less than
 * the first two columns; there is no width below this where narrowing buys anything but scrollbar.
 * 320px is also the narrowest viewport `scripts/overflow.mjs` asserts, which makes it the width
 * below which nothing in this console claims to work.
 */
export const MIN_WIDTH = 320;

/**
 * The most of the window it may take.
 *
 * 94%, which is the number the stylesheet has always used, and the 6% is load-bearing: a strip of
 * the page left showing is half of what says this is a panel OVER the run rather than a new page.
 * The scrim says the other half.
 */
export const MAX_SHARE = 0.94;

/**
 * Below this viewport width the drawer is a full-width sheet and there is no edge to drag.
 *
 * 660 is not a taste: it is where `min(620px, 94vw)` changes hands. 620 / 0.94 = 659.6, so at any
 * narrower window the drawer was ALREADY pinned to 94vw before this file existed. Above it a handle
 * moves a real edge; below it, it would be a control that visibly does nothing — which is worse
 * than not offering one.
 */
export const SHEET_BELOW = 660;

/** Where the reader's choice is kept. Namespaced: this console will remember other widths. */
export const WIDTH_KEY = 'kontra.console.run-drawer.width';

/**
 * A sheet, so: no handle, and the stylesheet's own `94vw` owns the width.
 *
 * Written as a negated `>=` so that a viewport we could not measure — `NaN` — answers "sheet". The
 * fallback has to be the one that needs nothing from JavaScript to look right.
 */
export function isSheet(vw: number): boolean {
  return !(vw >= SHEET_BELOW);
}

/**
 * The widest the drawer may be drawn at this viewport, and what `aria-valuemax` reports.
 *
 * Floored, because the value is also written into a `px` length and a fractional one would make
 * `aria-valuenow` and the measured width disagree by a subpixel forever. The `max` against
 * `MIN_WIDTH` is not reachable above `SHEET_BELOW` (660 x 0.94 = 620 > 320); it is there so the
 * range handed to `clampWidth` is never inverted if this is ever called for a phone.
 */
export function maxWidth(vw: number): number {
  return Math.max(MIN_WIDTH, Math.floor(vw * MAX_SHARE));
}

/** The width to actually draw: the reader's choice, held inside what this window can hold. */
export function clampWidth(px: number, vw: number): number {
  const ceiling = maxWidth(vw);
  if (!Number.isFinite(px)) return Math.min(DEFAULT_WIDTH, ceiling);
  return Math.min(Math.max(Math.round(px), MIN_WIDTH), ceiling);
}

/**
 * What an arrow key on the focused separator does, or `null` for a key this is not about.
 *
 * LEFT WIDENS. The drawer is anchored to the right edge of the window, so the edge the handle sits
 * on is its LEFT one and pushing that left is the gesture that makes the panel bigger. Getting this
 * backwards would be the kind of bug that reads as "the keyboard is broken" rather than as a
 * direction, so it is stated here rather than inferred at the call site.
 *
 * 16px, or 64px with Shift — a `--s-4` and four of them. A 1px step would take 883 presses to cross
 * the range; a 100px step cannot land on a width anybody wanted.
 *
 * `Home` and `End` are the two ends of the reported VALUE, which is the drawer's width — Home is
 * `aria-valuemin`, End is `aria-valuemax`. Mapping them to "separator furthest left / right"
 * instead would put End at the minimum width and contradict the values the element publishes.
 */
export function widthForKey(key: string, coarse: boolean, current: number, vw: number): number | null {
  const step = coarse ? 64 : 16;
  if (key === 'ArrowLeft') return clampWidth(current + step, vw);
  if (key === 'ArrowRight') return clampWidth(current - step, vw);
  if (key === 'Home') return clampWidth(MIN_WIDTH, vw);
  if (key === 'End') return clampWidth(maxWidth(vw), vw);
  return null;
}

/** The two methods of `Storage` this needs, so a test can hand it something that is not one. */
export interface WidthStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `localStorage`, or `null` where there isn't one.
 *
 * The property ACCESS is inside the `try`, not just the call: in a blocked third-party context
 * Chrome throws a `SecurityError` on reading `window.localStorage` itself, so `'localStorage' in
 * window` is not a guard. A drawer that cannot remember its width is a small loss; a drawer that
 * throws on mount and takes the whole run record with it is not.
 */
export function browserStore(): WidthStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The remembered choice, UNCLAMPED — see the header. Anything that is not a positive finite number
 * is the default: an absent key, a key some other version of this console wrote, a key a person
 * edited by hand. `Number('')` is 0 and `Number('  ')` is 0, which is why the blank check comes
 * first — otherwise an empty string would restore as `MIN_WIDTH` and look like a deliberate choice.
 */
export function readWidth(store: WidthStore | null): number {
  if (store === null) return DEFAULT_WIDTH;
  let raw: string | null;
  try {
    raw = store.getItem(WIDTH_KEY);
  } catch {
    return DEFAULT_WIDTH;
  }
  if (raw === null || raw.trim() === '') return DEFAULT_WIDTH;
  const px = Number(raw);
  return Number.isFinite(px) && px > 0 ? Math.round(px) : DEFAULT_WIDTH;
}

/** Remember it. Writing can throw too — a full quota, a disabled store — and it is never worth a
 *  broken drawer, so the failure is swallowed and the session keeps the width it has. */
export function writeWidth(store: WidthStore | null, px: number): void {
  if (store === null || !Number.isFinite(px)) return;
  try {
    store.setItem(WIDTH_KEY, String(Math.round(px)));
  } catch {
    /* quota, private mode, a store that is present and refuses. The width still applies. */
  }
}
