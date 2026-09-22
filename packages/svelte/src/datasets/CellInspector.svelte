<script lang="ts">
  /**
   * ONE CELL, WHOLE. The thing a dataset table could not do.
   *
   * ── WHAT THIS FIXES, PRECISELY ──────────────────────────────────────────────────────────────────
   *
   * The dataset preview rendered its cells with
   *
   *     white-space: nowrap; max-width: 44ch; overflow: hidden; text-overflow: ellipsis;
   *
   * and no title, no click target and no expansion. Anything past forty-four characters was not
   * scrolled off — it was UNREACHABLE. For a `desync` row carrying a raw HTTP exchange, or a
   * `webcrawl` row carrying a page body, the cell showed a prefix and the rest of the value could
   * not be seen from the console at all. The query workbench had the opposite failure: no
   * max-width, so one multi-kilobyte JSON cell made its row kilometres wide and pushed every other
   * column out of the scroll box.
   *
   * Both are the same missing thing. A dense table MUST clip — nine columns do not fit a phone and
   * a 4 KB cell does not fit anything — and clipping is only honest when the whole value is one
   * click away. This is that click.
   *
   * ── THE RAW VALUE, NOT THE CELL'S TEXT ──────────────────────────────────────────────────────────
   *
   * `cellText` flattens a MAP or LIST into one line so it fits a row. Showing THAT here would be
   * showing a lossy rendering at full size — the shape a reader is trying to inspect is exactly the
   * thing it threw away. So the table hands over the value it was given, and this formats it for
   * reading rather than for fitting.
   *
   * ── A NATIVE <dialog>, DELIBERATELY ─────────────────────────────────────────────────────────────
   *
   * Escape, focus trapping, inertness of the page behind it and a top-layer stacking context are
   * all free and all correct. A hand-rolled overlay gets three of them wrong the first time and the
   * fourth when somebody adds a `z-index` elsewhere.
   */
  import { onMount } from 'svelte';

  interface Props {
    /** The column this cell is in. Shown as the title, because a value with no name is a riddle. */
    label: string;
    /** The RAW value. Not `cellText` of it — see the header. */
    value: unknown;
    /** Which row, 1-based, for a reader who needs to find it again in the table behind. */
    row: number;
    onclose: () => void;
  }

  let { label, value, row, onclose }: Props = $props();

  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let copied = $state(false);

  onMount(() => {
    // `showModal`, not the `open` attribute: only the former puts the element in the top layer and
    // turns on the Escape handling and focus trapping this component is relying on.
    dialog?.showModal();
  });

  /**
   * The value as text worth reading.
   *
   * A STRING THAT IS JSON IS SHOWN AS JSON. Half the wide cells in this product are a serialised
   * body that arrived as a `VARCHAR`, and showing it as one 4 KB line would reproduce the problem
   * this component exists to solve, one size larger.
   */
  const pretty = $derived.by(() => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
          // Not JSON after all — a line that merely starts with a brace. Show what is there.
        }
      }
      return value;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        // A cycle cannot come off the wire, and a viewer must never be the thing that throws.
        return String(value);
      }
    }
    return String(value);
  });

  /** What the value IS, said out loud — `null` and `"null"` are different facts about a row. */
  const kind = $derived.by(() => {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return `list · ${value.length}`;
    if (typeof value === 'object') return 'map';
    if (typeof value === 'string') return `text · ${value.length.toLocaleString()} chars`;
    return typeof value;
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(pretty);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // A denied clipboard permission is not an error worth a red box — the text is on screen and
      // selectable, which is the fallback every browser already provides.
    }
  }
</script>

<dialog bind:this={dialog} onclose={onclose} data-testid="cell-inspector">
  <header>
    <h2 class="mono">{label}</h2>
    <span class="kind">{kind}</span>
    <span class="rowno">row {row.toLocaleString()}</span>
    <button class="copy" onclick={() => void copy()}>{copied ? 'copied' : 'copy'}</button>
    <button class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
  </header>
  <!-- SELECTABLE AND WRAPPED. The table clips; this is the surface that does not, so `pre-wrap`
       rather than `pre` — a reader inspecting a 4 KB body should not have to scroll sideways
       through it after clicking specifically to stop doing that. -->
  <pre class="body mono">{pretty}</pre>
</dialog>

<style>
  dialog {
    width: min(72ch, 92vw);
    max-height: 80vh;
    padding: 0;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.55); }

  header {
    display: flex;
    align-items: baseline;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
    background: var(--track);
  }
  h2 { font-size: var(--t-small); font-weight: 600; margin: 0; }
  .kind, .rowno { font-size: var(--t-micro); color: var(--dim); }
  .rowno { margin-left: auto; }

  .copy {
    font-size: var(--t-small); color: var(--accent); background: none; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--radius); padding: 0 var(--s-2);
  }
  .copy:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .close {
    font-size: var(--t-lead); line-height: 1; color: var(--dim);
    background: none; border: 0; padding: 0 var(--s-1); cursor: pointer;
  }
  .close:hover { color: var(--fg); }

  .body {
    margin: 0;
    padding: var(--s-3);
    overflow: auto;
    font-size: var(--t-small);
    line-height: var(--lh-body);
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }
</style>
