/**
 * The Catalog surface: everything registered on this control plane, searchable, in one list.
 *
 * WHAT IS DECIDED HERE AND WHAT IS NOT. The list itself — what an entry is, how the two inventories
 * join, which state each one is in and what is searchable — is `catalog.ts`, which is pure and
 * therefore drivable from literals in node. This file is the page around it: the fetches, the
 * filter row, the three densities, and where a click lands. Nothing in it decides anything about an
 * entry, which is what lets the sharp assertions live in `catalog.test.ts` rather than in a render.
 *
 * FOUR REQUESTS, FLAT, PLUS ONE PER REGISTERED QUEUE. The inventories are two folder listings, the
 * workflow listing (files AND descriptors in one answer) and the actor catalog the store already
 * polls for everyone. The only per-entry cost is `DescribeTaskQueue`, and only for entries that
 * something has actually registered — every queue on this page is named without reading a source
 * file, which is the property that keeps a browse surface cheap no matter how large the registry
 * gets. See `catalog.ts`'s header for why a workflow's queue comes off its descriptor rather than
 * being re-derived from a folder digest.
 *
 * THE RUN LIST IS LOADED HERE, ONCE, and not polled. It contributes exactly one thing — whether a
 * workflow has an execution open — and this surface is where you go to FIND something, not where
 * you watch it. `App.tsx` polls that list only while the Workflows surface is mounted, deliberately,
 * because it is the most expensive read in the app; a browse page that re-read it every few seconds
 * would undo that. Opening the entry gets you the live view.
 *
 * A CLICK OPENS THE THING WHERE IT LIVES. There is no detail view here and there should not be: a
 * second place to read an Actor's Methods is a second place for them to be out of date, and both
 * work surfaces already do it properly with the verbs attached. What this surface owes the operator
 * is to FIND it and hand them over.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';

import { fetchPollers, fetchWorkflows, type WorkflowDescriptor, type WorkflowFile } from '../run/api';
import type { PollerReport } from '../run/workflowState';
import { useAppStore } from '../state/store';
import { CatalogCard, type CardLayout } from './CatalogCard';
import {
  NO_FILTER,
  buildCatalog,
  isFiltered,
  matchEntry,
  queuesOf,
  resultLabel,
  type CatalogEntry,
  type CatalogFilter,
  type EntryState,
  type Place,
} from './catalog';
import { useRegisteredFolders } from './RegisteredFolders';
import { Button } from '@/components/ui/button';

/** Where the chosen density lives. Named here so a test cannot drift from the app. */
export const CATALOG_LAYOUT_KEY = 'kontra.catalog.layout';

const LAYOUTS: ReadonlyArray<{ id: CardLayout; label: string; title: string }> = [
  { id: 'roomy', label: 'cards', title: 'Roomy cards: the description and the Methods' },
  { id: 'compact', label: 'compact', title: 'Denser cards: name, state and counts' },
  { id: 'list', label: 'list', title: 'One row per entry' },
];

const KINDS: ReadonlyArray<{ id: CatalogFilter['kind']; label: string }> = [
  { id: 'all', label: 'all' },
  { id: 'workflow', label: 'workflows' },
  { id: 'actor', label: 'actors' },
];

/**
 * The chips, and what each one means.
 *
 * THESE ARE FACETS, NOT TAGS. There is nowhere for a tag to come from — see `catalog.ts`'s header —
 * so what is offered is the two things the system actually records about an entry. Both rows are
 * OR within themselves and AND across, which is how anybody expects chips to behave.
 *
 * ONLY THE STATES AN OPERATOR WOULD NARROW BY. `running` is not here: "show me what is running" is
 * the nav rail's pulse and the Workflows surface, and a chip that filtered a browse page down to
 * the one thing already on screen everywhere else would be the fourth answer to a question that
 * has three.
 */
const STATE_CHIPS: ReadonlyArray<{ id: EntryState; label: string; title: string }> = [
  { id: 'serving', label: 'serving', title: 'a worker is polling its queue right now' },
  { id: 'idle', label: 'idle', title: 'registered, but nothing is polling its queue' },
  {
    id: 'unserved',
    label: 'unserved',
    title: 'a folder on this disk that no worker has ever registered — serve it to find out what it declares',
  },
  {
    id: 'unknown',
    label: 'unknown',
    title: 'Temporal could not be asked. Not the same as idle — the answer is missing, not negative.',
  },
];

const PLACE_CHIPS: ReadonlyArray<{ id: Place; label: string; title: string }> = [
  { id: 'disk', label: 'on this disk', title: 'a registered folder here — you can open, serve and call it' },
  {
    id: 'elsewhere',
    label: 'not on this disk',
    title: 'registered by a worker running code that is in no folder on this machine',
  },
];

function readLayout(): CardLayout {
  try {
    const got = globalThis.localStorage?.getItem(CATALOG_LAYOUT_KEY);
    return got === 'compact' || got === 'list' ? got : 'roomy';
  } catch {
    // Storage can throw on ACCESS in a browser with site data blocked, not only on the value.
    // Failing to remember a density is one extra click, never an exception in a render path.
    return 'roomy';
  }
}

export default function CatalogPage(): JSX.Element {
  const catalog = useAppStore((s) => s.catalog);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const runs = useAppStore((s) => s.runs);
  const loadRuns = useAppStore((s) => s.loadRuns);
  const setCatalogCount = useAppStore((s) => s.setCatalogCount);
  const openWorkflow = useAppStore((s) => s.openWorkflow);
  const openActor = useAppStore((s) => s.openActor);

  const workflowFolders = useRegisteredFolders('workflow');
  const actorFolders = useRegisteredFolders('actor');

  const [workflows, setWorkflows] = useState<{
    files: WorkflowFile[];
    descriptors: WorkflowDescriptor[];
  }>({ files: [], descriptors: [] });
  const [pollers, setPollers] = useState<Record<string, PollerReport>>({});
  const [filter, setFilter] = useState<CatalogFilter>(NO_FILTER);
  const [layout, setLayout] = useState<CardLayout>(readLayout);
  /** Bumped by the refresh button, so pressing it restarts the poll with an immediate tick rather
   *  than adding a second, unguarded fetch that could set state after the page has gone. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void loadCatalog();
    // ONCE, NOT POLLED — see the file header. One read is what makes `running` true on arrival; the
    // surface you open is what keeps it true.
    void loadRuns();
  }, [loadCatalog, loadRuns, nonce]);

  /* SWALLOWS ITS FAILURE. The workflow listing contributes descriptions, queues and declared
     inputs; an orchestrator that cannot answer it should cost this page those fields, not the
     actors beside them. Empty is what an installation with no workflows looks like. */
  useEffect(() => {
    let live = true;
    void fetchWorkflows()
      .then((got) => {
        if (!live) return;
        setWorkflows({
          files: Array.isArray(got.workflows) ? got.workflows : [],
          descriptors: Array.isArray(got.registered) ? got.registered : [],
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [nonce]);

  const now = Date.now();
  const entries = useMemo(
    () =>
      buildCatalog({
        workflowFolders: workflowFolders.sources,
        workflowFiles: workflows.files,
        descriptors: workflows.descriptors,
        runs,
        actorFolders: actorFolders.sources,
        actors: catalog,
        pollers,
        // THE CLOCK IS READ ONCE PER BUILD, not per entry. Two entries whose staleness was measured
        // against two different `Date.now()` calls can disagree about the same queue.
        now,
      }),
    // `now` is deliberately absent: it moves on every render and would rebuild the list each time.
    // What re-dates the staleness is a fresh poller report, which is in the deps and arrives with
    // its own timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actorFolders.sources, catalog, pollers, runs, workflowFolders.sources, workflows]
  );

  // THE RAIL COUNTS WHAT THIS PAGE DRAWS. Published on every change rather than on first load, so a
  // forgotten folder or a worker coming up moves the badge with the grid.
  useEffect(() => {
    setCatalogCount(entries.length);
  }, [entries.length, setCatalogCount]);

  /** As one stable string — an array here restarts the interval on every catalog tick. */
  const queueList = useMemo(() => queuesOf(entries).join('\n'), [entries]);

  /**
   * WHO IS POLLING EACH REGISTERED QUEUE — asked ONCE, and never on a timer.
   *
   * THIS WAS A 10-SECOND INTERVAL AND THAT WAS A MISTAKE I MEASURED. One `DescribeTaskQueue` per
   * registered queue is 27 requests on this installation, and the set takes about four seconds
   * wall-clock — so a ten-second interval leaves the page issuing cluster calls for nearly half of
   * every window, forever, on every open tab. The Actors grid can afford that cadence because it
   * asks about the handful of folders on this disk; a registry asks about everything there is.
   *
   * AND A BROWSE PAGE DOES NOT NEED IT. The same argument the run list gets in the file header
   * applies here: this surface is where you FIND something, and the surface you open is where you
   * watch it. One reading on arrival answers "is this live" for the moment somebody is choosing;
   * Refresh re-reads when they want it again.
   *
   * `fetchPollers` NEVER THROWS — an unreachable cluster comes back as `pollers: 0` WITH an
   * `error`, which `catalog.ts` reads as `unknown` rather than as "nothing is serving". A `catch`
   * here that dropped the report would throw away the distinction one layer above where it was
   * preserved.
   */
  useEffect(() => {
    const queues = queueList === '' ? [] : queueList.split('\n');
    if (queues.length === 0) {
      setPollers({});
      return;
    }
    let live = true;
    void Promise.all(queues.map((q) => fetchPollers(q))).then((reports) => {
      if (!live) return;
      // MERGED, NOT REPLACED, and that is the change one-shot reading forces. The list grows as the
      // two folder listings and the workflow listing land, so this effect runs several times on the
      // way up with a longer queue each time; replacing would throw away the answers already in
      // hand and redraw settled cards as `unknown`.
      setPollers((prev) => ({ ...prev, ...Object.fromEntries(reports.map((r) => [r.queue, r])) }));
    });
    return () => {
      live = false;
    };
  }, [queueList, nonce]);

  const chooseLayout = useCallback((next: CardLayout) => {
    setLayout(next);
    try {
      globalThis.localStorage?.setItem(CATALOG_LAYOUT_KEY, next);
    } catch {
      // See `readLayout`: not remembering is a click, not an error.
    }
  }, []);

  const open = useCallback(
    (entry: CatalogEntry) => {
      // `target`, NEVER `name`. A workflow's surface selects by folder name and its registered type
      // is a different string — see `catalog.ts`'s `CatalogEntry.target`.
      if (entry.kind === 'workflow') openWorkflow(entry.target);
      else openActor(entry.target);
    },
    [openActor, openWorkflow]
  );

  return (
    <CatalogSurface
      entries={entries}
      filter={filter}
      layout={layout}
      error={workflowFolders.error ?? actorFolders.error}
      onFilter={setFilter}
      onLayout={chooseLayout}
      onOpen={open}
      onRefresh={() => {
        workflowFolders.reload();
        actorFolders.reload();
        setNonce((n) => n + 1);
      }}
    />
  );
}

export interface CatalogSurfaceProps {
  entries: readonly CatalogEntry[];
  filter: CatalogFilter;
  layout: CardLayout;
  /** Why a folder listing failed, or `null`. An empty list because something broke and an empty
   *  list because nothing is registered are drawn differently; collapsing them is how a broken
   *  orchestrator reads as a clean install. */
  error: string | null;
  onFilter(next: CatalogFilter): void;
  onLayout(next: CardLayout): void;
  onOpen(entry: CatalogEntry): void;
  onRefresh(): void;
}

/**
 * The surface, drawn from its arguments and nothing else.
 *
 * SPLIT PROPS-IN / MARKUP-OUT, the same way `SideNav` splits `NavRail` off from the few lines that
 * read the store. Every state worth pinning — an empty registry, a filter that matches nothing, a
 * failed folder listing, each of the three densities — is reachable from a literal here, and none
 * of them is reachable through the container without a network.
 */
export function CatalogSurface({
  entries,
  filter,
  layout,
  error,
  onFilter,
  onLayout,
  onOpen,
  onRefresh,
}: CatalogSurfaceProps): JSX.Element {
  const shown = entries.filter((e) => matchEntry(e, filter));

  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <main className="dataset-page" data-testid="catalog-page">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 text-lg font-semibold">Catalog</h1>
        <span className="max-w-[72ch] text-[11.5px] text-muted-foreground">
          Everything registered on this control plane. A workflow is a caller you can run; an actor
          is a deployed worker you can call a Method on. Searching covers every Method name and the
          author’s own sentence about it, which is how you find the one that does what you need.
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onRefresh}
          title="Refresh from server"
        >
          <RefreshCw size={14} />
        </Button>
      </header>

      {error !== null && (
        <p className="m-0 text-[11px] text-destructive" data-testid="catalog-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]" data-testid="catalog-filter">
        <label className="flex min-w-[220px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1">
          <Search size={12} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            data-testid="catalog-search"
            value={filter.q}
            onChange={(e) => onFilter({ ...filter, q: e.target.value })}
            placeholder="search names, descriptions, Methods…"
            aria-label="search the catalog"
            className="min-w-0 flex-1 border-none bg-transparent outline-none"
          />
        </label>

        <Segmented
          testid="catalog-kind"
          options={KINDS.map((k) => ({ id: k.id, label: k.label, title: '' }))}
          value={filter.kind}
          onPick={(id) => onFilter({ ...filter, kind: id })}
        />
        <Segmented
          testid="catalog-layout"
          options={LAYOUTS}
          value={layout}
          onPick={onLayout}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        {STATE_CHIPS.map((chip) => (
          <Chip
            key={chip.id}
            testid={`catalog-chip-${chip.id}`}
            label={chip.label}
            title={chip.title}
            on={filter.states.includes(chip.id)}
            onClick={() => onFilter({ ...filter, states: toggle(filter.states, chip.id) })}
          />
        ))}
        <span className="mx-1 h-3 w-px bg-border" aria-hidden />
        {PLACE_CHIPS.map((chip) => (
          <Chip
            key={chip.id}
            testid={`catalog-chip-${chip.id}`}
            label={chip.label}
            title={chip.title}
            on={filter.places.includes(chip.id)}
            onClick={() => onFilter({ ...filter, places: toggle(filter.places, chip.id) })}
          />
        ))}
        {/* OFFERED ONLY WHEN IT WOULD DO SOMETHING. A permanent `clear` beside an unfiltered list is
            a control that does nothing, which teaches the reader that controls here might not. */}
        {isFiltered(filter) && (
          <button
            type="button"
            data-testid="catalog-clear"
            onClick={() => onFilter(NO_FILTER)}
            className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-px text-muted-foreground hover:text-foreground"
          >
            <X size={10} /> clear
          </button>
        )}
        {/* NEVER CONDITIONAL. A filter that hides eight entries must not read as a registry that
            lost eight, and saying both numbers always is the only defence. */}
        <span
          className="ml-auto tabular-nums text-muted-foreground"
          data-testid="catalog-count"
          data-shown={shown.length}
          data-total={entries.length}
        >
          {resultLabel(shown.length, entries.length)}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground" data-testid="catalog-empty">
          Nothing is registered on this control plane yet. Point the Actors or Workflows surface at a
          folder — <code className="font-mono">examples/python/beacon</code> is one — and it appears
          here before anything has served it. Workers that registered themselves from code on another
          machine appear here too, marked <em className="not-italic">not on this disk</em>.
        </p>
      ) : shown.length === 0 ? (
        // NOT AN EMPTY PAGE. A grid that simply went blank reads as a registry that emptied itself;
        // the sentence names the filter as the cause and the count above still says how many there
        // are.
        <p className="text-[13px] text-muted-foreground" data-testid="catalog-none-match">
          Nothing matches that filter. The catalog holds {entries.length}{' '}
          {entries.length === 1 ? 'entry' : 'entries'} — clear a chip or widen the search.
        </p>
      ) : layout === 'list' ? (
        <div className="border-t border-border" data-testid="catalog-list">
          {shown.map((entry) => (
            <CatalogCard key={entry.id} entry={entry} layout="list" onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div
          data-testid="catalog-grid"
          className={`grid items-stretch gap-3 ${
            layout === 'roomy'
              ? '[grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]'
              : '[grid-template-columns:repeat(auto-fill,minmax(214px,1fr))]'
          }`}
        >
          {shown.map((entry) => (
            <CatalogCard key={entry.id} entry={entry} layout={layout} onOpen={onOpen} />
          ))}
        </div>
      )}
    </main>
  );
}

function Segmented<T extends string>({
  testid,
  options,
  value,
  onPick,
}: {
  testid: string;
  options: ReadonlyArray<{ id: T; label: string; title: string }>;
  value: T;
  onPick(id: T): void;
}): JSX.Element {
  return (
    <div
      className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5"
      data-testid={testid}
      data-value={value}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid={`${testid}-${option.id}`}
          data-active={value === option.id ? 'true' : undefined}
          title={option.title === '' ? undefined : option.title}
          aria-pressed={value === option.id}
          onClick={() => onPick(option.id)}
          className={`rounded-md px-2.5 py-0.5 ${
            value === option.id
              ? 'bg-accent font-semibold text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Chip({
  testid,
  label,
  title,
  on,
  onClick,
}: {
  testid: string;
  label: string;
  title: string;
  on: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      data-on={on ? 'true' : undefined}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-2 py-px ${
        on
          ? 'border-primary bg-accent text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
