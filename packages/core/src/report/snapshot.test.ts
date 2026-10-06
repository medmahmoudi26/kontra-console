import { describe, expect, it } from 'vitest';

import { bytesOf, hexLines, humanBytes, spansOf, truncationNote, type ReportBlock } from './snapshot';

/**
 * The two pure walks over a code block's bytes — the half of §9.2 that carries meaning.
 *
 * These are unit tests because there are no component tests in this repo: logic lives in a `.ts` module
 * and is tested here, and what is RENDERED is proven in Playwright. So the markers are proven here and
 * the fact that they reach the page is proven in `e2e/report.spec.ts`.
 */

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const flat = (lines: ReturnType<typeof spansOf>): string => lines.map((l) => l.map((s) => s.text).join('')).join('\n');

describe('spansOf', () => {
  it('leaves printable ASCII alone', () => {
    expect(flat(spansOf(new TextEncoder().encode('GET / HTTP/1.1')))).toBe('GET / HTTP/1.1');
  });

  it('shows a CR before the break it caused, so CRLF and bare LF are TOLD APART', () => {
    // The finding this exists for: "the response ended its headers with a bare LF" is a real result,
    // and a renderer that normalised line endings would destroy it while appearing to show it.
    const lines = spansOf(new TextEncoder().encode('a\r\nb\nc'));
    expect(flat(lines)).toBe('a␍\nb\nc');
    expect(lines[0]!.at(-1)).toEqual({ text: '␍', marker: true });
    expect(lines[1]!.some((s) => s.marker)).toBe(false);
  });

  it('shows a tab, which is otherwise indistinguishable from spaces', () => {
    const lines = spansOf(bytes(0x61, 0x09, 0x62));
    expect(flat(lines)).toBe('a→b');
    expect(lines[0]![1]).toEqual({ text: '→', marker: true });
  });

  it('shows a NUL and the other C0 bytes as hex', () => {
    expect(flat(spansOf(bytes(0x61, 0x00, 0x07, 0x1b, 0x62)))).toBe('a\\x00\\x07\\x1bb');
  });

  it('shows DEL as hex', () => {
    expect(flat(spansOf(bytes(0x7f)))).toBe('\\x7f');
  });

  it('shows a byte that is not valid UTF-8 as that byte, rather than losing it', () => {
    // A UTF-8 decode would make this U+FFFD and the original would be gone — so `\xff` could not be
    // shown as `\xff`, and a reader could not tell which byte was there.
    expect(flat(spansOf(bytes(0xff, 0xfe)))).toBe('\\xff\\xfe');
  });

  it('marks every byte of a multi-byte character, which is the cost of being lossless', () => {
    // é is C3 A9. Rendered as two hex markers rather than as é: this renderer shows bytes it cannot
    // prove are characters. The hex view is where those are read properly.
    expect(flat(spansOf(new TextEncoder().encode('é')))).toBe('\\xc3\\xa9');
  });

  it('keeps the empty final line a trailing newline produces', () => {
    // Dropping it would hide whether the bytes ended with a break.
    expect(spansOf(new TextEncoder().encode('a\n'))).toHaveLength(2);
    expect(spansOf(new TextEncoder().encode('a'))).toHaveLength(1);
  });

  it('separates content from markers rather than interleaving characters', () => {
    // One span per RUN, so the renderer emits few elements for a long line.
    const lines = spansOf(new TextEncoder().encode('hello\tworld'));
    expect(lines[0]).toEqual([
      { text: 'hello', marker: false },
      { text: '→', marker: true },
      { text: 'world', marker: false },
    ]);
  });

  it('handles empty bytes as one empty line', () => {
    expect(spansOf(bytes())).toEqual([[]]);
  });
});

describe('hexLines', () => {
  it('lays out sixteen bytes a line with an offset and a printable column', () => {
    const line = hexLines(bytes(0x47, 0x45, 0x54, 0x00))[0]!;
    expect(line.offset).toBe('00000000');
    expect(line.hex).toBe('47 45 54 00');
    expect(line.ascii).toBe('GET.');
  });

  it('starts a second line at offset 16', () => {
    const lines = hexLines(new Uint8Array(20).fill(0x41));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.offset).toBe('00000010');
    expect(lines[1]!.hex.split(' ')).toHaveLength(4);
  });

  it('is empty for no bytes', () => {
    expect(hexLines(bytes())).toEqual([]);
  });
});

describe('bytesOf', () => {
  it('round-trips bytes a snapshot carries, including ones no text encoding survives', () => {
    const original = bytes(0x00, 0xff, 0x0d, 0x0a);
    const b64 = btoa(String.fromCharCode(...original));
    expect(Array.from(bytesOf(b64))).toEqual(Array.from(original));
  });
});

describe('truncationNote', () => {
  const block = (over: Partial<ReportBlock>): ReportBlock => ({
    lang: 'http',
    b64: btoa('x'.repeat(1024)),
    redacted: false,
    truncated: false,
    fullBytes: 1024,
    source: 'text',
    ...over,
  });

  it('says nothing for a whole block', () => {
    expect(truncationNote(block({}))).toBe('');
  });

  it('says how much of how much, in a unit that suits each half', () => {
    // The bug a browser found and a test did not: printing MiB always made a 1 KiB block read
    // "showing 0.0 MiB", which measures nothing.
    expect(truncationNote(block({ truncated: true, fullBytes: 4 * 1024 * 1024 }))).toBe(
      'showing 1.0 KiB of 4.0 MiB'
    );
  });

  it('picks bytes, KiB or MiB per value', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(900)).toBe('900 B');
    expect(humanBytes(2048)).toBe('2.0 KiB');
    expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
  });

  it('says a ref was not read, which is NOT the same as empty', () => {
    // The distinction that cost a live run elsewhere in this system: an unreadable thing and an empty
    // thing must not render the same.
    expect(truncationNote(block({ unresolved: 'no actor served this ref within 5s' }))).toBe(
      'not read: no actor served this ref within 5s'
    );
  });
});
