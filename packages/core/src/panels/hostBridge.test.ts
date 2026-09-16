import { describe, expect, it } from 'vitest';
import { __test } from './hostBridge';

describe('host-delivered paste', () => {
  it('accepts only the one message shape', () => {
    expect(__test.isHostPaste({ type: 'kontra.paste', text: 'x' })).toBe(true);
    // Everything else on this channel must be ignored — the webview relays its host's traffic too.
    expect(__test.isHostPaste({ type: 'other', text: 'x' })).toBe(false);
    expect(__test.isHostPaste({ type: 'kontra.paste' })).toBe(false);
    expect(__test.isHostPaste({ type: 'kontra.paste', text: 7 })).toBe(false);
    expect(__test.isHostPaste(null)).toBe(false);
    expect(__test.isHostPaste('kontra.paste')).toBe(false);
  });

  it('replaces the selection and leaves the caret after the insert', () => {
    const el = document.createElement('input');
    el.value = 'ab';
    el.setSelectionRange(1, 1);
    __test.insert(el, 'XY');
    expect(el.value).toBe('aXYb');
    expect(el.selectionStart).toBe(3);
  });

  it('fires a bubbling input event, which is what a React field listens for', () => {
    // Assigning `.value` alone leaves React's tracker stale and the text is reverted on next
    // render. This assertion is the one that catches that regression.
    const el = document.createElement('input');
    let bubbled = false;
    el.addEventListener('input', (e) => (bubbled = e.bubbles));
    __test.insert(el, 'hi');
    expect(bubbled).toBe(true);
    expect(el.value).toBe('hi');
  });
});
