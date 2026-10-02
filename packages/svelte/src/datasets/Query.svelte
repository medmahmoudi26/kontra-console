<script lang="ts">
  /**
   * The SQL workbench — search and filter the lake without leaving the console.
   *
   * Until this, answering "what is actually in `lame`" meant leaving for
   * `kontra dataset query <name> --sql "…"`. The route was already there
   * (`POST /api/datasets/query`, hardened READ_ONLY); what was missing was somewhere to type.
   *
   * ── THE SCHEMA IS BESIDE THE EDITOR, NOT BEHIND AUTOCOMPLETE ────────────────────────────────────
   *
   * You cannot write a query against a lake whose column names you are guessing. `/api/datasets/schema`
   * returns every dataset and its columns, so they are listed where they are needed — clicking a
   * dataset writes a starter query, clicking a column inserts its name. That is cheaper to build
   * than autocomplete and strictly better than a blank box, because it also answers "what is
   * queryable at all".
   *
   * ── CMD/CTRL+ENTER RUNS IT ──────────────────────────────────────────────────────────────────────
   *
   * A workbench where the only way to run is to reach for a button is a workbench nobody iterates
   * in. Enter alone inserts a newline, because SQL is multi-line.
   */
  import { download, type ExportFormat } from '@kontra/console-core/datasets/export';
  import {
    cellText,
    fetchSchema,
    starterSql,
    streamQuery,
    type QueryColumn,
    type QueryResult,
    type SchemaEntry,
  } from '@kontra/console-core/datasets/query';
  import DataTable, { type Column } from './DataTable.svelte';
  import { onMount } from 'svelte';

  interface Props {
    /**
     * A query to open with, instead of the starter for whichever dataset happens to be first.
     *
     * THE WHOLE POINT OF THE RUN PAGE'S "query these rows" BUTTON. Arriving here from a run means
     * arriving with a dataset AND a run already in mind, and re-finding the dataset by name and
     * re-typing a `SELECT` is the gap that button closes. Composed by `runScopedSql` and carried
     * across the navigation as a flag on the address (`address.ts`, `DatasetFocus.query`), so there
     * is one spelling of the query rather than one here and one there.
     */
    initialSql?: string;
  }
  let { initialSql = '' }: Props = $props();

  // EMPTY, THEN SEEDED ON MOUNT — see `onMount`. Initialising from the prop here would capture it
  // once anyway, and Svelte is right to flag that as ambiguous: the editor is not a mirror of the
  // prop, it is a box seeded from it and then owned by whoever is typing.
  let sql = $state('');
  let running = $state(false);
  let result = $state<QueryResult | undefined>(undefined);
  /** The ENGINE's sentence for a rejected query — shown under the editor, verbatim. */
  let rejected = $state('');
  /** A different failure: the surface is off, or the server is unreachable. */
  let unreachable = $state('');
  /**
   * STILL READ, THOUGH NOTHING DRAWS IT ANY MORE.
   *
   * The catalog rail that listed this is gone (see the markup), but `onMount` below still needs ONE
   * name out of it to seed the editor when a caller handed in no query. `openSchema` and the
   * `insert(column)` helper went with the rail — they existed only to expand a dataset's columns
   * and paste one into the textarea, which is the capability that delete gives up.
   */
  let schema = $state<SchemaEntry[]>([]);

  onMount(async () => {
    // A QUERY HANDED IN FROM A RUN WINS, and it is seeded before the schema read so a slow
    // `/schema` cannot land the starter on top of it.
    if (initialSql) sql = initialSql;
    schema = await fetchSchema();
    // `!sql` still guards the starter: an incoming query, or anything already typed while the
    // schema was loading, must not be replaced by the first dataset's `SELECT *`.
    if (!sql && schema.length) sql = starterSql(schema[0]!.name);
  });

  /**
   * STREAMED, SO THE TABLE PAINTS WHILE THE RESULT IS STILL ARRIVING (issue 03).
   *
   * This asked for 200 rows and waited for the whole body. It now reads
   * `POST /api/datasets/query/stream` — newline-delimited JSON, one frame per DuckDB chunk, no row
   * ceiling — and hands each frame to the table as it lands. MEASURED on the live install:
   * `injection_points_h1` is 9,159 rows in 349 ms across 5 frames, where the buffered route
   * answered 5,000 and a `truncated` flag.
   *
   * `result` IS ASSIGNED ONCE PER FRAME RATHER THAN MUTATED, because Svelte 5's `$state` tracks the
   * binding: pushing into `result.rows` in place updates the array and re-renders nothing, which
   * looks exactly like a stream that stopped after its first chunk.
   */
  async function run(): Promise<void> {
    running = true;
    rejected = '';
    unreachable = '';
    result = undefined;

    await streamQuery(sql, {
      head: (columns: QueryColumn[]) => {
        // TYPES OFF THE WIRE. They are DuckDB's, carried on the schema frame — the old path
        // re-derived them from the values, which cannot tell a BIGINT from a DOUBLE, or an empty
        // result's columns from nothing at all.
        result = { columns, rows: [], elapsedMs: 0, truncated: false };
      },
      rows: (chunk: unknown[][]) => {
        if (!result) return;
        result = { ...result, rows: [...result.rows, ...chunk] };
      },
      done: (summary) => {
        if (result) result = { ...result, elapsedMs: summary.elapsedMs };
      },
      // THE TWO FAILURES ARE DRAWN DIFFERENTLY BECAUSE THEY ASK DIFFERENT THINGS OF THE READER: one
      // is "fix your query", the other is "the surface is off or the server is down". Collapsing
      // them into one red box makes a typo look like an outage.
      //
      // AND A THIRD NOW: a read that broke PART WAY THROUGH. The rows that arrived are real and
      // stay on screen — dropping them would turn a partial answer into a blank one, which is
      // strictly less information — with the reason beside them.
      fail: (detail: string, opts: { rejected: boolean; partial: boolean }) => {
        if (!opts.partial) result = undefined;
        if (opts.rejected) rejected = detail;
        else unreachable = detail;
      },
    });

    running = false;
  }

  /** What each result column shows, as text — the filter row's accessor. */
  function resultText(row: unknown, i: number): string {
    return cellText((row as unknown[])[i]);
  }

  /**
   * What each result column IS — the inspector's accessor.
   *
   * NOT `resultText`. `cellText` flattens a MAP or LIST into one line so it fits a row; opening a
   * cell on that would show the lossy rendering at full size, which is precisely the shape a
   * reader clicked to get away from.
   */
  function resultValue(row: unknown, i: number): unknown {
    return (row as unknown[])[i];
  }

  /** The dataset an export is named after: the first table the query names, else `query`. */
  const exportBase = $derived((/\bfrom\s+"?([A-Za-z0-9_.-]+)"?/i.exec(sql)?.[1] ?? 'query'));

  function save(format: ExportFormat): void {
    if (!result) return;
    // `truncated` rides along so the FILENAME says the result was capped — see `export.ts`.
    download(
      { columns: result.columns, rows: result.rows },
      format,
      exportBase,
      { truncated: result.truncated }
    );
  }

  const cols = $derived<Column[]>(
    (result?.columns ?? []).map((c) => ({ label: `${c.name}  ${c.type.toLowerCase()}` }))
  );
</script>

<section class="wb" id="query" data-testid="dataset-query">
  <header>
    <h2>Query</h2>
    <span class="hint mono">⌘/ctrl + ⏎ to run</span>
  </header>

  <!--
    THE CATALOG IS NOT LISTED TWICE ANY MORE.

    A `.schema` rail sat here naming every dataset in the lake, beside a page whose LISTING already
    names every dataset in the lake. On this install that is 64 rows drawn twice: an unbounded
    ~1,200px column that pushed the open dataset's rows below the fold, counts that escaped the
    210px rail on any name longer than it (`http_events_fifth_third_bank_bbp 20`), and — because
    `schema` starts empty and `fetchSchema()` is awaited on mount — the words "No datasets yet"
    printed directly beneath a table listing 64 of them.

    It also made `Datasets.svelte`'s claim false. That file collapses its listing to a crumb when a
    dataset opens, with a comment reading ONE WIDE TABLE, NOT TWO STACKED ONES (issue 04); the rail
    put the second one straight back, one component lower, where the issue could not see it.

    WHAT IS LOST, so it is lost on purpose: expanding a dataset here was the only way to read COLUMN
    NAMES AND TYPES before writing SQL. The path now is to open the dataset and read the preview's
    headers, which is a click further and needs the dataset to have rows. `fetchSchema` is kept for
    `starterSql` below, which still needs a name to seed the editor with.
  -->
  <div class="editor">
      <textarea
        bind:value={sql}
        spellcheck="false"
        aria-label="SQL"
        placeholder="SELECT * FROM …"
        onkeydown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void run();
          }
        }}
      ></textarea>

      <div class="actions">
        <button class="run" onclick={() => void run()} disabled={running || !sql.trim()}>
          {running ? 'running…' : 'Run'}
        </button>
        {#if result}
          <span class="muted">
            {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · {result.elapsedMs} ms
          </span>
          <span class="save">
            <!-- EXPORT IS THE QUERY'S RESULT, not the dataset — so it inherits the LIMIT, and the
                 filename says so when it was capped. Parquet is deliberately absent: a real encoder
                 belongs on the server, and CSV wearing a .parquet name would be a lie. -->
            download
            {#each ['csv', 'tsv', 'json', 'jsonl'] as const as f (f)}
              <button class="fmt" onclick={() => save(f)} title="download {result.rows.length} row(s) as {f.toUpperCase()}">{f}</button>
            {/each}
          </span>
          {#if running}
            <!-- STILL ARRIVING. The count beside it is live, so a long scan visibly grows rather
                 than sitting at nothing until the last chunk — which is the whole reason the
                 result is streamed. -->
            <span class="cap">streaming…</span>
          {/if}
        {/if}
      </div>

      {#if rejected}
        <p class="err" role="alert">{rejected}</p>
      {:else if unreachable}
        <p class="err" role="alert">{unreachable}</p>
      {/if}

      {#if result}
<!-- THE RESULTS GRID GROWS WITH THE WINDOW, and 26rem is now its FLOOR rather than its ceiling.

           `maxHeight` was the flat `26rem` — ~364px. On any window taller than about 800px the
           grid showed eight rows and left the rest of the screen empty, so reading an 18-row
           answer meant scrolling a box inside a page that had room for all of it. That is the same
           complaint that made this table full-width: the grid was not using the space it had.

           `100vh - 30rem` is the window minus what sits above the grid — nav, heading, the dataset
           listing, the editor — plus a little air. `max(...)` keeps the old height as the LOWER
           bound, so a short window is no worse than it was rather than collapsing to nothing. -->
        <DataTable
          columns={cols}
          rows={result.rows}
          maxHeight="max(26rem, calc(100vh - 30rem))"
          textOf={resultText}
          cellValue={resultValue}
          resizeKey="query-result"
          empty="The query ran and matched nothing. That is an answer."
        >
          {#snippet cell(row)}
            {#each row as unknown[] as v, j (j)}
              <td class:num={typeof v === 'number'}>
                {#if v === null || v === undefined}
                  <!-- NULL AS A WORD, not an empty cell: a null and a blank string are different
                       facts and a reader must be able to tell. -->
                  <span class="null">null</span>
                {:else}
                  <!-- `cellText`, NOT `String(v)`: a MAP or LIST column stringifies to
                       `[object Object]` and takes the whole cell's content with it. -->
                  <span class="mono">{cellText(v)}</span>
                {/if}
              </td>
            {/each}
          {/snippet}
        </DataTable>
      {/if}
  </div>
</section>

<style>
  .wb { display: flex; flex-direction: column; gap: var(--s-2); }
  header { display: flex; align-items: baseline; gap: var(--s-3); }
  h2 { font-size: var(--t-lead); font-weight: 600; margin: 0; }
  .hint { font-size: var(--t-small); color: var(--dim); margin-left: auto; }

  /* THE EDITOR IS THE WHOLE WIDTH. This was `grid-template-columns: 210px minmax(0, 1fr)` with a
     `@media (max-width: 900px)` collapse, both of which existed only to seat the catalog rail that
     is gone. A one-item grid is a grid pretending to be a decision, so it is a block again — and
     the 900px rule went with the thing it was reflowing. `min-width: 0` stays on `.editor` below:
     it is what lets the result table's own scroll box shrink instead of widening the page. */

  textarea {
    width: 100%; min-height: 8rem; resize: vertical;
    font-family: var(--mono); font-size: var(--t-small); line-height: var(--lh-body);
    color: var(--fg); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
  }
  textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

  .editor { display: flex; flex-direction: column; gap: var(--s-2); min-width: 0; }
  .actions { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }

  .run {
    font-size: var(--t-small); font-weight: 600;
    padding: var(--s-1) var(--s-4); cursor: pointer;
    color: var(--bg); background: var(--accent);
    border: 0; border-radius: var(--radius);
  }
  .run:disabled { opacity: 0.45; cursor: default; }

  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; }
  .save { display: inline-flex; align-items: center; gap: var(--s-1);
          font-size: var(--t-small); color: var(--dim); }
  .fmt {
    font-family: var(--mono); font-size: var(--t-small); text-transform: uppercase;
    color: var(--accent); background: none; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--radius); padding: 0 var(--s-1);
  }
  .fmt:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .cap {
    font-size: var(--t-small); color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    border-radius: var(--radius); padding: 0 var(--s-2);
  }
  .err {
    font-size: var(--t-small); color: var(--bad); margin: 0;
    padding: var(--s-2) var(--s-3); line-height: var(--lh-body);
    font-family: var(--mono);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
    border-radius: var(--radius);
    white-space: pre-wrap;
  }
  .null { color: var(--dim); font-style: italic; }
</style>
