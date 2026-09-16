/**
 * THE CATALOG — everything this control plane knows about, as one list you can search.
 *
 * ── WHY A THIRD SURFACE OVER TWO INVENTORIES THAT ALREADY HAVE PAGES ────────────────────────────
 *
 * FINDING AND WORKING ARE DIFFERENT VERBS. The Workflows surface is where you open a thread, read a
 * run and answer it; the Actors surface is where you edit a folder, serve it and call a Method.
 * Both are built around ONE subject at a time, and both deliberately draw only what you can act on
 * — `NO FOLDER, NO ACTOR` is written at the top of `ActorsPage.tsx` and it is the right rule for a
 * page whose four verbs all need a directory on this disk.
 *
 * That rule leaves a question nothing answers: WHAT IS THERE. An operator who knows a worker
 * somewhere extracts titles cannot find it, because the Actor doing it was deployed from a checkout
 * on a droplet and so is not on the Actors page at all. An operator who wants "the thing that takes
 * a URL" has no way to ask. Two curated pages of what-you-own are not a registry, and a registry is
 * what the ⌘K-shaped question needs.
 *
 * SO THIS DRAWS BOTH SIDES OF BOTH JOINS, and marks which is which. A catalogued Actor with no
 * folder is here, labelled `not on this disk`, with its Methods and its version — everything a
 * reader needs to decide whether to go find its code. It offers no edit button, because there is
 * nothing to edit; that is a missing verb, not a missing row. The failure mode `ActorsPage` feared
 * — "a page of things you do not control is a page you stop opening" — was about a page whose whole
 * purpose is control. Browsing is not control, and a registry that hid two thirds of the registry
 * would be the more confusing artifact.
 *
 * ── WHAT IS SEARCHED, AND WHY IT IS THE POINT ───────────────────────────────────────────────────
 *
 * {@link CatalogEntry.haystack} carries the names, both versions of the description, AND every
 * Method name with the author's own sentence about it (`ActorOperation.description` — a Go
 * `Does("…")`, a Python docstring's first paragraph). That last part is the only reason this
 * surface earns its place: nothing else in the console can answer "which Actor has a Method that
 * fetches a page", and that question is asked far more often than "list me the actors".
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────────────────────────
 *
 * NO TAGS. The v2 design draws a row of tag chips, and there is nowhere for a tag to come from:
 * `actor.json` declares `schemaVersion`, `name`, `version` and resource needs, and
 * `shared/contracts/kontra/v1/catalog.proto`'s `ActorDescriptor` has seven fields, none of them a
 * label. A taxonomy invented in the browser would be a taxonomy nobody declared, unsearchable from
 * the CLI and absent from every other reader of the catalog. The chips here are FACETS over facts
 * the system actually records — what state it is in, and whether its code is on this disk — which
 * is what an operator was going to filter by anyway. Real tags are a manifest change across both
 * SDKs and the registration path, and they belong in that change.
 *
 * NO LATENCY, NO CALL RATE, NO p50. The design's card carries one and `ActorsPage.tsx` already
 * records why it cannot: nothing on either SDK's registration path carries a call rate, a p95 or an
 * in-flight count, so a card claiming one would be claiming it from nowhere.
 *
 * ── THE STATE IS THE APP'S EXISTING VOCABULARY, NOT A NEW ONE ───────────────────────────────────
 *
 * `running`, `serving`, `idle` and `unknown` are `run/workflowState.ts`'s words, with the same
 * authorities behind them and `unknown` kept distinct from `idle` for the same reason: a cluster
 * that cannot be asked must not render as "nothing is serving anything". `unserved` is the fifth,
 * and it is the one state a registry has that a work surface does not — a folder on this disk that
 * no worker has ever registered. It needs no request to establish, because having no registration
 * IS the answer.
 *
 * EVERY QUEUE HERE IS NAMED WITHOUT READING A FILE. An Actor's is `sharedQueue(name, version)`, a
 * pure function; a workflow's is the one the worker that registered it was polling, carried on the
 * descriptor. That is what keeps this page to a fixed handful of requests no matter how large the
 * registry is — the alternative, deriving a workflow's queue from its folder digest, is one source
 * read per row, which is a cost a browse surface must not pay.
 */

import { sharedQueue } from '@kontra/core/queues';

import type { Source, WorkflowDescriptor, WorkflowFile, RunRow } from '../run/api';
import { isServing, type PollerReport } from '../run/workflowState';
import type { CatalogActor } from '../types';

/** A workflow you can run, or an actor you can call a Method on. */
export type EntryKind = 'workflow' | 'actor';

/**
 * What an entry is doing — `run/workflowState.ts`'s four words plus the one a registry adds.
 *
 * `unserved` IS NOT `idle`. Idle means nothing is polling a queue that something has registered;
 * unserved means nothing ever registered at all, so there is no queue to poll and no Methods to
 * list. The first is a worker to start, the second is a serve that has never happened — different
 * sentences and different buttons.
 */
export type EntryState = 'running' | 'serving' | 'idle' | 'unserved' | 'unknown';

/** Where an entry's code is, as far as this control plane can tell. */
export type Place = 'disk' | 'elsewhere';

/** One number a card prints, with the sentence that says what it counts. */
export interface EntryFact {
  label: string;
  value: string;
  title: string;
}

export interface CatalogEntry {
  /** Stable across polls, and unique across both kinds. React keys and dedup both read it. */
  id: string;
  kind: EntryKind;
  /** What to CALL it: a workflow's declared type where one is registered, an actor's name. */
  name: string;
  /**
   * What to OPEN it with, which is not always what to call it.
   *
   * A workflow's surface selects by FOLDER name (`/workflows/<folder>`), and its registered type is
   * `DnsSweep` where the directory is `dns_sweep` — so a card that handed its display name to
   * `openWorkflow` would navigate to a workflow that does not exist and land the operator on a page
   * saying so. They are one field apart and were very nearly one field.
   */
  target: string;
  /** An actor's version. `''` for a workflow, which has none — the folder's field is empty too. */
  version: string;
  /** The author's sentence, or `''`. Never a placeholder: undescribed and described-with-nothing
   *  render differently and only one of them is actionable. */
  description: string;
  state: EntryState;
  place: Place;
  /** The registered folder's absolute path, or `''` when the code is not on this disk. */
  path: string;
  /** The Methods an Actor declares. Empty for a workflow, and empty for an Actor nothing has
   *  served — which is UNKNOWN rather than none, and the card says which. */
  methods: readonly string[];
  /** The task queue, when anything has named one. `''` for an unserved folder — see the header. */
  queue: string;
  /** Everything searchable, lowercased and joined. See the header: the Method descriptions in here
   *  are the reason this surface exists. */
  haystack: string;
  facts: readonly EntryFact[];
}

export interface CatalogFilter {
  /** Free text. Matched against {@link CatalogEntry.haystack}. */
  q: string;
  kind: 'all' | EntryKind;
  /** States to include. EMPTY MEANS EVERY STATE, not none — an empty chip row is no filter. */
  states: readonly EntryState[];
  /** Where the code is. Empty means anywhere, same rule. */
  places: readonly Place[];
}

export const NO_FILTER: CatalogFilter = { q: '', kind: 'all', states: [], places: [] };

/** Is anything narrowing the list? Drives whether a `clear` control is offered at all. */
export function isFiltered(filter: CatalogFilter): boolean {
  return (
    filter.q.trim() !== '' ||
    filter.kind !== 'all' ||
    filter.states.length > 0 ||
    filter.places.length > 0
  );
}

/**
 * `DnsSweep`, `dns_sweep` and `dnssweep.py` are one workflow to everybody but a string compare.
 *
 * A HEURISTIC, AND IT IS ALLOWED TO BE ONE. A workflow's TYPE — what `@workflow.defn` declares and
 * what a `RunRow` carries — is not its folder name, and the only authority that reconciles them is
 * the source file, which `WorkflowsPage` reads once per row. A browse surface must not pay a read
 * per row (see the file header), so it matches on the normalised name instead.
 *
 * WHAT A WRONG MATCH COSTS HERE IS BOUNDED, which is why the trade is acceptable on this surface
 * and not on the one that starts runs. A bad join makes one card say `serving` when its neighbour
 * is the one being served; clicking it still opens the workflow the operator picked, and the page
 * they land on does the real join and tells them the truth. Nothing here dispatches anything.
 */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.py$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** The state of something with a queue — the shared half of both kinds' reading. */
function servedState(
  queue: string,
  pollers: Readonly<Record<string, PollerReport>>,
  now: number
): EntryState {
  const report = pollers[queue] ?? null;
  if (isServing(report, now)) return 'serving';
  // Only after serving: `null` is "not asked yet" and an `error` is "could not be asked", and
  // neither may be drawn as "nothing is polling this".
  if (report === null || report.error !== undefined) return 'unknown';
  return 'idle';
}

/** Lowercased, de-duplicated, joined — the one string a search runs against. */
function haystackOf(parts: readonly string[]): string {
  return [...new Set(parts.filter((p) => p !== ''))].join(' ').toLowerCase();
}

export interface CatalogInput {
  /** Registered WORKFLOW folders — what is on this disk. */
  workflowFolders: readonly Source[];
  /** `.kontra/workflows/` listing, for a `description.md` a folder row did not carry. */
  workflowFiles: readonly WorkflowFile[];
  /** What workers registered about workflows: the type, its queue, its declared input. */
  descriptors: readonly WorkflowDescriptor[];
  /** Open and closed runs, joined to a descriptor by TYPE — which is the one join that needs no
   *  heuristic, because both sides carry the same string. */
  runs: readonly RunRow[];
  /** Registered ACTOR folders. */
  actorFolders: readonly Source[];
  /** What workers registered about actors, from any machine. */
  actors: readonly CatalogActor[];
  /** Poller reports by queue name. A queue with no entry is `unknown`, never un-served. */
  pollers: Readonly<Record<string, PollerReport>>;
  now: number;
}

/**
 * Every entry, in one list: workflows first, then actors, each alphabetical.
 *
 * KIND BEFORE NAME because the two are different things to do, not two spellings of one thing, and
 * an alphabetical interleave puts `beacon` between `AuthSweep` and `CrawlPages` where it reads as a
 * workflow. Within a kind, name order — the order the two existing surfaces already list in.
 */
export function buildCatalog(input: CatalogInput): CatalogEntry[] {
  return [...workflowEntries(input), ...actorEntries(input)];
}

function workflowEntries(input: CatalogInput): CatalogEntry[] {
  const { workflowFolders, workflowFiles, descriptors, runs, pollers, now } = input;

  const fileByName = new Map(workflowFiles.map((f) => [normalise(f.name), f] as const));
  const descriptorByName = new Map(descriptors.map((d) => [normalise(d.name), d] as const));

  // RUNS BY TYPE, not by folder. `RunRow.type` and `WorkflowDescriptor.name` are the same string by
  // construction — both are what `@workflow.defn` declared — so this join is exact even though the
  // folder join above is not.
  const openByType = new Map<string, number>();
  for (const run of runs) {
    if (run.status !== 'running') continue;
    openByType.set(run.type, (openByType.get(run.type) ?? 0) + 1);
  }

  const out: CatalogEntry[] = [];
  const claimed = new Set<string>();

  for (const folder of [...workflowFolders].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = normalise(folder.name);
    const descriptor = descriptorByName.get(key);
    if (descriptor) claimed.add(key);
    out.push(
      workflowEntry({
        name: descriptor?.name ?? folder.name,
        folderName: folder.name,
        description:
          descriptor?.description ?? orEmpty(folder.description) ?? fileByName.get(key)?.description,
        path: folder.absent === true ? '' : folder.path,
        place: 'disk',
        descriptor,
        open: descriptor ? openByType.get(descriptor.name) ?? 0 : 0,
        pollers,
        now,
      })
    );
  }

  // REGISTERED, BUT NOT ON THIS DISK — a workflow a worker somewhere is serving from code that is
  // not in any folder here. The Workflows surface does not draw these (its verbs all need a
  // folder); this one does, because "what is there" has to include them.
  for (const descriptor of [...descriptors].sort((a, b) => a.name.localeCompare(b.name))) {
    if (claimed.has(normalise(descriptor.name))) continue;
    out.push(
      workflowEntry({
        name: descriptor.name,
        folderName: descriptor.name,
        description: descriptor.description,
        path: '',
        place: 'elsewhere',
        descriptor,
        open: openByType.get(descriptor.name) ?? 0,
        pollers,
        now,
      })
    );
  }

  return out;
}

/** `''` is a value here and `undefined` is not — the two mean different things upstream. */
function orEmpty(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s;
}

function workflowEntry(args: {
  name: string;
  folderName: string;
  description: string | undefined;
  path: string;
  place: Place;
  descriptor: WorkflowDescriptor | undefined;
  open: number;
  pollers: Readonly<Record<string, PollerReport>>;
  now: number;
}): CatalogEntry {
  const { name, folderName, description, path, place, descriptor, open, pollers, now } = args;
  const queue = descriptor?.queue ?? '';
  /* NO DESCRIPTOR MEANS NOTHING EVER SERVED IT, which is a fact about this workflow and not a gap
     in what was read — so it needs no queue, no request and no `unknown`. A descriptor WITH no
     queue is a different thing (an older SDK, or a worker that never named one) and falls through
     to `unknown`, because the question was asked and could not be answered. */
  const state: EntryState =
    descriptor === undefined
      ? 'unserved'
      : open > 0
      ? 'running'
      : queue === ''
      ? 'unknown'
      : servedState(queue, pollers, now);

  const facts: EntryFact[] = [];
  if (open > 0) {
    facts.push({
      label: open === 1 ? 'run open' : 'runs open',
      value: String(open),
      title: 'executions of this workflow Temporal currently reports as running',
    });
  }
  /* THE DECLARED INPUT, as a count of fields. It is the one thing about a workflow that tells a
     reader whether starting it needs anything of them, and it is already in the descriptor — the
     Run form is built from exactly this. A descriptor whose author declared nothing carries no
     `input` at all, which is not the same as declaring an empty one, so nothing is printed. */
  const fields = countFields(descriptor?.input);
  if (fields !== null) {
    facts.push({
      label: fields === 1 ? 'input field' : 'input fields',
      value: String(fields),
      title:
        fields === 0
          ? 'this workflow declares an input type with no properties — it takes any object'
          : 'properties the declared input type has; the Run form on the Workflows surface is built from them',
    });
  }

  return {
    id: `workflow:${folderName}`,
    kind: 'workflow',
    name,
    target: folderName,
    version: '',
    description: description ?? '',
    state,
    place,
    path,
    methods: [],
    queue,
    haystack: haystackOf([name, folderName, description ?? '', queue]),
    facts,
  };
}

/** How many properties a declared input has — `null` when the author declared no input at all. */
function countFields(schema: unknown): number | null {
  if (schema === null || typeof schema !== 'object') return null;
  const props = (schema as { properties?: unknown }).properties;
  if (props === null || props === undefined || typeof props !== 'object') return 0;
  return Object.keys(props as Record<string, unknown>).length;
}

/**
 * `0.10.0` is newer than `0.9.0`, which a string compare gets backwards.
 *
 * Numeric where both segments are numeric, lexical where either is not — a version is whatever the
 * author put in `actor.json` and nothing constrains it to semver, so this has to degrade rather
 * than throw.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const sa = pa[i] ?? '';
    const sb = pb[i] ?? '';
    const na = Number(sa);
    const nb = Number(sb);
    const numeric = sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb);
    const cmp = numeric ? na - nb : sa.localeCompare(sb);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function actorEntries(input: CatalogInput): CatalogEntry[] {
  const { actorFolders, actors, pollers, now } = input;

  const folderFor = new Map<string, Source>();
  for (const folder of actorFolders) {
    // SAME SCORING THE ACTORS PAGE USES, and it is deliberately not re-derived here: the path is
    // the strong match and the name is the fallback. It is written as a map rather than a call to
    // `catalogForFolder` because this loop needs the join in the OTHER direction — actor → folder —
    // for the rows that have no folder at all.
    folderFor.set(`${folder.name}@${folder.version}`, folder);
    if (!folderFor.has(folder.name)) folderFor.set(folder.name, folder);
  }

  /**
   * ONE ENTRY PER ACTOR NAME, NOT PER VERSION — and this was the other way round first.
   *
   * On this installation the catalog holds 29 rows for 14 actors: `cachebuster` six times,
   * `crawl4ai` three, every one of them a deploy that happened. A registry that lists each is a
   * page where finding `cachebuster` means reading six identical cards, and it is the same noise
   * `ActorsPage` already removed for the same reason — "four `cachebuster` rows are one card rather
   * than four".
   *
   * IT IS ALSO WHAT MAKES THE STATE AFFORDABLE. Every version is a distinct shared queue, so one
   * row per version meant 42 `DescribeTaskQueue` calls — measured at 4 seconds wall-clock for the
   * set — on a page whose whole job is browsing. Collapsing removes half of them outright.
   *
   * WHAT IT COSTS is honest and is stated on the card: the state shown is the CHOSEN version's, so
   * an old version still being served by somebody is not visible here. The Actors surface is where
   * that question gets answered properly, and the card says how many versions there are.
   */
  const byName = new Map<string, CatalogActor[]>();
  for (const actor of actors) {
    byName.set(actor.name, [...(byName.get(actor.name) ?? []), actor]);
  }

  const out: CatalogEntry[] = [];
  const served = new Set<string>();

  for (const name of [...byName.keys()].sort((a, b) => a.localeCompare(b))) {
    const versions = [...byName.get(name)!].sort((a, b) => compareVersions(a.version, b.version));
    const folderOf = (a: CatalogActor): Source | undefined =>
      actorFolders.find((f) => a.source !== undefined && a.source !== '' && f.path === a.source) ??
      folderFor.get(`${a.name}@${a.version}`) ??
      folderFor.get(a.name);
    /* THE VERSION ON THIS DISK WINS, and only then the highest. A directory holding 0.3.0 with four
       older deploys behind it is the code the operator can actually open, so it is the one the card
       should be about — the same rule `catalogForFolder` applies, from the other side. */
    const actor = versions.find((a) => folderOf(a) !== undefined) ?? versions[versions.length - 1]!;
    const folder = folderOf(actor);
    if (folder) served.add(folder.id);
    const queue = sharedQueue(actor.name, actor.version);
    const methods = actor.operations.map((o) => o.name);

    const facts: EntryFact[] = [
      {
        label: methods.length === 1 ? 'method' : 'methods',
        value: String(methods.length),
        title: 'Methods this version declares — each one dispatchable by name',
      },
    ];
    if (versions.length > 1) {
      facts.push({
        label: 'versions',
        value: String(versions.length),
        title: `${versions.map((v) => v.version).join(', ')} — this card is about ${
          actor.version
        }, which is the one on this disk where there is one and the highest otherwise. An older version somebody is still serving is not counted in the state here; the Actors surface is where that is answered.`,
      });
    }

    out.push({
      id: `actor:${actor.key}`,
      kind: 'actor',
      name: actor.name,
      target: actor.name,
      version: actor.version,
      description: describeActor(actor),
      state: servedState(queue, pollers, now),
      place: folder && folder.absent !== true ? 'disk' : 'elsewhere',
      path: folder && folder.absent !== true ? folder.path : '',
      methods,
      queue,
      // THE METHODS AND THEIR AUTHORS' SENTENCES, ACROSS EVERY VERSION. This is the line that makes
      // "which actor fetches a page" answerable, and it is the whole argument for this surface —
      // see the file header. Searching spans the versions the card collapsed, because a Method that
      // existed in 0.2.0 and was renamed in 0.3.0 is still how somebody remembers it.
      haystack: haystackOf([
        actor.name,
        ...versions.map((v) => v.version),
        folder?.description ?? '',
        ...versions.flatMap((v) => v.operations.flatMap((o) => [o.name, o.description ?? ''])),
      ]),
      facts,
    });
  }

  // A FOLDER NOTHING HAS SERVED IS STILL AN ENTRY, marked `unserved`, because register → serve →
  // call starts there. It claims no deployment: its Methods are UNKNOWN rather than absent, which
  // is why `methods` is empty and the card says which.
  for (const folder of [...actorFolders].sort((a, b) => a.name.localeCompare(b.name))) {
    if (served.has(folder.id)) continue;
    out.push({
      id: `actor:folder:${folder.id}`,
      kind: 'actor',
      name: folder.name,
      target: folder.name,
      version: folder.version,
      description: folder.description,
      state: 'unserved',
      place: 'disk',
      path: folder.absent === true ? '' : folder.path,
      methods: [],
      queue: '',
      haystack: haystackOf([folder.name, folder.version, folder.description]),
      facts: [],
    });
  }

  return out;
}

/**
 * An Actor's sentence — its first Method's description, when the Actor itself carries none.
 *
 * THERE IS NO ACTOR-LEVEL DESCRIPTION IN THE DESCRIPTOR. `ActorDescriptor` has seven fields and
 * none of them says what the Actor is for; only `ActorOperation.description` exists, per Method. An
 * Actor with one Method — which is most of them, and was ALL of them before ADR 0023 §9 — is
 * described exactly as well by that Method's sentence, so borrowing it is honest. An Actor with
 * several says nothing rather than picking one, because "fetches a page" printed under an Actor
 * that also extracts titles and follows redirects is a summary that misleads.
 */
function describeActor(actor: CatalogActor): string {
  if (actor.operations.length !== 1) return '';
  return actor.operations[0]?.description ?? '';
}

/** Does one entry survive the filter? Each clause is AND; within the chip rows it is OR. */
export function matchEntry(entry: CatalogEntry, filter: CatalogFilter): boolean {
  if (filter.kind !== 'all' && entry.kind !== filter.kind) return false;
  if (filter.states.length > 0 && !filter.states.includes(entry.state)) return false;
  if (filter.places.length > 0 && !filter.places.includes(entry.place)) return false;
  const q = filter.q.trim().toLowerCase();
  if (q === '') return true;
  // EVERY WORD, IN ANY ORDER. `fetch page` must find a Method described "fetch one page of results"
  // — a single `includes` of the whole string would not, and typing two words is how anybody
  // narrows a list.
  return q.split(/\s+/).every((word) => entry.haystack.includes(word));
}

/**
 * The queues this page has to ask about, deduplicated and sorted.
 *
 * A STABLE, SORTED LIST BECAUSE THE PAGE DEPENDS ON IT. `buildCatalog` returns a new array on every
 * poll, and an array in an effect's dependencies tears down and restarts the interval several times
 * a minute — which, on a page whose numbers are about how long ago something happened, is how the
 * measurement never gets old enough to be interesting. `ActorsPage` learned this the same way.
 *
 * AN ENTRY WITH NO QUEUE CONTRIBUTES NOTHING, which is the `unserved` case: nothing registered it,
 * so there is no queue in existence to describe and asking would be asking about a string this page
 * invented.
 */
export function queuesOf(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((e) => e.queue).filter((q) => q !== ''))].sort();
}

/** What the count beside the chips says. The denominator is NEVER conditional — a filter that hides
 *  eight entries must not read as a registry that lost eight. */
export function resultLabel(shown: number, total: number): string {
  if (total === 0) return 'nothing registered';
  if (shown === total) return `${total} ${total === 1 ? 'entry' : 'entries'}`;
  return `${shown} of ${total} entries`;
}
