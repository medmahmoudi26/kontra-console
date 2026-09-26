/**
 * The run drawer's width, as arithmetic.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT. Not one pixel of rendered geometry — jsdom has no layout
 * engine, every `clientHeight` in it is 0, and a test here claiming the drawer "is 880px wide"
 * would be describing a number this module returned rather than anything a person could see. That
 * claim lives in `e2e/runs.spec.ts`, in Chromium, against `boundingBox()`. What is left is the part
 * that is genuinely arithmetic and genuinely has edges: the clamp, the storage round-trip, the
 * direction an arrow key moves a panel that is anchored to the right.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDTH,
  MAX_SHARE,
  MIN_WIDTH,
  SHEET_BELOW,
  WIDTH_KEY,
  clampWidth,
  isSheet,
  maxWidth,
  readWidth,
  widthForKey,
  writeWidth,
  type WidthStore,
} from './drawerWidth';

/** A `Storage` that is only the two methods this needs, so a test can make either one misbehave. */
function fakeStore(seed: Record<string, string> = {}): WidthStore & { seen: Record<string, string> } {
  const seen = { ...seed };
  return {
    seen,
    getItem: (k) => seen[k] ?? null,
    setItem: (k, v) => {
      seen[k] = v;
    },
  };
}

describe('isSheet', () => {
  it('is a panel from 660px up and a sheet below it', () => {
    // 660 is where `min(620px, 94vw)` changes hands: 620 / 0.94 = 659.6.
    expect(isSheet(SHEET_BELOW)).toBe(false);
    expect(isSheet(1280)).toBe(false);
    expect(isSheet(SHEET_BELOW - 1)).toBe(true);
    expect(isSheet(390)).toBe(true);
    expect(isSheet(320)).toBe(true);
  });

  it('calls a viewport it could not measure a sheet', () => {
    // The fallback has to be the layout that needs nothing from this module to look right — which
    // is the stylesheet's own `94vw`, i.e. a sheet with no handle.
    expect(isSheet(Number.NaN)).toBe(true);
  });
});

describe('clampWidth', () => {
  it('leaves a width the window can hold alone', () => {
    expect(clampWidth(880, 1280)).toBe(880);
    expect(clampWidth(DEFAULT_WIDTH, 1280)).toBe(DEFAULT_WIDTH);
  });

  it('never collapses and never swallows the window', () => {
    expect(clampWidth(0, 1280)).toBe(MIN_WIDTH);
    expect(clampWidth(-500, 1280)).toBe(MIN_WIDTH);
    // 94% of 1280 is 1203.2, floored — a fractional ceiling would put `aria-valuenow` a subpixel
    // away from the measured width for good.
    expect(clampWidth(99_999, 1280)).toBe(1203);
    expect(maxWidth(1280)).toBe(1203);
  });

  it('keeps the range the right way up on a viewport narrower than the minimum', () => {
    // 320 x 0.94 = 300, which is below MIN_WIDTH. The drawer is a sheet at that width and this is
    // never asked, but an inverted range would make `clampWidth` return the wrong end of it.
    expect(maxWidth(320)).toBe(MIN_WIDTH);
    expect(clampWidth(900, 320)).toBe(MIN_WIDTH);
  });

  it('answers the default for a width that is not a number', () => {
    expect(clampWidth(Number.NaN, 1280)).toBe(DEFAULT_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY, 1280)).toBe(DEFAULT_WIDTH);
  });

  it('rounds, because the result is written into a px length', () => {
    expect(clampWidth(880.4, 1280)).toBe(880);
    expect(clampWidth(880.6, 1280)).toBe(881);
  });

  it('holds the stored preference against the viewport without changing it', () => {
    // The trip through a narrow window must not cost the reader their choice: the SAME input
    // answers 1203 on a desktop and the sheet's floor on a phone, because nothing here writes.
    const chosen = 1200;
    expect(clampWidth(chosen, 1280)).toBe(1200);
    expect(clampWidth(chosen, 390)).toBe(Math.floor(390 * MAX_SHARE));
    expect(clampWidth(chosen, 1280)).toBe(1200);
  });
});

describe('widthForKey', () => {
  it('widens on ArrowLeft, because the panel is anchored to the right', () => {
    expect(widthForKey('ArrowLeft', false, 620, 1280)).toBe(636);
    expect(widthForKey('ArrowRight', false, 620, 1280)).toBe(604);
  });

  it('steps four times as far with Shift', () => {
    expect(widthForKey('ArrowLeft', true, 620, 1280)).toBe(684);
    expect(widthForKey('ArrowRight', true, 620, 1280)).toBe(556);
  });

  it('sends Home and End to the two ends it publishes as valuemin and valuemax', () => {
    expect(widthForKey('Home', false, 620, 1280)).toBe(MIN_WIDTH);
    expect(widthForKey('End', false, 620, 1280)).toBe(maxWidth(1280));
  });

  it('stops at the ends rather than running past them', () => {
    expect(widthForKey('ArrowRight', true, MIN_WIDTH, 1280)).toBe(MIN_WIDTH);
    expect(widthForKey('ArrowLeft', true, maxWidth(1280), 1280)).toBe(maxWidth(1280));
  });

  it('answers null for a key it is not about, so the event keeps its default', () => {
    // The separator is inside a dialog that closes on Escape and a strip that is navigated by Tab.
    // Swallowing either would trade a resize handle for a drawer nobody can leave.
    for (const key of ['Escape', 'Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) {
      expect(widthForKey(key, false, 620, 1280)).toBeNull();
    }
  });
});

describe('readWidth / writeWidth', () => {
  it('round-trips a chosen width', () => {
    const store = fakeStore();
    writeWidth(store, 880);
    expect(store.seen[WIDTH_KEY]).toBe('880');
    expect(readWidth(store)).toBe(880);
  });

  it('writes a whole number of pixels', () => {
    const store = fakeStore();
    writeWidth(store, 880.6);
    expect(store.seen[WIDTH_KEY]).toBe('881');
  });

  it('stores the CHOICE and not what fitted — the read does not clamp', () => {
    // The whole reason `readWidth` and `clampWidth` are two functions. A 4000px value is nonsense
    // to DRAW and is still the number that came back, so that the caller — not storage — decides
    // what this window can hold.
    expect(readWidth(fakeStore({ [WIDTH_KEY]: '4000' }))).toBe(4000);
  });

  it('answers the default for anything that is not a positive number', () => {
    // An absent key, a key some other version of this console wrote, a key edited by hand. `''`
    // and `'   '` are called out because `Number('')` is 0, which would otherwise restore as
    // MIN_WIDTH and look exactly like a deliberate choice.
    expect(readWidth(fakeStore())).toBe(DEFAULT_WIDTH);
    for (const raw of ['', '   ', 'nope', 'NaN', '0', '-40', 'Infinity']) {
      expect(readWidth(fakeStore({ [WIDTH_KEY]: raw }))).toBe(DEFAULT_WIDTH);
    }
  });

  it('survives a store that throws on either method', () => {
    // Safari's private mode and a blocked third-party context both do this. A drawer that cannot
    // remember its width is a small loss; one that throws and takes the run record down is not.
    const hostile: WidthStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readWidth(hostile)).toBe(DEFAULT_WIDTH);
    expect(() => writeWidth(hostile, 880)).not.toThrow();
  });

  it('survives having no store at all', () => {
    expect(readWidth(null)).toBe(DEFAULT_WIDTH);
    expect(() => writeWidth(null, 880)).not.toThrow();
  });

  it('refuses to store a width that is not a number', () => {
    const store = fakeStore();
    writeWidth(store, Number.NaN);
    expect(store.seen[WIDTH_KEY]).toBeUndefined();
  });
});
