/**
 * WHAT A STORED REPORT IS, as the console reads it — and the two pure walks over a code block's bytes.
 *
 * ── THE SHAPES ARE DECLARED, NOT IMPORTED ──────────────────────────────────────────────────────
 *
 * The orchestrator owns the snapshot format and this is a reader of it. The types are written out here
 * rather than shared, for the reason `@kontra/core`'s own header gives about `paths` aliases: this
 * package is consumed from another repository, and a type that crossed the boundary by a build-time
 * path would typecheck on one machine and not in CI. The agreement is the FORMAT VERSION (`v`), which
 * is in the data.
 *
 * ── WHY THE CONSOLE NEVER TOUCHES HTML ─────────────────────────────────────────────────────────
 *
 * A snapshot is a TREE. The orchestrator dropped every `html` node before storing it, so there is no
 * markup here to sanitise and nothing for `{@html}` to do — which is what lets this repo's build guard
 * keep banning it. One component per node type, a closed set of eighteen, and a node type outside that
 * set renders as its own text.
 */

/** One mdast node, as a snapshot carries it. */
export interface ReportNode {
  type: string;
  children?: ReportNode[];
  value?: string;
  [key: string]: unknown;
}

/** One `{% code %}` block's stored bytes and what happened to them. */
export interface ReportBlock {
  lang: string;
  /** The REDACTED bytes, base64. The originals need an audited reveal the console cannot do alone. */
  b64: string;
  redacted: boolean;
  truncated: boolean;
  fullBytes: number;
  source: 'text' | 'b64' | 'ref';
  ref?: string;
  /** Set when a claim-checked ref was not read. The block shows a marker, not bytes. */
  unresolved?: string;
}

export interface ReportSnapshot {
  v: 1;
  root: ReportNode;
  blocks: Record<string, ReportBlock>;
  /** Things about how the report was MADE rather than what it says. Shown above it. */
  warnings?: string[];
}

/** What `GET /api/runs/:id/report` answers. */
export interface ReportVersionView {
  runId: string;
  version: number;
  status: 'ok' | 'error';
  templateHash: string;
  renderedAt: number;
  renderedBy: string;
  snapshot?: ReportSnapshot;
  error?: string;
}

export interface ReportVersionRow {
  version: number;
  status: 'ok' | 'error';
  templateHash: string;
  renderedAt: number;
  renderedBy: string;
  errorText?: string;
}

/** One Run's report as the Reports surface lists it — the newest version, and how many there are. */
export interface ReportListRow {
  runId: string;
  version: number;
  status: 'ok' | 'error';
  templateHash: string;
  renderedAt: number;
  renderedBy: string;
  versions: number;
  /** The workspace the Run ran in. Absent when nothing pinned a template for it. */
  workspace?: string;
  /** The caller workflow's manifest name. Absent when the identity was never recorded. */
  workflow?: string;
}

export interface FeedbackNote {
  id: string;
  runId: string;
  workflow: string;
  author: string;
  authorKind: 'user' | 'token';
  body: string;
  createdAt: number;
  editedAt?: number;
  deletedAt?: number;
}

/**
 * One run of characters in a code block, and whether it is content or a MARKER.
 *
 * A marker is the console's rendering of a byte that would otherwise be invisible or lost: a CR that
 * looks like nothing, a tab that looks like spaces, a control character a font draws as a box. §9.2
 * lists them, and the reason they matter here rather than in prose is that a code block is EVIDENCE —
 * "the response ended its headers with a bare LF" is a finding, and a renderer that silently normalised
 * it would have destroyed the finding while appearing to show it.
 */
export interface Span {
  text: string;
  /** A marker is styled dim and is NOT part of the bytes — it is this renderer describing them. */
  marker: boolean;
}

/** `\r` as shown, before the break it caused. */
const CR = '␍';
/** A tab, which is otherwise indistinguishable from the spaces around it. */
const TAB = '→';

/**
 * Decode a block's bytes into spans, one line's worth at a time.
 *
 * ── NO SHIKI, AND THAT IS A STATED OMISSION ────────────────────────────────────────────────────
 *
 * §9.2 asks for Shiki tokens with markers added after highlighting. There is no syntax highlighter in
 * this repo and adding one brings a grammar bundle for a cosmetic gain, so this renders monospace text
 * with the markers and no colour. The markers are the half that carries meaning; highlighting is the
 * half that does not. Recorded in ADR 0055 as the one §9.2 item not built.
 *
 * ── LATIN-1, NOT UTF-8, AND THE REASON IS LOSSLESSNESS ─────────────────────────────────────────
 *
 * Decoding UTF-8 would replace every invalid sequence with U+FFFD and the original byte would be gone —
 * so `\xff` could not be shown as `\xff`. Latin-1 maps all 256 values to code points reversibly, which
 * is what lets a byte be rendered as itself when it is printable and as `\xHH` when it is not. The cost
 * is that a UTF-8 multi-byte character renders as its bytes; the hex view is the honest place to read
 * those, and losing a byte entirely is the worse failure for evidence.
 */
export function spansOf(bytes: Uint8Array): Span[][] {
  const lines: Span[][] = [];
  let line: Span[] = [];
  let run = '';

  const flush = (): void => {
    if (run !== '') {
      line.push({ text: run, marker: false });
      run = '';
    }
  };
  const mark = (text: string): void => {
    flush();
    line.push({ text, marker: true });
  };

  for (const byte of bytes) {
    if (byte === 0x0a) {
      flush();
      lines.push(line);
      line = [];
      continue;
    }
    if (byte === 0x0d) {
      // BEFORE the break, so a CRLF reads as `␍` at the end of the line it terminated — which is how a
      // reader sees WHICH lines were CRLF and which were bare LF.
      mark(CR);
      continue;
    }
    if (byte === 0x09) {
      mark(TAB);
      continue;
    }
    if (byte < 0x20 || byte === 0x7f || byte >= 0x80) {
      // Every non-ASCII byte is shown as hex, for the latin-1 reason above: a byte this renderer cannot
      // prove is a character is shown as a byte.
      mark(`\\x${byte.toString(16).padStart(2, '0')}`);
      continue;
    }
    run += String.fromCharCode(byte);
  }
  flush();
  lines.push(line);
  // A trailing newline produces one empty final line, which is correct — and dropping it would hide
  // whether the bytes ended with a break.
  return lines;
}

/** One line of an `xxd`-style view: the offset, the hex pairs, and the printable rendering. */
export interface HexLine {
  offset: string;
  hex: string;
  ascii: string;
}

/**
 * The hex view, computed client-side from the bytes the page already has.
 *
 * SIXTEEN BYTES A LINE and the same layout the orchestrator's `{% code %}` `show: "bytes"` produces, so
 * a hex view in the console and a hex block in an export read identically. A reader comparing the two
 * should not have to translate.
 */
export function hexLines(bytes: Uint8Array): HexLine[] {
  const out: HexLine[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const chunk = bytes.subarray(at, at + 16);
    out.push({
      offset: at.toString(16).padStart(8, '0'),
      hex: Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' '),
      ascii: Array.from(chunk, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join(''),
    });
  }
  return out;
}

/** base64 to bytes, with no dependency and no `Buffer` — this runs in a browser. */
export function bytesOf(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * A size a person reads.
 *
 * THE UNIT IS CHOSEN PER VALUE, which the first version did not do: it printed MiB always, so a 2 KiB
 * block truncated out of a 4 MiB object read "showing 0.0 MiB of 4.1 MiB" — a measurement that says
 * nothing about the thing it measures. Caught by looking at the page rather than by a test, which is
 * what looking at a page is for.
 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

/** "showing 2.0 KiB of 4.1 MiB", or nothing when the block is whole. */
export function truncationNote(block: ReportBlock): string {
  if (block.unresolved !== undefined) return `not read: ${block.unresolved}`;
  if (!block.truncated) return '';
  return `showing ${humanBytes(bytesOf(block.b64).length)} of ${humanBytes(block.fullBytes)}`;
}
