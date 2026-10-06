<!--
  THE THREAD UNDER A REPORT — free text, and deliberately nothing more.

  ── RENDERED AS PLAIN TEXT, WHITESPACE KEPT ──────────────────────────────────────────────────────

  §9.3: a note is NOT Markdown. It is shown exactly as written, with `white-space: pre-wrap`, and that is
  a decision rather than a shortcut: a note may quote a target's response, and a renderer that turned
  `*` into emphasis would alter evidence somebody pasted. It also means there is no second Markdown
  pipeline to keep safe.

  ── A NOTE FROM A TOKEN SAYS SO ──────────────────────────────────────────────────────────────────

  `authorKind` comes from the credential, never from the body. An agent writing through MCP cannot wear a
  person's name, and the label is what makes that visible to whoever reads the thread later.
-->
<script lang="ts">
  import type { FeedbackNote } from '@kontra/console-core/report/snapshot';

  import { ago, initialOf, postNote } from './load';

  const { runId, notes, onAdded }: {
    runId: string;
    notes: FeedbackNote[];
    onAdded: (note: FeedbackNote) => void;
  } = $props();

  let draft = $state('');
  let saving = $state(false);
  let failed = $state('');

  const canSave = $derived(draft.trim() !== '' && !saving);

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    failed = '';
    try {
      const note = await postNote(runId, draft.trim());
      // CLEARED ONLY ON SUCCESS. A composer that emptied itself on a failure would lose what somebody
      // typed, which is the one thing a text box must never do.
      draft = '';
      onAdded(note);
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<section class="thread" data-testid="report-feedback">
  <header>
    <span class="label">Feedback</span>
    <!-- Said here because it changes what somebody writes: a note is read by an agent through MCP, so
         "retry that feed with a longer timeout" is an instruction somebody may act on. -->
    <span class="muted">· readable by your agent over MCP</span>
  </header>

  {#if notes.length === 0}
    <p class="muted empty">No notes yet. What should the next run do differently?</p>
  {/if}

  <ol class="notes">
    {#each notes as note (note.id)}
      <li data-testid="report-note">
        <span class="avatar" class:token={note.authorKind === 'token'} aria-hidden="true">{initialOf(note)}</span>
        <div class="body">
          <p class="who">
            <span class="author">{note.author}</span>
            {#if note.authorKind === 'token'}<span class="via">via token</span>{/if}
            <span class="muted">· {ago(note.createdAt)}</span>
            {#if note.editedAt !== undefined}<span class="muted">· edited</span>{/if}
          </p>
          <p class="text">{note.body}</p>
        </div>
      </li>
    {/each}
  </ol>

  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label for="note">Add a note on this run</label>
    <textarea
      id="note"
      bind:value={draft}
      placeholder="What should the next version do differently?"
      rows="3"
      data-testid="report-note-input"
    ></textarea>
    {#if failed}
      <p class="err" role="alert" data-testid="report-note-error">{failed}</p>
    {/if}
    <div class="actions">
      <button type="submit" disabled={!canSave} data-testid="report-note-save">
        {saving ? 'saving…' : 'Save note'}
      </button>
    </div>
  </form>
</section>

<style>
  .thread {
    margin-top: var(--s-5);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    padding: var(--s-4);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }

  .label {
    font-size: var(--t-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }

  .muted {
    color: var(--dim);
    font-size: var(--t-small);
  }

  .empty {
    margin: 0 0 var(--s-3);
  }

  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .notes li {
    display: flex;
    gap: var(--s-3);
    padding: var(--s-3) 0;
    border-bottom: 1px solid var(--track);
  }

  .avatar {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--bg);
    font-size: var(--t-small);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .avatar.token {
    background: var(--track);
    color: var(--dim);
    border: 1px solid var(--line);
  }

  .body {
    min-width: 0;
  }

  .who {
    margin: 0;
    font-size: var(--t-small);
    color: var(--dim);
  }

  .author {
    color: var(--fg);
    font-weight: 500;
  }

  .via {
    margin-left: var(--s-1);
    font-size: var(--t-micro);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 0 4px;
  }

  .text {
    margin: 2px 0 0;
    color: var(--fg);
    /* PRE-WRAP, NOT MARKDOWN. A note may quote a target's bytes; turning `*` into emphasis would alter
       what somebody pasted. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  form {
    margin-top: var(--s-4);
  }

  label {
    display: block;
    font-size: var(--t-small);
    color: var(--dim);
    margin-bottom: var(--s-1);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--fg);
    font: inherit;
    font-size: var(--t-small);
    padding: var(--s-2) var(--s-3);
  }

  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .err {
    margin: var(--s-2) 0 0;
    color: var(--bad);
    font-size: var(--t-small);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--s-2);
  }

  button {
    font: inherit;
    font-size: var(--t-small);
    font-weight: 600;
    color: var(--bg);
    background: var(--fg);
    border: 0;
    border-radius: var(--radius);
    padding: var(--s-2) var(--s-4);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  @media print {
    form {
      display: none;
    }
  }
</style>
