/**
 * The URL, as a value: reading one, printing one, and the two translations between it and the store.
 *
 * THE URL NAMES WHAT YOU ARE LOOKING AT. Until this module the app had no router at all — `view`
 * was in-memory Zustand state and the bar said `/` forever, so every reload landed back on
 * Workflows, Back and Forward did nothing, and no surface could be handed to anybody. The three
 * things an operator most wants to paste to a colleague are a **Run**, a **Dataset** and the
 * workflow a run came from, so those are what carry an id.
 *
 * ADDRESS, NOT ROUTE. `route` is already taken in this codebase and it means an HTTP route on the
 * orchestrator (`run/api.ts`: "the history route", "the caller route"). `address` is the word this
 * repo already uses for the other idea — "a **Run** is addressed by its id and by nothing else",
 * "a Dataset is addressed by name + version + dt" — and an Address is exactly that written down
 * where a browser can hold it.
 *
 * THE STORE IS STILL THE API; THE ADDRESS IS A PROJECTION OF IT. `openRun`, `openWorkflow`,
 * `openDataset`, `watchTerminal` and `setView` keep their names and signatures and every caller
 * across `panels/` is untouched — they additionally write the bar. That is the layering and not an
 * accident: a surface asks the store to go somewhere, and where the store went is what the bar
 * reports. Nothing in `panels/` learns that a URL exists.
 *
 * A RUN IS ADDRESSED BY ITS ID, ON TWO SURFACES. `/runs/<id>` is the run's own record — the surface
 * that lists every run and shows one as the input it was started with over the output it produced.
 * `/workflows/<workflow>/<id>` is the same run reached through the thread that produced it, watched
 * live. Both are legal and both round-trip; `runs` keeps its own store field (`runsRun`) so opening
 * one never disturbs which run the other has. (The global Runs view was retired once and folded into
 * Workflows; the record earned its surface back — see `surfaces.ts`.) A run reached from somewhere
 * that does not know its workflow still lands as `/workflows?run=<id>`, a thread not yet resolved.
 *
 * NO ROUTER LIBRARY, and that is an argument rather than an omission. Five surfaces and three
 * entity ids is one `switch` in each direction; react-router would add a dependency, a provider and
 * a second vocabulary for `view` to a bundle already carrying 6.4 MB of JS. What it buys is nested
 * layouts, data loaders and route-level code splitting — this app has no nested layouts, loads
 * through the store, and already splits every surface with `React.lazy` in `App.tsx`. There is
 * nothing left for it to buy.
 *
 * A PATH, NOT A HASH. `backend/src/server.ts` already answers any non-`/api/` GET that is not
 * a real file with `index.html` (its `setNotFoundHandler`), so `/workflows/dnssweep/nscheck-123`
 * serves the SPA with no server change beyond the surface list it copies from `surfaces.ts`. A hash
 * could not 404 either, but `#/runs/x` is a worse thing to paste and it is never sent to the server
 * at all, which forecloses ever answering a **Run** address from the orchestrator.
 */


import { DEFAULT_VIEW, PATHS, RETIRED, type View } from './surfaces';

/**
 * Which Dataset to open, and — when the operator arrived from one — which **Run** to scope it to.
 *
 * It was declared on the React console's store. The store went with React; this is a shape of the
 * ADDRESS (`/datasets/<name>?kind=&run=`), which is why it now lives beside the parser that reads
 * and writes it.
 */
export interface DatasetFocus {
  name: string;
  kind?: 'output' | 'standalone';
  version?: string;
  dt?: string;
  run?: string;
  /**
   * Open the QUERY workbench on this Dataset, not just the listing — what the run page's
   * "query these rows" button addresses.
   *
   * A FLAG, NOT THE SQL, and that is the decision. Carrying the text would put a second spelling of
   * the query in the URL beside `runScopedSql`'s, and the two would drift the first time either
   * changed; it would also make an ordinary link several hundred characters of encoded SQL. The
   * name and the run are already here, and they are everything the query is composed from — so the
   * address says WHERE to go and `datasets/query.ts` stays the only thing that says WHAT to ask.
   */
  query?: boolean;
}


/**
 * Where the app is, as the bar says it.
 *
 * Three surfaces address an entity and four do not, which is why this is a union and not a record
 * with three mostly-null fields: `{ view: 'actors', run: null, terminal: null, dataset: null }`
 * invites code that reads `run` on the Actors surface.
 */
export type Address =
  /**
   * The centre. Four readings, and each of them is a real place:
   *
   *  - nothing        `/workflows`            the list, with no thread open
   *  - a workflow     `/workflows/<w>`        the thread, with no conversation open
   *  - both           `/workflows/<w>/<r>`    one run of it — the thing an operator pastes
   *  - a run alone    `/workflows?run=<r>`    a run whose thread nobody has resolved yet
   *
   * The fourth is not a hole in the design, it is what a redirected `/runs/<id>` becomes and what
   * `openRun` produces when it is called from somewhere that does not know the workflow. The run is
   * a QUERY there rather than a segment because it is not addressing a position in the path — there
   * is no workflow above it to be under.
   *
   * THERE WAS A FIFTH READING AND IT WAS `?pane=`. It selected a **Terminal** within the open run's
   * Monitor tab, and it was a QUERY rather than a segment because a Terminal id
   * (`<mode>:<node>/<session>/<window>`) carries a colon, two slashes and, on tmux, a dot — and the
   * SPA fallback has already 404'd a dotted id once (`surfaces.ts` records it). The Monitor is gone
   * and so is the axis; the reasoning is kept because the next id-shaped thing somebody wants in a
   * URL has the same problem. A query keeps every one
   * of those bytes out of the path, so what the server has to recognise stays `/workflows`.
   */
  | { view: 'workflows'; workflow: string | null; run: string | null }
  // `secrets` joins the arms that carry NOTHING. A secret is never addressable from the bar:
  // naming one in a URL would put it in history and in every referrer, and the whole point of the
  // store is that a value never leaves it. The surface is addressable; a secret is not.
  // `catalog` and `secrets` join the arms that carry NOTHING, for opposite reasons. A secret is
  // never addressable from the bar: naming one in a URL would put it in history and in every
  // referrer, and the whole point of the store is that a value never leaves it. The Catalog's
  // filter is not addressed because it is not an entity — a search box and three chips are how you
  // FIND the thing whose own address is the one worth pasting, and two ways to link one workflow is
  // a link that does not round-trip. The surface is addressable; a query within it is not.
  // `logs` joins them too, and for a third reason again: what it shows is a LIVE TAIL, so there is
  // no position in it to address. A filter typed into it is a view of the last few thousand lines
  // that happen to be in this tab's buffer; pasting it to somebody else would name lines they do
  // not have. The address that survives being sent to another person is a `/api/logs/query`, which
  // is a different tool. The surface is addressable; a moment in a stream is not.
  // `runs` addresses a run by its id and nothing else: the record is the same wherever it is
  // reached from, so the id is the whole address — `/runs` is the list, `/runs/<id>` is one run. It
  // gets its OWN store field (`runsRun`) rather than sharing the Workflows surface's `runId`, so
  // landing on `/runs/<id>` never silently reselects a run on the page the operator just left.
  | {
      view: 'runs';
      run: string | null;
      /**
       * Which face of one run — its record, or its **Report** (ADR 0055).
       *
       * A SEGMENT AND NOT A QUERY, because it names a position in the path: `/runs/<id>/report` is the
       * thing an operator pastes to say "read what this run found", and the run's record is what
       * `/runs/<id>` already meant. `null` is the record, which keeps every existing address meaning
       * exactly what it meant.
       *
       * ONE VALUE, not an open string. A tab this app does not have is not an address it could serve,
       * and `parseAddress` returns `null` for anything else — the same refusal that `/runs/<id>/<x>`
       * has always given, narrowed by exactly one word rather than opened up.
       */
      tab: 'report' | null;
    }
  | { view: 'actors' | 'catalog' | 'logs' | 'secrets' | 'settings' }
  | { view: 'datasets'; dataset: DatasetFocus | null };

/** Where an unknown or malformed address lands, and where a cold `/` lands. */
export const DEFAULT_ADDRESS: Address = {
  view: DEFAULT_VIEW,
  workflow: null,
  run: null,
};

const VIEW_BY_SEGMENT = new Map<string, View>(
  Object.entries(PATHS).map(([view, path]) => [path.slice(1), view as View])
);

/** The slice of the store the address is a projection of. Declared here so `store.ts` can hand
 *  itself over without this module knowing anything else about it. */
export interface AddressedState {
  view: View;
  workflowName: string | null;
  runId: string | null;
  /** The **Run** the Runs surface has open — its OWN field, not `runId`. `/runs/<id>` addresses a
   *  run without touching which run the Workflows surface has selected. */
  runsRun: string | null;
  /**
   * Which face of that run is open: its record, or its **Report** (ADR 0055).
   *
   * OPTIONAL, so every existing caller of `addressOf` keeps compiling and keeps meaning the record.
   * A store that has never heard of a report reads as `null` here, which is what `/runs/<id>` already
   * addressed.
   */
  runsTab?: 'report' | null;
  datasetFocus: DatasetFocus | null;
}

/**
 * The address of a given store.
 *
 * IT PROJECTS THE CURRENT SURFACE AND ONLY THAT SURFACE'S ENTITY. `setRunId` while the Datasets
 * page is open changes which **Run** the Workflows surface has selected without navigating
 * anywhere — that is the existing behaviour and the bar has to agree with it: the address stays
 * `/datasets`, because that is what is on screen. The id is not lost, it is just not this page's
 * address.
 */
export function addressOf(s: AddressedState): Address {
  switch (s.view) {
    case 'workflows':
      return { view: 'workflows', workflow: s.workflowName, run: s.runId };
    case 'datasets':
      return { view: 'datasets', dataset: s.datasetFocus };
    case 'runs':
      return { view: 'runs', run: s.runsRun, tab: s.runsTab ?? null };
    default:
      return { view: s.view };
  }
}

/**
 * The store fields an address sets when the address is the thing driving — a cold load, or Back.
 *
 * EACH ADDRESS WRITES ITS OWN SURFACE'S FIELDS AND NOTHING ELSE. Going Back from
 * `/workflows/dnssweep/r1` to `/datasets/lame` must not blank `workflowName`: a Datasets address
 * says nothing about the Workflows surface's selection, and clearing it would lose the operator's
 * place on a page they never left. What an address DOES say about its own surface is total, `null`
 * included — `/workflows` means the list with no thread and no conversation open, which is exactly
 * why Back out of `/workflows/dnssweep` closes it.
 */
export function stateFor(address: Address): Partial<AddressedState> {
  switch (address.view) {
    case 'workflows':
      return {
        view: 'workflows',
        workflowName: address.workflow,
        runId: address.run,
      };
    case 'datasets':
      return { view: 'datasets', datasetFocus: address.dataset };
    case 'runs':
      return { view: 'runs', runsRun: address.run, runsTab: address.tab };
    default:
      return { view: address.view };
  }
}

/** An address as it should appear in the bar: path plus search, no origin, no hash. */
export function formatAddress(address: Address): string {
  switch (address.view) {
    case 'workflows': {
      // A workflow name is a FOLDER name on somebody's disk and a run id is whatever `--id` was, so
      // both are encoded rather than trusted. `encodeURIComponent` leaves `.` alone, which is why
      // the server matches on the first segment — see `surfaces.ts`.
      const path =
        address.workflow === null
          ? PATHS.workflows
          : `${PATHS.workflows}/${encodeURIComponent(address.workflow)}${
              address.run === null ? '' : `/${encodeURIComponent(address.run)}`
            }`;
      // BUILT WITH `encodeURIComponent`, NOT `URLSearchParams`, and that is not a style choice:
      // `URLSearchParams` writes a space as `+` (form encoding), so `?run=wf%2Fone%20two` would
      // silently become `?run=wf%2Fone+two` — a different string in somebody's notes for the same
      // run. Both read back the same; only one of them is the address this app has always printed.
      const query: string[] = [];
      // `?run=` only where there is no workflow above it to be under. Two spellings of one address
      // is a link that does not round-trip, so the segment wins wherever it exists.
      if (address.workflow === null && address.run !== null) {
        query.push(`run=${encodeURIComponent(address.run)}`);
      }
      return `${path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
    }
    case 'datasets': {
      if (address.dataset === null) return PATHS.datasets;
      const query = new URLSearchParams();
      // `kind` is OMITTED rather than defaulted, because absent is a third value and not a synonym
      // for `output`: a focus with no kind matches a Dataset of either kind, which is what a link
      // built from a name alone has to mean. `?kind=output` says output and refuses standalone.
      if (address.dataset.kind !== undefined) query.set('kind', address.dataset.kind);
      // The **Run** whose contribution the operator was reading. It scopes the console; it does not
      // pick the Dataset, so it is a search parameter and not a path segment.
      if (address.dataset.run !== undefined) query.set('run', address.dataset.run);
      // Open the workbench rather than the listing. Only ever written when true — `?q=0` would be
      // a second spelling of the default.
      if (address.dataset.query === true) query.set('q', '1');
      const search = query.toString();
      return `${PATHS.datasets}/${encodeURIComponent(address.dataset.name)}${search ? `?${search}` : ''}`;
    }
    case 'runs': {
      // A run id is whatever `--id` was, so it is encoded rather than trusted — the server still
      // matches on the first segment (`runs`), which is why a dotted id like `sweep-v1.2` survives.
      if (address.run === null) return PATHS.runs;
      const base = `${PATHS.runs}/${encodeURIComponent(address.run)}`;
      /* APPENDED ONLY WHEN THERE IS ONE, and the test is truthiness rather than `!== null` — which is
         what the first version used, and it shipped `/runs/<id>/undefined` to two callers.

         `tab` is REQUIRED by the type and `tsc` does enforce it, but MEASURED: `svelte-check` does not
         report the same error inside a `.svelte` script block, so `Workflows.svelte` and `Runs.svelte`
         both called this with the field absent and nothing objected until a browser did. The type is
         the contract; this line is what makes a caller the type did not reach harmless.

         The tab is a LITERAL and is not encoded: it is one of a closed set this module owns, not a
         name that came from anywhere else. */
      return address.tab ? `${base}/${address.tab}` : base;
    }
    default:
      return PATHS[address.view];
  }
}

/**
 * Read an address. `null` means "not one of ours" — the caller lands on {@link DEFAULT_ADDRESS} and
 * rewrites the bar, rather than throwing a blank page at whoever typed it.
 *
 * STRICT ABOUT THE PATH, LENIENT ABOUT THE QUERY. An unknown surface or a fourth path segment is a
 * URL this app cannot mean, so it falls back; an unrecognised `?kind=` is dropped and the rest of
 * the address still lands you on the Dataset. Either way the result round-trips through
 * {@link formatAddress}, which is what lets a cold load canonicalise `/` into `/workflows`, a junk
 * query into no query, and a retired `/runs/<id>` into its new address — each with one `replace`
 * and no history entry.
 *
 * A RETIRED ADDRESS PARSES INTO THE LIVE ONE IT MEANS, and that is the whole redirect. It is here
 * rather than in `addressing.ts` because a redirect IS a reading of a URL, and putting it here
 * makes it a property of the address space that a pure test can pin: `/runs/nscheck-123` is a run,
 * so it becomes the address that names that run; `/scratch` was a drawing surface with no subject,
 * so it becomes the list. Nothing about it is a special case at the browser boundary, and Back
 * cannot land on it again because `land()` replaces rather than pushes.
 *
 * AN ID IN AN ADDRESS IS NOT A PROMISE THAT IT EXISTS, and this module deliberately does not
 * pretend otherwise — it validates syntax and nothing else. A well-formed id for a **Run** Temporal
 * has dropped, or a **Dataset** nobody ever wrote, lands on the right surface WITH THE ID SET and
 * that surface answers for it. Neither spins forever, and neither is a case this module could
 * answer anyway — existence is a question for the server.
 */
export function parseAddress(url: string): Address | null {
  // The hash is not ours. Stripped rather than refused, so a `#anchor` cannot blank the page.
  const [beforeHash = ''] = url.split('#');
  const [path = '', search = ''] = beforeHash.split('?');

  const segments = path.split('/').filter((s) => s !== '');
  if (segments.length === 0) return DEFAULT_ADDRESS;
  if (segments.length > 3) return null;
  const [surface = '', ...rest] = segments;

  // `decodeURIComponent` throws on a malformed escape (`%zz`). That is a URL somebody typed wrong,
  // not an exception an operator should be shown. A trailing slash is no entity, not an empty one.
  let ids: string[];
  try {
    ids = rest.map((seg) => decodeURIComponent(seg));
  } catch {
    return null;
  }
  const [first = null, second = null] = ids;

  const retired = RETIRED[surface];
  if (retired !== undefined) {
    // A retired address has exactly as much depth as it ever had — `/runs/a/b` was never a URL this
    // app could mean and answering it now would be inventing history.
    if (ids.length > 1) return null;
    // A retired surface that never addressed anything still cannot: `/scratch/foo` was not a URL
    // this app could mean before, and a redirect is not a licence to start accepting it.
    if (retired.carries === 'nothing') {
      if (first !== null) return null;
      // TWO SHAPES, because the targets are two different arms of the union. `logs` addresses
      // nothing below itself; `workflows` carries a workflow and a run, both null here for the
      // reason below.
      return retired.to === 'logs' ? { view: 'logs' } : { view: 'workflows', workflow: null, run: null };
    }
    // A retired address that carried an id hands it on, and nothing else: a redirect moves an id, it
    // does not invent a selection the old URL could not have expressed.
    return { view: 'workflows', workflow: null, run: first };
  }

  const view = VIEW_BY_SEGMENT.get(surface);
  if (view === undefined) return null;

  switch (view) {
    case 'workflows': {
      const query = new URLSearchParams(search);
      // `/workflows?run=<id>` — a run with no thread above it. Only readable when no workflow is
      // named, because `/workflows/<w>/<r>` already says it in the path and two spellings of one
      // address is a link that does not round-trip.
      if (first === null) {
        if (second !== null) return null;
        const run = query.get('run');
        return { view, workflow: null, run: run === null || run === '' ? null : run };
      }
      return { view, workflow: first, run: second };
    }
    case 'runs':
      /* ONE ID, AND ONE WORD UNDER IT. `/runs` is the list, `/runs/<id>` is the run's record, and
         `/runs/<id>/report` is what it found (ADR 0055). Every other second segment is still `null`,
         which is what this case has always answered — the refusal is narrowed by one word rather
         than replaced by a wildcard, so a typo'd tab is a 404 in the app rather than a blank page. */
      if (first === null) return second === null ? { view, run: null, tab: null } : null;
      if (second === null) return { view, run: first, tab: null };
      return second === 'report' ? { view, run: first, tab: 'report' } : null;
    case 'datasets': {
      if (second !== null) return null;
      if (first === null) return { view, dataset: null };
      const query = new URLSearchParams(search);
      const kind = query.get('kind');
      const run = query.get('run');
      const dataset: DatasetFocus = { name: first };
      if (kind === 'output' || kind === 'standalone') dataset.kind = kind;
      if (run !== null && run !== '') dataset.run = run;
      if (query.get('q') === '1') dataset.query = true;
      return { view, dataset };
    }
    default:
      // A surface with no entity to address cannot have a second segment.
      return first === null ? { view } : null;
  }
}
