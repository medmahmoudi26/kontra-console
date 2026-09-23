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
    runQuery,
    starterSql,
    type QueryResult,
    type SchemaEntry,
  } from '@kontra/console-core/datasets/query';
  import DataTable, { type Column } from './DataTable.svelte';
  import { onMount } from 'svelte';

  let sql = $state('');
  let running = $state(false);
  let result = $state<QueryResult | undefined>(undefined);
  /** The ENGINE's sentence for a rejected query — shown under the editor, verbatim. */
  let rejected = $state('');
  /** A different failure: the surface is off, or the server is unreachable. */
  let unreachable = $state('');
  let schema = $state<SchemaEntry[]>([]);
  let openSchema = $state<string>('');
  let box = $state<HTMLTextAreaElement | undefined>(undefined);

  onMount(async () => {
    schema = await fetchSchema();
    if (!sql && schema.length) sql = starterSql(schema[0]!.name);
  });

  async function run(): Promise<void> {
    running = true;
    rejected = '';
    unreachable = '';
    const out = await runQuery(sql, { limit: 200 });
    running = false;
    if (out.ok) {
      result = out.result;
      return;
    }
    // THE TWO FAILURES ARE DRAWN DIFFERENTLY BECAUSE THEY ASK DIFFERENT THINGS OF THE READER: one
    // is "fix your query", the other is "the surface is off or the server is down". Collapsing them
    // into one red box makes a typo look like an outage.
    result = undefined;
    if (out.rejected) rejected = out.detail;
    else unreachable = out.detail;
  }

  function insert(text: string): void {
    const el = box;
    if (!el) {
      sql += text;
      return;
    }
    const a = el.selectionStart ?? sql.length;
    const b = el.selectionEnd ?? sql.length;
    sql = sql.slice(0, a) + text + sql.slice(b);
    queueMicrotask(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + text.length;
    });
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

<section class="wb">
  <header>
    <h2>Query</h2>
    <span class="hint mono">⌘/ctrl + ⏎ to run</span>
  </header>

  <div class="grid">
    <!-- WHAT IS QUERYABLE, listed rather than guessed at. -->
    <aside class="schema">
      <h3>datasets</h3>
      {#if schema.length === 0}
        <p class="muted">No datasets yet — a run that pushes rows creates one.</p>
      {:else}
        <ul>
          {#each schema as d (d.name)}
            <li>
              <button
                class="ds mono"
                class:on={openSchema === d.name}
                onclick={() => {
                  openSchema = openSchema === d.name ? '' : d.name;
                  sql = starterSql(d.name);
                }}
                title="write a starter query for {d.name}"
              >
                {d.name}<span class="n">{d.columns.length}</span>
              </button>
              {#if openSchema === d.name}
                <ul class="cols">
                  {#each d.columns as c (c.name)}
                    <li>
                      <button class="col mono" onclick={() => insert(c.name)} title="insert {c.name}">
                        {c.name}<span class="ty">{c.type.toLowerCase()}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <div class="editor">
      <textarea
        bind:this={box}
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
          {#if result.truncated}
            <!-- CAPPED IS DRAWN. A truncated result that reads as complete is the failure this
                 codebase names most often. -->
            <span class="cap">capped at the limit — not the whole answer</span>
          {/if}
        {/if}
      </div>

      {#if rejected}
        <p class="err" role="alert">{rejected}</p>
      {:else if unreachable}
        <p class="err" role="alert">{unreachable}</p>
      {/if}

      {#if result}
        <DataTable
          columns={cols}
          rows={result.rows}
          maxHeight="26rem"
          textOf={resultText}
          cellValue={resultValue}
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
  </div>
</section>

<style>
  .wb { display: flex; flex-direction: column; gap: var(--s-2); }
  header { display: flex; align-items: baseline; gap: var(--s-3); }
  h2 { font-size: var(--t-lead); font-weight: 600; margin: 0; }
  .hint { font-size: var(--t-small); color: var(--dim); margin-left: auto; }

  .grid { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: var(--s-3); align-items: start; }
  /* Under 900px the schema list stops being a rail and sits above the editor — the same rule the
     run page's logs rail follows. */
  @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }

  .schema {
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--panel); padding: var(--s-2); min-width: 0;
  }
  .schema h3 {
    font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--dim); font-weight: 600; margin: 0 0 var(--s-1);
  }
  .schema ul { list-style: none; margin: 0; padding: 0; }
  .schema .cols { margin: 0 0 var(--s-1) var(--s-2); }

  .ds, .col {
    display: flex; align-items: baseline; gap: var(--s-1); width: 100%;
    background: none; border: 0; border-radius: var(--radius);
    padding: 2px var(--s-1); text-align: left; cursor: pointer;
    font-size: var(--t-small); color: var(--fg);
  }
  .ds:hover, .col:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .ds.on { color: var(--accent); }
  .ds .n, .col .ty { margin-left: auto; color: var(--dim); font-size: var(--t-small); }
  .col { color: var(--dim); }

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
