<script lang="ts">
  /**
   * Runs — every run this control plane has seen, and one run as its record.
   *
   * The surface lists every run newest-first and opens one to its record: the input it was started
   * with, the output it produced, and — the part this stage is about — its LOG and its output
   * DATASET, each showing a dropped/errored unit's FULL error and WHICH RECORD it happened on.
   *
   * TWO HOMES FOR "WHICH RECORD + FULL ERROR", because there are two mechanisms (recon, kontra#28):
   *   • a DATASET-error (capped / erratic / voided) is a successful emit — a row whose `error` /
   *     `void_reason` COLUMN carries the whole text, keyed by the record's own columns (host,
   *     endpoint, point, node…). It is read in the Dataset region below.
   *   • a DROPPED/logged error is a LOG line: the full message, plus the record stamped into its
   *     stream `fields` (`host`/`point`/`error`…). It is read in the Log region, via `LogsRail`.
   * Neither is summarised. A "1 unit dropped" count with no error and no record is exactly the
   * thing this stage removes.
   *
   * TWO STATUS WORDS, NEVER ONE VERDICT — `executionOf` / `materializationOf` (`runState.ts`).
   * NO ROUTER — the surface reads `location` and writes it with `history.pushState`.
   */
  import {
    fetchRuns,
    fetchRun,
    fetchRunHistory,
    fetchWorkflows,
    type RunEvent,
    type RunRow,
    type RunDetail,
  } from '@kontra/console-core/run/api';
  import { startedAtText, shortSeconds } from '@kontra/console-core/run/steps';
  import { runScopedSql } from '@kontra/console-core/datasets/query';
  import {
    datasetLabel,
    fetchRunDatasets,
    lakeMaterialization,
    fetchRunIO,
    pairsOf,
    type RunDataset,
    type RunIO,
  } from '@kontra/console-core/run/record';
  import { executionOf, materializationOf } from '@kontra/console-core/run/runState';
  import { newestFirst, type LogRecord } from '@kontra/console-core/run/logs';
  import { LogStream } from '../logs/stream.svelte';
  import { followRows } from '../datasets/liveRows';
  import {
    ROW_TAIL_START,
    rowTailLabel,
    rowTailTrimmed,
    rowTailWindow,
    type RowTailState,
  } from '@kontra/console-core/datasets/rowTail';
  import { fetchPreview, type DatasetPreview } from '@kontra/console-core/datasets/preview';
  import { plainText } from '@kontra/console-core/panels/prose';
  import { schemaFields, type FieldNode } from '@kontra/console-core/panels/schemaTree';
  import { formatAddress, parseAddress } from '@kontra/console-core/state/address';
  import { followRun, type Follow } from '../workflows/runStream';
  import LogsRail from '../workflows/LogsRail.svelte';
  import Asks from '../workflows/Asks.svelte';
  import Progress from './Progress.svelte';
  import Drawer from './Drawer.svelte';
  import Rack from './Rack.svelte';
  import Report from '../report/Report.svelte';
  import { loadRack } from './fleetLoad';
  import { fleetStacksOf, type Rack as RackView } from '@kontra/console-core/run/fleet';
  import type { Missing } from '../infra/load';

  function runFromUrl(): string | null {
    const a = parseAddress(location.pathname + location.search);
    return a !== null && a.view === 'runs' ? a.run : null;
  }

  /**
   * Which face of the run the address asks for — its record, or its **Report** (ADR 0055).
   *
   * READ HERE BECAUSE THE SURFACE OWNS EVERYTHING BELOW ITS FIRST SEGMENT. `App.svelte` maps `runs` to
   * this component and nothing else; a second surface for `/runs/<id>/report` is not available, so the
   * report is a branch at the top of this one rather than a page of its own. That is also why it is a
   * branch and not a tab: there is no page-level tab strip here to add to, and building one would be a
   * change to 1700 lines this feature should not take on.
   */
  function tabFromUrl(): 'report' | null {
    const a = parseAddress(location.pathname + location.search);
    return a !== null && a.view === 'runs' ? a.tab : null;
  }

  let openRun = $state<string | null>(runFromUrl());
  let openTab = $state<'report' | null>(tabFromUrl());
  let rows = $state<RunRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  // detail
  let detail = $state<RunDetail | undefined>(undefined);
  let detailErr = $state('');
  /**
   * THE LOG RAIL HAS ITS OWN SUBSCRIPTION, AND THAT IS THE WHOLE POINT OF THIS OBJECT.
   *
   * IT USED TO BE `fetchLogs(id)` INSIDE `refresh()`, AND `refresh()` ONLY RUNS WHEN THE RUN'S
   * PAYLOAD DIFFERS. Read that sentence twice, because it is the bug: a Run spends its opening
   * phase holding a Fleet lease and resolving a Bundle, during which NOTHING about the run's
   * payload changes — so no frame is emitted, `refresh` is never called, and the rail is never
   * re-read. MEASURED on canary-1790684761: 29s in `holdFleetLease`, then 33s in `resolveBundle`,
   * and the page sat on `Logs 0` for 62 of the run's 110 seconds while the actor's lines were
   * already queryable in VictoriaLogs. Then the run changed, `refresh` fired, and 85 lines landed
   * at once. "Nothing, nothing, nothing, then everything" is not a rendering artefact — it is a
   * rail slaved to the wrong clock.
   *
   * Logs do not change when the run's STATE changes; they change when something WRITES one. So
   * they get the signal that actually corresponds: `/api/logs/tail`, scoped to this run, which is
   * the same transport the Logs page has always used. `LogStream` backfills 300 lines on open so a
   * cold view is not empty, holds tail frames until the backfill lands, and merges them without
   * rendering the overlap twice.
   *
   * THIS IS NOT A POLL and `scripts/no-polling.mjs` is right to keep forbidding one. It is one
   * server-sent stream per open run, which is what ADR 0048 §3 asks for in place of an interval.
   */
  const logStream = new LogStream();
  /**
   * NEWEST FIRST, AND THAT REVERSAL IS NOT COSMETIC.
   *
   * `LogStream` is shared with the Logs page, which is a TERMINAL: it reads downward, so `backfill`
   * sorts ascending and says so. `LogsRail` is not a terminal — it answers "why did this run do
   * that", and the line that answers it is the last one written. Its own documentation calls it
   * newest-first, and the rail renders `records` in the order it is handed them.
   *
   * The order flipped when this surface moved from `fetchLogs(id)` (which applied `newestFirst`) to
   * `LogStream` for the reason written above — the rail had been slaved to the run's payload clock
   * and sat on `Logs 0` for 62 of a 110-second run. That change was right and the ordering came
   * along by accident, which is why the reversal belongs HERE rather than in either shared piece:
   * the stream stays ascending for the terminal, and the rail gets what the rail is for.
   */
  const logs = $derived(newestFirst(logStream.lines as LogRecord[]));
  /**
   * Loading is "the tail has not connected AND the backfill has not answered". Either one landing
   * means the rail can say something true, and `reachable` is what distinguishes a quiet fleet
   * from a broken backend — see `stream.svelte.ts` for the 20-seconds-of-no-headers measurement
   * that put that field there.
   */
  const logsLoading = $derived(logStream.phase === 'connecting' && !logStream.reachable);
  /** The tail's sentence, or the backfill's when the tail is fine and the history is missing. */
  const logsErr = $derived(logStream.error || logStream.historyError || null);
  let preview = $state<DatasetPreview | undefined>(undefined);
  let previewErr = $state('');
  /** The Dataset partitions the LAKE attributes to this run — the authority, see `record.ts`. */
  let datasets = $state<RunDataset[]>([]);
  let datasetsErr = $state('');
  /** The lake read is in flight. `datasets.length === 0` cannot stand in for this: it is also what
   *  a run that wrote nothing looks like, and the handle has to tell those apart. */
  let datasetsLoading = $state(false);
  /** Which of them is previewed. A run can write several; the first is the one opened. */
  let shownDataset = $state<RunDataset | undefined>(undefined);
  /** What this run was STARTED with and what it RETURNED. Not the schema — the run. */
  let io = $state<RunIO | undefined>(undefined);
  let ioErr = $state('');
  let ioGone = $state(false);
  // The workflow's declared input/output schemas. They no longer supply the VALUES — `io` does —
  // but they still supply the ORDER a field is read in and the author's sentence about it, which
  // a decoded payload does not carry.
  let inputFields = $state<FieldNode[]>([]);
  let outputFields = $state<FieldNode[]>([]);

  /**
   * The run's event history — what the Progress region reduces into steps.
   *
   * A FIFTH INDEPENDENT READ, on the same terms as the other four: a history Temporal has dropped
   * must not blank the Dataset the run wrote. `fetchRunHistory` answers `null` for both "dropped
   * for retention" and "no first event yet", which are the two ordinary absences.
   */
  let events = $state<RunEvent[]>([]);
  let historyErr = $state('');
  let historyLoading = $state(false);
  /** Which workflow type the declared schemas were read for, so a poll does not re-read them. */
  let schemasFor = $state('');

  /**
   * THE MACHINES THIS RUN STOOD UP — read from Pulumi, drawn by {@link Rack}.
   *
   * A SIXTH INDEPENDENT READ, on the same terms as the other five: it fails on its own and blanks
   * nothing else. It is also the only one whose SUBJECT comes out of another read — the Fleet
   * children are `RunEvent.link`s off the history this page already fetched, so there is no
   * discovery request and no way to draw a Fleet this run did not start.
   */
  let rack = $state<RackView>({ fleets: [], machines: 0, priceMonthly: 0, converging: false });
  let rackMissing = $state<readonly Missing[]>([]);
  let rackLoading = $state(false);

  const fleetLinks = $derived(fleetStacksOf(events));

  /**
   * A STABLE SIGNATURE OF THE FLEET SET, and the reason it is a string.
   *
   * `fleetLinks` is a fresh array on every history read, so an effect that depended on it would
   * re-read Pulumi on EVERY frame the run stream delivers — and on a long crawl the stream delivers
   * one every second or two because the batch counts are moving. That is three Fleets × two routes
   * per frame, and one of those routes queries a CLOSED workflow, which Temporal serves by REPLAYING
   * its history. Replaying three finished converges a second to re-learn that they are still
   * finished is the polling this console removed, wearing a different hat.
   *
   * So the set is reduced to what would actually change the drawing, and the read is keyed on that.
   * While a converge is in flight the second effect below keeps it moving instead.
   */
  const fleetKey = $derived(
    fleetLinks.map((l) => `${l.fqn}:${l.execId ?? ''}:${l.closed}:${l.failed}`).join('|')
  );

  async function readRack(id: string): Promise<void> {
    try {
      const got = await loadRack(fleetLinks);
      if (openRun !== id) return; // run A's Machines must never appear under run B's heading
      rack = got.rack;
      rackMissing = got.missing;
    } catch (e) {
      if (openRun === id) rackMissing = [{ url: 'the Fleet read', status: 0, why: say(e) }];
    } finally {
      if (openRun === id) rackLoading = false;
    }
  }

  /**
   * WHICH DRAWER IS OPEN — the Dataset rows and the log rail, out of the page's flow.
   *
   * They are the two regions that GROW while a run is going, and in a column they push everything
   * under them down for the whole run. Behind a drawer they cannot push anything, and the page
   * above settles at second one. See `Drawer.svelte` for the measurement.
   */
  let drawer = $state<'logs' | 'dataset' | null>(null);

  /**
   * How much each feed held when its drawer was last open.
   *
   * The one real cost of hiding a live feed is missing it arrive, so the handle has to say when
   * something landed that nobody has looked at. Seeded on open rather than on load: a run opened
   * with 15 lines already in it has not been read, and marking the handle is correct.
   */
  let seenLogs = $state(0);
  let seenRows = $state(0);

  /**
   * A clock for the elapsed readout and for drawing an in-flight step against something.
   *
   * A `setTimeout` CHAIN AND NOT `setInterval`, and the difference is not cosmetic. `no-polling.mjs`
   * bans the call outright — deliberately narrowly, because "a broad rule gets suppressed" — and
   * `setTimeout` is named as allowed. This qualifies on the rule's own terms rather than by
   * wording: it ASKS NOBODY ANYTHING. There is no fetch behind it, no server is woken, and the value
   * it writes is `Date.now()`. A poll is stale for its interval and then jumps; a clock that reads
   * the clock cannot be stale.
   *
   * Only while something can still change. A settled run's numbers are final, and a wakeup per
   * second on a page full of them buys no new information.
   */
  let nowMs = $state(Date.now());
  $effect(() => {
    if (detail?.settled !== false) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      nowMs = Date.now();
      t = setTimeout(tick, 1000);
    };
    t = setTimeout(tick, 1000);
    return () => clearTimeout(t);
  });

  function open(id: string | null): void {
    history.pushState({}, '', formatAddress({ view: 'runs', run: id, tab: null }));
    openRun = id;
  }

  $effect(() => {
    const onPop = (): void => {
      openRun = runFromUrl();
      openTab = tabFromUrl();
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  });

  $effect(() => {
    loading = true;
    error = '';
    fetchRuns()
      .then((r) => (rows = r))
      .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)))
      .finally(() => (loading = false));
  });

  // The list drives the detail header's two status words from the same RunRow.
  const current = $derived(rows.find((r) => r.runId === openRun));

  /** How the page knows the run changed. `connecting` until the first frame lands. */
  let follow = $state<Follow<RunDetail>>({ state: 'connecting' });

  /**
   * Bumped on every frame the run stream delivers. {@link Asks} re-reads on it.
   *
   * A COUNTER AND NOT THE FRAME, because an answer is not instant: the POST that answers a question
   * returns when the signal is DELIVERED, not when the workflow has acted on it, so re-reading in
   * the same tick shows the question still pending under a run that has already moved on. The
   * stream is what says it actually moved — the same cadence the rest of this page rides, and not
   * a timer.
   */
  let revision = $state(0);

  /** One refresh in flight at a time. A slow history read must not queue three more behind it. */
  let refreshing = false;

  const say = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /**
   * Everything a run's record is made of.
   *
   * FIVE INDEPENDENT READS, AND ONE FAILING MUST NOT BLANK THE OTHERS. They answer from different
   * authorities — Temporal for the status, the history and the payloads, VictoriaLogs for the
   * rail, the lake for the Dataset — and a run whose execution Temporal has dropped for retention
   * still has rows and log lines worth showing. Each keeps its own error so the page can say WHICH
   * part is missing instead of rendering as if the run were empty.
   *
   * EVERY WRITE IS GUARDED ON `openRun === id`. These are re-entered on a timer now, so an answer
   * can arrive after the reader has opened a different run — and painting run A's rows under run
   * B's heading is the one failure worse than showing nothing.
   */
  async function refresh(id: string): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    const mine = (): boolean => openRun === id;
    try {
      await Promise.allSettled([
        fetchRunHistory(id)
          .then((h) => { if (mine()) { events = h?.events ?? []; historyErr = ''; } })
          .catch((e: unknown) => { if (mine()) historyErr = say(e); })
          .finally(() => { if (mine()) historyLoading = false; }),

        fetchRun(id)
          .then((d) => {
            if (!mine()) return;
            detail = d;
            // The declared schemas supply the ORDER a field is read in and the author's sentence
            // about it, which a decoded payload does not carry. They do not change while a run
            // runs, so they are read once per type rather than on every poll.
            if (d.type && d.type !== schemasFor) {
              schemasFor = d.type;
              void fetchWorkflows()
                .then((w) => {
                  if (!mine()) return;
                  const desc = w.registered.find((r) => r.name === d.type);
                  inputFields = schemaFields(desc?.input) ?? [];
                  outputFields = schemaFields(desc?.output) ?? [];
                })
                .catch(() => {});
            }
          })
          .catch((e: unknown) => { if (mine()) detailErr = say(e); }),

        /**
         * THE DATASET COMES FROM THE LAKE, NOT FROM `materializationRecords`.
         *
         * That field is the ADR 0017 ledger's, and it is EMPTY for every v2 Run — `publishBatch`
         * writes lake rows and no ledger record. The region read it, found nothing, and printed
         * "This run recorded no output Dataset" over ten rows the lake had stamped with this run.
         *
         * THE PARTITION IS ADDRESSED IN FULL. `version` and `dt` ride into the preview, so what is
         * shown is THIS run's rows — asking by name alone returns whichever run wrote that name
         * last, which on a Dataset several runs append to is somebody else's data.
         */
        fetchRunDatasets(id)
          .then(async (ds) => {
            if (!mine()) return;
            datasets = ds;
            datasetsErr = '';
            const first = ds[0];
            if (!first) return;
            shownDataset = first;
            try {
              const p = await fetchPreview({
                dataset: first.name,
                kind: first.kind || 'output',
                ...(first.version ? { version: first.version } : {}),
                ...(first.dt ? { dt: first.dt } : {}),
                limit: 50,
              });
              if (mine()) { preview = p; previewErr = ''; }
            } catch (e) {
              if (mine()) previewErr = say(e);
            }
          })
          .catch((e: unknown) => { if (mine()) datasetsErr = say(e); })
          .finally(() => { if (mine()) datasetsLoading = false; }),

        // `undefined` means Temporal has dropped the execution — an ordinary answer for an old
        // run, and a different fact from "this run was started with nothing".
        fetchRunIO(id)
          .then((r) => { if (mine()) { io = r; ioGone = r === undefined; } })
          .catch((e: unknown) => { if (mine()) ioErr = say(e); }),

        // NO LOG READ HERE. The rail is on `/api/logs/tail` (see `logStream`) precisely because
        // this function does not run often enough to be a log clock — it runs when the RUN
        // changed, and a run can be silent for a minute while its actor is not.
      ]);
    } finally {
      refreshing = false;
    }
  }

  /** Opening a run: clear the last one, then read. */
  $effect(() => {
    const id = openRun;
    detail = undefined;
    detailErr = '';
    preview = undefined;
    previewErr = '';
    datasets = [];
    datasetsErr = '';
    shownDataset = undefined;
    io = undefined;
    ioErr = '';
    ioGone = false;
    inputFields = [];
    outputFields = [];
    schemasFor = '';
    events = [];
    historyErr = '';
    rack = { fleets: [], machines: 0, priceMonthly: 0, converging: false };
    rackMissing = [];
    rackLoading = false;
    drawer = null;
    seenLogs = 0;
    seenRows = 0;
    datasetsLoading = id !== null;
    historyLoading = id !== null;
    if (id === null) return;
    void refresh(id);
  });

  /**
   * KEEP READING WHILE IT IS OPEN — ON THE SERVER'S WORD, NOT ON A TIMER.
   *
   * THIS WAS A TWO-SECOND `setInterval` AND THAT WAS THE WRONG FIX. The page used to read ONCE: five
   * fetches when a run opened and nothing ever again, so a run that took a minute sat on whatever
   * was true in its first second — measured, a canary showing "bringing up the fleet" sixteen
   * minutes after it had finished, with a reload as the only way to learn otherwise. A run page that
   * is wrong until you reload is worse than one that says nothing, because it looks like an answer.
   *
   * An interval fixed that and broke something else. ADR 0048 §3 and `scripts/no-polling.mjs`
   * forbid it in this bundle, and the reason is the same failure in slower motion: "a polled surface
   * is stale for its interval and then JUMPS, which is the thing this console exists to stop doing".
   * Five reads per tab per two seconds, against Temporal, VictoriaLogs and the lake, most of them
   * answering the same bytes.
   *
   * `/api/runs/:id/stream` already exists and already says when a run changed — one read
   * server-side, fanned out to every open tab, emitted only when the payload DIFFERS. So the stream
   * is what triggers the re-read, exactly as `Workflows.svelte` already does it: "the stream says
   * the run changed; the history endpoint says how".
   *
   * THE FRAME'S OWN `run` IS USED FOR `detail`, so the status the page shows is the one that woke
   * it — and `refresh` then brings the other four into line. Painting the frame and re-reading are
   * not two sources: the frame carries `runs.read`, which is what `fetchRun` returns.
   *
   * AND THE SETTLE TAIL SURVIVES, because it was never about the interval. `settled` is Temporal and
   * the ledger agreeing the run is over; the LAKE is a third authority and commits a moment later.
   * Measured: a canary reported `Finished in 46.2s` with `Dataset 0` beside it, and the rows — six
   * of them — were queryable four seconds afterwards. The server closes the stream ten seconds after
   * terminal, so the last frame can still land before the lake has; these two `setTimeout`s are what
   * make the page's final word about the output true. They are not a poll and the guard agrees:
   * bounded, twice, on an event that does not repeat.
   */
  $effect(() => {
    const id = openRun;
    if (id === null) return;
    follow = { state: 'connecting' };
    return followRun<RunDetail>(id, (f) => {
      follow = f;
      if ((f.state === 'live' || f.state === 'ended') && f.run) detail = f.run;
      if (f.state === 'live' || f.state === 'ended') {
        revision += 1;
        void refresh(id);
      }
    });
  });

  /**
   * FOLLOW THIS RUN'S LOGS FOR AS LONG AS IT IS OPEN — independently of the run's own stream.
   *
   * `run_id` is the field every shipped line carries (`control/images/logline.py` stamps it, and
   * the actor's Temporal context supplies it), so one LogsQL term scopes the tail to this Run. It
   * is JSON-quoted rather than interpolated bare because a Run id contains characters LogsQL reads
   * as syntax, and an id that parses as a query is an id that silently matches the wrong lines.
   *
   * `start` returns its own teardown, so leaving the run closes the stream — `$effect` takes it
   * directly.
   */
  $effect(() => {
    const id = openRun;
    if (id === null) return;
    return logStream.start(`run_id:${JSON.stringify(id)}`);
  });

  $effect(() => {
    const id = openRun;
    if (id === null || !settled) return;
    const timers = [1_500, 5_000].map((ms) => setTimeout(() => void refresh(id), ms));
    return () => timers.forEach(clearTimeout);
  });

  /**
   * READ THE FLEETS WHEN THE SET OF THEM CHANGES — a Fleet started, or one closed.
   *
   * Keyed on {@link fleetKey} and not on the links array: see that derivation for what depending on
   * the array itself would cost on a run whose stream is busy.
   */
  $effect(() => {
    const id = openRun;
    const key = fleetKey;
    if (id === null || key === '') return;
    // READS NOTHING THIS EFFECT WRITES. `rackLoading = rack.fleets.length === 0` was the first
    // spelling and it is a self-triggering effect: reading `rack` makes it a dependency, `readRack`
    // replaces `rack`, and the effect re-runs and reads again — a fetch loop with no timer in it,
    // which every test in this repo would pass. Whether the region should say "reading…" is the
    // component's decision and it already makes it (`loading && rack.fleets.length === 0`), so the
    // flag here is unconditional and `readRack` clears it.
    rackLoading = true;
    void readRack(id);
  });

  /**
   * KEEP READING WHILE A CONVERGE IS IN FLIGHT — and only while one is.
   *
   * ── THIS IS A POLL, AND IT IS THE ONE THING HERE THAT COULD NOT BE PUSHED ───────────────────────
   *
   * Everything else on this page rides `/api/runs/:id/stream`: one read server-side, fanned out to
   * every tab, emitted only when the payload DIFFERS. That is the right shape and it cannot cover
   * this. The stream's payload is `runs.read`, whose own header pins it as the single authority the
   * stream may not outgrow — and a bring-up changes NOTHING in it. Measured on the canary: 34 of 57
   * seconds are the Fleet, and the run view is byte-identical across all of them, so the stream is
   * silent for exactly the window this region exists to draw.
   *
   * The other push would be a second SSE route for the Fleet. It is gated by
   * `KONTRA_STATE_TOKEN` — correctly, it names Machines — and `EventSource` cannot send a bearer and
   * does not go through this console's wrapped `fetch` (`core/run/logstream.ts`), so subscribing to a
   * gated stream means hand-parsing SSE frames off a `fetch` body. That is the better end state and
   * it is not what makes this feature work; it is noted rather than pretended away.
   *
   * ── SO IT IS BOUNDED THREE WAYS, AND EACH BOUND IS LOAD-BEARING ────────────────────────────────
   *
   *   • Only while Pulumi is actually converging. `rack.converging` is TEMPORAL's status for the
   *     stack workflow, not the phase it stored — see `deriveRack`. The moment the last converge
   *     ends this effect stops scheduling, which is why there is no `clearInterval` anywhere: the
   *     chain has no next link.
   *   • Only while the RUN is unsettled, the same guard the elapsed clock above uses. A settled run
   *     whose converge still reports RUNNING is a wedge, and re-reading it every two seconds for as
   *     long as the tab is open would neither learn nor fix anything.
   *   • Only while this run is open. `readRack` drops its answer if the reader moved on.
   *
   * A `setTimeout` chain rather than `setInterval`, for `Progress`'s reason: each wakeup is armed by
   * the answer before it, so a slow read cannot queue three more behind itself.
   */
  $effect(() => {
    const id = openRun;
    if (id === null || !rack.converging || detail?.settled !== false) return;
    const t = setTimeout(() => void readRack(id), 2_000);
    return () => clearTimeout(t);
  });

  /**
   * The run's ARGUMENT, in the order the workflow declares its fields — and every key the payload
   * carries that the schema does not mention.
   *
   * ORDER FROM THE SCHEMA, VALUES FROM THE RUN. An author lists a record's fields in the order
   * they want them read, and a decoded JSON object has whatever order it was serialised in. The
   * schema also carries the only sentence explaining what a field means.
   *
   * THE LEFTOVERS ARE NOT DROPPED. A run started before a field was removed, or by the CLI with a
   * key the form has no control for, still passed that key — and a record that silently omitted it
   * would be a record of something other than what happened.
   */
  const inputRows = $derived.by(() => {
    const given = new Map(pairsOf(io?.input).map((p) => [p.name, p.value]));
    const declared = inputFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? '',
      value: given.get(f.name),
      given: given.has(f.name),
      fallback: f.default,
    }));
    const named = new Set(inputFields.map((f) => f.name));
    const extra = [...given]
      .filter(([k]) => !named.has(k))
      .map(([name, value]) => ({ name, type: '', description: '', value, given: true, fallback: undefined }));
    return [...declared, ...extra];
  });

  /** The run's RESULT, joined to the declared output schema the same way. */
  const outputRows = $derived.by(() => {
    const got = new Map(pairsOf(io?.output).map((p) => [p.name, p.value]));
    const declared = outputFields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? '',
      value: got.get(f.name),
      given: got.has(f.name),
    }));
    const named = new Set(outputFields.map((f) => f.name));
    const extra = [...got]
      .filter(([k]) => !named.has(k))
      .map(([name, value]) => ({ name, type: '', description: '', value, given: true }));
    return [...declared, ...extra];
  });

  /** A workflow that returned something other than an object — a string, a list. Drawn whole. */
  const scalarOutput = $derived(
    io?.output !== undefined && (typeof io.output !== 'object' || Array.isArray(io.output))
      ? JSON.stringify(io.output)
      : ''
  );

  /** When the run started, and how long it has been going. Both from whichever read answered. */
  const startedAt = $derived(detail?.startedAt ?? current?.startedAt ?? 0);
  const closedAt = $derived(detail?.closedAt ?? current?.closedAt ?? 0);
  const startedText = $derived(startedAtText(startedAt));
  /** Seconds since the run's first event — what an in-flight step is drawn against. */
  const elapsed = $derived(startedAt ? ((closedAt || nowMs) - startedAt) / 1000 : 0);
  /**
   * The server's reading across BOTH dimensions — execution and materialization (ADR 0017).
   *
   * It is what stops the poll, so it is a `$derived` of its own: an effect keyed on this re-runs
   * when the ANSWER changes rather than every time `detail` is replaced.
   */
  const settled = $derived(detail?.settled === true);
  /** Nothing has closed it. Absent detail is not "finished" — it is "not known yet". */
  const live = $derived(detail ? !detail.settled : false);

  /**
   * WHERE "query these rows" GOES — the Datasets workbench, with this run's query already written.
   *
   * The address carries the dataset and the run and a flag; `runScopedSql` composes the SQL from
   * exactly those on arrival, so the link is short, shareable, and the only spelling of the query.
   * An `<a href>` rather than a button: it is a navigation, so it should middle-click, and the
   * status bar should say where it goes before it is clicked.
   */
  const queryHref = $derived(
    shownDataset && openRun
      ? formatAddress({
          view: 'datasets',
          dataset: {
            name: shownDataset.name,
            ...(shownDataset.kind === 'output' || shownDataset.kind === 'standalone'
              ? { kind: shownDataset.kind }
              : {}),
            run: openRun,
            query: true,
          },
        })
      : ''
  );
  /** Shown beside the button, so what the link will ask is legible before following it. */
  const queryPreview = $derived(
    shownDataset && openRun ? runScopedSql(shownDataset.name, openRun).replace(/\n/g, ' ') : ''
  );

  /**
   * What the Dataset handle says before it is opened.
   *
   * `0` AND "NOT READ YET" MUST NOT LOOK THE SAME. The preview is a lake query and can take
   * seconds; printing `0` while it is in flight says this run wrote nothing, which is the exact
   * lie every other region on this page is written to avoid. Measured live: the handle read
   * `Dataset 0` over a Dataset that had 10 rows.
   */
  /**
   * DECLARED HERE BECAUSE `rowCount` READS THEM, and Svelte 5 runes are block-scoped bindings like
   * any other `const`. These three sat 46 lines BELOW their first reader, which typechecks as
   * "block-scoped variable used before its declaration" — four errors that `pnpm test` cannot see
   * because it is a different gate. It survived at runtime only because a `$derived` body is lazy
   * and every declaration in this block runs before anything reads one; a reorder, or a reader that
   * runs during initialisation, turns it into a ReferenceError on the counter this page exists for.
   * Caught by root-fe on review, not by me on either suite.
   */
  let liveRows = $state<RowTailState>(ROW_TAIL_START);
  /** Records the store has taken for this Run so far — the in-flight truth. */
  const liveRowCount = $derived(liveRows.snapshot?.rows ?? null);
  /** The last few records, when the tail carried a window (slice 05). */
  const liveWindow = $derived(rowTailWindow(liveRows));

  /**
   * WHILE IT RUNS, THE TAIL; ONCE IT IS DONE, THE LAKE.
   *
   * The old spelling was `preview ? preview.rows.length : datasetsLoading ? '…' : '0'`, which is
   * the lake and only the lake — so this counter read `0` for the entire productive part of every
   * Run and then jumped to its final value in one step.
   */
  const rowCount = $derived<string>(
    !settled && liveRowCount !== null
      ? String(liveRowCount)
      : preview
        ? String(preview.rows.length)
        : datasetsLoading
          ? '…'
          : '0'
  );

  /**
   * ROWS AS THEY LAND, NOT ROWS AFTER THE COMMIT.
   *
   * `preview` is the LAKE's answer, and the lake only has rows after `publishBatch` — which is one
   * commit at the END of a Run. MEASURED on canary-1790684761: the sweep pushed 40 records between
   * 12:27:04 and 12:27:46 and `publishBatch` ran at 12:27:46, so every one of those forty appeared
   * in the same instant, 104 seconds into a 110-second run. That is not a rendering artefact and no
   * amount of re-reading the lake fixes it: for the whole sweep there is genuinely nothing there.
   *
   * The rows DO exist while the sweep runs — as claim-checked unit objects in the store, which is
   * what `/api/datasets/rows/stream` counts and samples. That endpoint has existed and nothing on
   * this page subscribed to it, so the surface built to show a dataset filling up was reading the
   * one source that cannot show it filling up.
   *
   * BOTH ARE KEPT, because they answer different questions. The tail says "this many records have
   * been produced so far, here are the last few"; the lake says "this is what was committed, typed
   * and queryable". A Run in flight wants the first; a finished Run wants the second.
   */

  /**
   * Follow the row tail while the Run is open and still going.
   *
   * STOPS AT `settled`, deliberately. The tail counts objects in the store; once the batch is
   * published the LAKE is the authority and the two would disagree at the margin — a Run showing a
   * live count beside a committed one is the page arguing with itself. The endpoint caps
   * concurrent streams per client and per run, so dropping the subscription the moment it stops
   * being the better answer is also the polite thing to do with a bounded resource.
   */
  $effect(() => {
    const id = openRun;
    if (id === null || settled) return;
    liveRows = ROW_TAIL_START;
    return followRows(id, (st) => { liveRows = st; });
  });

  /**
   * HOW MANY OF THE LAST RECORDS TO DRAW. Ten, because that is what a reader watching a sweep asked
   * for — enough to see a pattern, few enough to read at a glance while it moves.
   *
   * The SERVER caps the window at `ROW_TAIL_WINDOW` (50) and, more to the point, at 16 KB — so a
   * deep selection on wide rows yields fewer rows than asked and `clipped` says so. This control
   * chooses how many of what arrived to render; it cannot make the stream send more than it budgets.
   */
  /**
   * The tail scrolls and sticks to the newest end, the way a `tail -f` pane does.
   *
   * STICKING IS CONDITIONAL, and that is the whole behaviour: a reader who has scrolled up is
   * reading something, and yanking them back on the next frame makes a growing tail unreadable. So
   * the box follows only while it is already at the bottom.
   */
  let tailBox = $state<HTMLDivElement | null>(null);
  let stick = $state(true);

  function onTailScroll(e: Event): void {
    const el = e.currentTarget as HTMLDivElement;
    // A few pixels of slack: "at the bottom" has to survive sub-pixel layout and a scrollbar.
    stick = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  $effect(() => {
    const n = liveTable.rows.length; // tracked: re-run when the tail grows
    const el = tailBox;
    if (el && stick && n > 0) el.scrollTop = el.scrollHeight;
  });

  /**
   * The window as a TABLE — the union of every key across the drawn rows, in first-seen order.
   *
   * UNION AND NOT `Object.keys(rows[0])`, because a record that gained a field mid-sweep would
   * otherwise have it silently dropped for the whole window, which is the wrong half of "show me
   * what is landing". First-seen order rather than sorted, so the shape the actor emits is the
   * shape the reader sees.
   */
  const liveTable = $derived.by(() => {
    /*
     * ONE LEVEL OF UNWRAPPING, AND IT IS NOT COSMETIC.
     *
     * A window entry is one OBJECT IN THE STORE, and a pushed record is stored as a JSON list
     * holding it — so the wire carries `[[{…}], [{…}]]`, not `[{…}, {…}]`. Rendering that
     * un-flattened is what produced a column-less table of raw JSON: every entry is an Array, so
     * `Object.keys` finds no fields and the whole record collapses into one cell.
     *
     * The counts agree with the flattening rather than fighting it — `rows` counts objects and each
     * object here holds one record, so flattening keeps "6 rows" and six table rows the same claim.
     * A blob that ever holds several records still renders correctly; it just contributes several.
     */
    // EVERY ROW THE CLIENT HAS ACCUMULATED, oldest-first. The reducer keeps the tail across polls
    // and caps it at ROW_TAIL_KEEP; slicing a window off it here is what made a growing Dataset
    // render as the same few rows while its count climbed past them.
    const rows = (liveWindow?.rows ?? []).flatMap((e) => (Array.isArray(e) ? e : [e]));
    const all = rows;
    const cols: string[] = [];
    for (const r of rows) {
      if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
        for (const k of Object.keys(r as Record<string, unknown>)) {
          if (!cols.includes(k)) cols.push(k);
        }
      }
    }
    return {
      rows,
      cols,
      clipped: liveWindow?.clipped ?? false,
      total: all.length,
      trimmed: rowTailTrimmed(liveRows),
    };
  });

  /** Something arrived in a feed that nobody has opened since. */
  const unreadLogs = $derived(drawer !== 'logs' && logs.length > seenLogs);
  const unreadRows = $derived(
    drawer !== 'dataset' && Math.max(preview?.rows.length ?? 0, liveRowCount ?? 0) > seenRows
  );

  function openDrawer(which: 'logs' | 'dataset'): void {
    drawer = drawer === which ? null : which;
    if (drawer === 'logs') seenLogs = logs.length;
    if (drawer === 'dataset') seenRows = Math.max(preview?.rows.length ?? 0, liveRowCount ?? 0);
  }

  function ago(ms: number): string {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function tone(label: string): 'ok' | 'accent' | 'bad' | 'dim' {
    if (/complete|success/i.test(label)) return 'ok';
    if (/fail|cancel|error/i.test(label)) return 'bad';
    if (/run/i.test(label)) return 'accent';
    return 'dim';
  }

  // A dataset cell that carries error text (error / void_reason non-empty) is the DATASET-error's
  // full message; the rest of the row is which record. `colIndex` finds those columns by name.
  const errorCols = $derived(
    (preview?.columns ?? [])
      .map((c, i) => ({ name: c.name, i }))
      .filter((c) => /^(error|void_reason)$/i.test(c.name))
      .map((c) => c.i)
  );
  function cell(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  function rowHasError(r: unknown[]): boolean {
    return errorCols.some((i) => cell(r[i]).trim() !== '');
  }
</script>

{#if openRun !== null && openTab === 'report'}
  <!-- WHAT THE RUN FOUND, which is a different question from what it DID. The record below answers the
       second; this answers the first (ADR 0055). -->
  <Report runId={openRun} />
{:else if openRun === null}
  <section class="list" data-testid="runs-list">
    <h1>Runs</h1>
    {#if loading}
      <p class="muted">loading…</p>
    {:else if error}
      <p class="err" role="alert">{error}</p>
    {:else if rows.length === 0}
      <p class="muted">No runs yet.</p>
    {:else}
      <ul class="runs">
        {#each rows as r (r.runId)}
          {@const ex = executionOf(r)}
          {@const mat = materializationOf(r)}
          <li>
            <button class="row" data-testid="run-row-{r.runId}" onclick={() => open(r.runId)}>
              <span class="rid mono">{r.runId}</span>
              <span class="type">{r.type}</span>
              <span class="word {tone(ex.label)}" title={ex.title}>{ex.label}</span>
              <span class="word {tone(mat.label)}" title={mat.title}>{mat.label}</span>
              <span class="when">{ago(r.startedAt)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else}
  <section class="detail" data-testid="run-detail">
    <div class="detailnav">
      <button class="back" onclick={() => open(null)}>‹ Runs</button>
      <!-- THE WAY TO WHAT THE RUN FOUND (ADR 0055). An ordinary link and not a button: the report is an
           address somebody pastes, so middle-click and copy-link have to work. -->
      <a class="toreport" href={formatAddress({ view: 'runs', run: openRun, tab: 'report' })} data-testid="run-to-report">
        Report ›
      </a>
    </div>
    <header class="head">
      <div class="idcol">
        <span class="rid mono" data-testid="run-detail-id">{openRun}</span>
        <!-- WHAT IT IS AND WHEN IT STARTED. A run id carries an epoch (`canary-1790191378`) and
             nobody reads one at a glance, so the date is printed rather than left to be decoded. -->
        <div class="sub">
          {#if detail?.type || current?.type}<span>{detail?.type || current?.type}</span>{/if}
          {#if startedText}
            <span class="dot">·</span>
            <span>started <span class="when mono" data-testid="run-started">{startedText}</span></span>
          {/if}
          {#if elapsed > 0}
            <span class="dot">·</span>
            <span class="when mono">{shortSeconds(elapsed)}{live ? ' and counting' : ''}</span>
          {/if}
          <!-- A LIVE PAGE THAT STOPPED BEING LIVE HAS TO SAY SO, which is the whole lesson of the
               bug this page was rewritten for: a run showing "bringing up the fleet" sixteen
               minutes after it finished, looking exactly like an answer. The stream can drop or be
               unsupported, and a frozen page is indistinguishable from a run that is thinking — so
               the two states that mean "these numbers have stopped arriving" are printed.
               `connecting` is not one of them: it lasts one round trip and blinking on every open
               would be noise. -->
          {#if live && follow.state === 'reconnecting'}
            <span class="dot">·</span>
            <span class="stale" data-testid="run-stream-stale">reconnecting — these numbers may be behind</span>
          {:else if live && follow.state === 'unsupported'}
            <span class="dot">·</span>
            <span class="stale" data-testid="run-stream-stale">live updates unavailable in this browser — reload to refresh</span>
          {/if}
        </div>
      </div>
      <div class="rightcol">
        {#if current}
          {@const ex = executionOf(current)}
          <!-- THE LAKE WINS ON THIS PAGE, and only on this page. The ledger answers `unrecorded`
               for every v2 Run; the page has already read the lake for the Dataset region, so it
               can say what is actually there instead of repeating a word the list is stuck with. -->
          {@const mat = lakeMaterialization(datasets) ?? materializationOf(current)}
          <div class="dims">
            <span class="chip {tone(ex.label)}" title={ex.title} data-testid="run-execution">{ex.label}</span>
            <span class="chip {tone(mat.label)}" title={mat.title} data-testid="run-materialization">{mat.label}</span>
          </div>
        {/if}
        <!-- THE TWO FEEDS THAT GROW, behind handles. The counts keep climbing while the drawer is
             shut, and a handle marks itself when something landed nobody has looked at — which is
             the one thing hiding a live feed has to get right. -->
        <div class="handles">
          <button class="handle" class:hot={unreadLogs} data-testid="open-logs" onclick={() => openDrawer('logs')}>
            {#if unreadLogs && live}<span class="blip"></span>{/if}
            <span>Logs</span><span class="n mono">{logs.length}</span><span class="arrow">▸</span>
          </button>
          <button class="handle" class:hot={unreadRows} data-testid="open-dataset" onclick={() => openDrawer('dataset')}>
            {#if unreadRows && live}<span class="blip"></span>{/if}
            <span>Dataset</span><span class="n mono">{rowCount}</span><span class="arrow">▸</span>
          </button>
        </div>
      </div>
    </header>

    {#if detailErr}<p class="err" role="alert">{detailErr}</p>{/if}

    <!-- INPUT (top) — WHAT THIS RUN WAS STARTED WITH, decoded from the `WorkflowExecutionStarted`
         payload, laid out in the order the workflow declares its fields and annotated with the
         author's own sentence per field.

         IT USED TO SHOW THE DECLARED DEFAULTS, footnoted "the run's recorded values land with the
         snapshot store" — so two runs of one workflow started with different arguments rendered
         identically, and the region was a copy of the launch form rather than a record. -->
    <div class="region input" data-testid="run-input">
      <h2>Input {#if io?.input !== undefined}<span class="dim src">as started</span>{/if}</h2>
      {#if ioErr}
        <p class="err" role="alert">{ioErr}</p>
      {:else if ioGone}
        <!-- RETENTION, NOT A FAULT. Temporal drops an execution long before the Dataset it wrote
             expires, so this says which fact it is rather than drawing an empty form. -->
        <p class="muted">
          Temporal has dropped this execution, so the argument it was started with is gone. The
          Dataset and the log below outlive it.
        </p>
      {:else if inputRows.length === 0}
        <p class="muted">
          {#if io}Started with no arguments.{:else}reading…{/if}
        </p>
      {:else}
        <div class="form">
          {#each inputRows as f (f.name)}
            <div class="fcard" data-testid="input-field-{f.name}">
              <div class="flab">
                <span class="fname">{f.name}</span>
                {#if f.type}<span class="ftype">{f.type}</span>{/if}
              </div>
              {#if f.given}
                <span class="fval mono">{f.value}</span>
              {:else}
                <!-- NOT SENT. The workflow read its own default for this one, and saying so is a
                     different fact from showing the default as though it had been typed. -->
                <span class="fval mono unset" title="not sent — the workflow used its own default">
                  {f.fallback ? `default ${f.fallback}` : 'not sent'}
                </span>
              {/if}
              {#if f.description}<span class="fdesc">{plainText(f.description)}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- WHAT THIS RUN NEEDS FROM A PERSON, above everything that merely describes it.

         IT LIVED ON THE WORKFLOWS PAGE AND CAME HERE WITH THE RUN VIEW. That page's own comment is
         the reason it could not simply be deleted with the rest: "a run parked on an `ask` looks
         exactly like a run that is working, and the only difference visible anywhere is this". A
         parked run is the one state a person has to ACT on, so it goes above Progress — which will
         truthfully show a run doing nothing, without being able to say that nothing is what it is
         waiting for. -->
    <Asks runId={openRun} {revision} />

    <!-- THE INFRASTRUCTURE, ABOVE PROGRESS AND FOR THE SAME REASON PROGRESS IS ABOVE THE DATASET.

         Progress exists because "for the first half-minute it is the only region with anything in
         it". On a run that provisions, that half-minute IS the Fleet: Progress can say `Bring the
         Fleet up · 34s so far` and nothing more, because a step is one row in a reduction of the
         event log and a converge emits one child-workflow event and then goes quiet for minutes.
         The facts underneath it — four Droplets in two regions, two of them made, one being made,
         a Worker installing on the third — are in Pulumi's checkpoint the whole time and reached no
         surface in this console.

         It renders NOTHING for a run with no Fleet children, which is most of them. -->
    <Rack {rack} missing={rackMissing} now={elapsed} loading={rackLoading} />

    <!-- PROGRESS — WHAT THE RUN IS DOING, and the region the page leads with after Input.

         It sits here because for the first 34 seconds of a canary it is the only region with
         anything in it: nothing reaches the log rail and no row reaches the lake until a Session
         opens. A page whose first live region is empty reads as a hang. -->
    <Progress
      {events}
      now={elapsed}
      {live}
      error={historyErr}
      loading={historyLoading}
    />

    <!-- OUTPUT (bottom) — WHAT THIS RUN RETURNED, decoded from `WorkflowExecutionCompleted`,
         against the declared output schema for the order and the author's sentence per field.

         IT USED TO SHOW THE SHAPE AND NO VALUES AT ALL, footnoted "values land with the run-result
         fetch". This is that fetch. -->
    <div class="region output" data-testid="run-output">
      <h2>Output {#if io?.output !== undefined}<span class="dim src">as returned</span>{/if}</h2>
      {#if io?.closedAs}
        <!-- A RUN THAT DID NOT COMPLETE HAS NO RESULT, and the word for why is the answer. An
             empty Output over a failed run reads as "it returned nothing", which is wrong. -->
        <p class="muted">
          This run <b class="bad">{io.closedAs}</b>, so it returned nothing. The log below is where
          the reason is.
        </p>
      {:else if ioGone}
        <p class="muted">Temporal has dropped this execution, so its result is gone.</p>
      {:else if scalarOutput}
        <span class="fval mono">{scalarOutput}</span>
      {:else if outputRows.length > 0}
        <div class="cards">
          {#each outputRows as f (f.name)}
            <div class="ocard" data-testid="output-field-{f.name}">
              <span class="k"><span class="oname">{f.name}</span>{#if f.type}<span class="ftype">{f.type}</span>{/if}</span>
              {#if f.given}
                <span class="oval mono">{f.value}</span>
              {:else}
                <span class="oval mono unset">not returned</span>
              {/if}
              {#if f.description}<span class="odesc">{plainText(f.description)}</span>{/if}
            </div>
          {/each}
        </div>
      {:else if !io}
        <p class="muted">reading…</p>
      {:else if detail && !detail.closedAt}
        <p class="muted">Still running — there is no result yet.</p>
      {:else}
        <p class="muted">This workflow returned no value.</p>
      {/if}
    </div>
    <!-- THE TWO FEEDS, OUT OF THE FLOW. They are the only regions that grow while a run is going;
         in the column they pushed Input, Output and each other down for the whole run. Nothing
         here can move anything on the page behind it. -->
    <Drawer
      open={drawer !== null}
      label={drawer === 'dataset' ? 'Dataset rows' : 'Run logs'}
      onclose={() => (drawer = null)}
    >
      {#snippet head()}
        <div class="dtabs" role="tablist">
          <button role="tab" aria-selected={drawer === 'logs'} data-testid="drawer-tab-logs" onclick={() => openDrawer('logs')}>
            Logs<span class="n mono">{logs.length}</span>
          </button>
          <button role="tab" aria-selected={drawer === 'dataset'} data-testid="drawer-tab-dataset" onclick={() => openDrawer('dataset')}>
            Dataset<span class="n mono">{rowCount}</span>
          </button>
        </div>
        <span class="spacer"></span>
        <!-- QUERY THESE ROWS — the whole point of showing them here rather than only listing them.
             Seeing that a run produced rows is half the job; the next thing anybody does is query
             them, and making them re-find the dataset by name and re-type a SELECT is the gap this
             closes. An anchor, not a button: it is a navigation and should middle-click. -->
        {#if drawer === 'dataset' && queryHref}
          <a class="toquery" href={queryHref} data-testid="query-dataset" title={queryPreview}>
            query these rows ↗
          </a>
        {/if}
        <button class="dclose" onclick={() => (drawer = null)} aria-label="Close">✕ esc</button>
      {/snippet}

      {#snippet children()}
        {#if drawer === 'dataset'}
        <!-- DATASET (left) — the last rows of the run's output, with error/void_reason shown IN FULL
             and the record (host/endpoint/point/node…) alongside. This is the DATASET-error's home. -->
        <!-- `fills` ONLY WHEN THERE IS A TABLE IN IT. The region stretches to the panel so the rows
             get the height, but "This run wrote no rows to the lake." in a bordered box stretched
             to 700px is a region that looks broken rather than empty. -->
        <div
          class="region dataset"
          class:fills={(preview?.rows.length ?? 0) > 0}
          data-testid="run-dataset"
        >
          <h2>
            Dataset
            {#if shownDataset}<span class="dim mono">{datasetLabel(shownDataset)}</span>{/if}
            {#if datasets.length > 1}
              <!-- A RUN CAN WRITE SEVERAL. The first is shown; the count says the others exist
                   rather than letting the page read as though there were only one. -->
              <span class="dim">and {datasets.length - 1} more</span>
            {/if}
          </h2>
          {#if datasetsErr}
            <p class="err" role="alert">{datasetsErr}</p>
          {:else if previewErr}
            <p class="err">{previewErr}</p>
          {:else if !settled && liveRowCount !== null}
            <!-- THE RUN IS STILL GOING, SO THE LAKE IS THE WRONG AUTHORITY TO ASK.
                 `publishBatch` is one commit at the end; until it runs, the records exist as
                 claim-checked objects in the store and `/api/datasets/rows/stream` is what can see
                 them. Showing "This run wrote no rows to the lake" here is technically true and
                 reads as a failure, for the entire productive part of the Run. -->
            <p class="live-rows mono" data-testid="live-row-count">
              {rowTailLabel(liveRows, Date.now())}
            </p>
            {#if liveTable.rows.length > 0}
              <div class="tailbar">
                <span class="muted small" data-testid="live-tail-count">
                  {liveTable.rows.length.toLocaleString()} row{liveTable.rows.length === 1 ? '' : 's'}
                  {#if liveTable.trimmed}· oldest dropped{/if}
                  {#if !stick}· scrolled up{/if}
                </span>
                {#if !stick}
                  <button
                    class="small"
                    data-testid="live-tail-follow"
                    onclick={() => {
                      stick = true;
                      if (tailBox) tailBox.scrollTop = tailBox.scrollHeight;
                    }}>follow</button
                  >
                {/if}
              </div>
              <div
                class="tbl-wrap tail-scroll"
                bind:this={tailBox}
                onscroll={onTailScroll}
                data-testid="live-tail-scroll"
              >
                <table data-testid="live-row-tail">
                  {#if liveTable.cols.length > 0}
                    <thead>
                      <tr>{#each liveTable.cols as c (c)}<th>{c}</th>{/each}</tr>
                    </thead>
                    <tbody>
                      {#each liveTable.rows as r, ri (ri)}
                        <tr data-testid="live-row">
                          {#each liveTable.cols as c (c)}
                            <td>{cell((r as Record<string, unknown>)?.[c])}</td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  {:else}
                    <!-- Records that are not objects (a bare scalar push) still deserve to be seen. -->
                    <tbody>
                      {#each liveTable.rows as r, ri (ri)}
                        <tr data-testid="live-row"><td>{cell(r)}</td></tr>
                      {/each}
                    </tbody>
                  {/if}
                </table>
              </div>
              {#if liveTable.clipped}
                <p class="muted small">
                  the window is byte-bounded at 16 KB — wider records mean fewer of them, and the
                  ones over budget are skipped rather than shown half-written
                </p>
              {/if}
            {:else}
              <p class="muted">
                records are landing in the store; the typed rows appear here when the batch commits
              </p>
            {/if}
          {:else if !shownDataset}
            <p class="muted">This run wrote no rows to the lake.</p>
          {:else if !preview}
            <p class="muted">reading…</p>
          {:else if preview.rows.length === 0}
            <p class="muted">The Dataset is empty — a successful empty result.</p>
          {:else}
            <div class="tbl-wrap" data-testid="dataset-scroller">
              <table>
                <thead>
                  <tr>{#each preview.columns as c}<th title={c.type}>{c.name}</th>{/each}</tr>
                </thead>
                <tbody>
                  {#each preview.rows as r, ri (ri)}
                    <tr class:err-row={rowHasError(r)} data-testid={rowHasError(r) ? 'dataset-error-row' : 'dataset-row'}>
                      {#each preview.columns as _c, ci}
                        <td class:err-cell={errorCols.includes(ci) && cell(r[ci]).trim() !== ''}
                            data-testid={errorCols.includes(ci) ? 'dataset-error-cell' : undefined}>{cell(r[ci])}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="foot mono">
              {preview.rows.length} of {shownDataset.rows} row{shownDataset.rows === 1 ? '' : 's'}{preview.truncated ? ' · truncated' : ''}
              {#if (shownDataset.contributingRuns ?? []).length > 1}
                · shared with {(shownDataset.contributingRuns ?? []).length - 1} other run(s)
              {/if}
              · the error / void_reason column carries the full message; the rest of the row is which record
            </p>
          {/if}
        </div>
        {:else}
          <div class="region log" data-testid="run-log">
            <LogsRail records={logs} loading={logsLoading} error={logsErr} />
          </div>
        {/if}
      {/snippet}
    </Drawer>
  </section>
{/if}

<style>
  section {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  h1 {
    font-size: var(--t-head);
    font-weight: 600;
    margin: 0;
  }
  h2 {
    font-size: var(--t-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
    margin: 0 0 var(--s-2);
    font-weight: 500;
    display: flex;
    gap: var(--s-2);
    align-items: baseline;
  }
  h2 .dim {
    text-transform: none;
    letter-spacing: 0;
  }
  .muted {
    color: var(--dim);
    font-size: var(--t-small);
    margin: 0;
    line-height: var(--lh-body);
  }
  .err {
    color: var(--bad);
    font-size: var(--t-small);
    margin: 0;
  }

  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto auto auto auto;
    gap: var(--s-3);
    align-items: baseline;
    text-align: left;
    cursor: pointer;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
    color: var(--fg);
    font-size: var(--t-small);
  }
  .row:hover {
    border-color: var(--accent);
  }
  .rid {
    font-size: var(--t-body);
  }
  .type,
  .when {
    color: var(--dim);
    white-space: nowrap;
  }

  /* The stream is not delivering. Warning-toned rather than error-toned: the run is probably fine
     and the PAGE is the thing that is behind, which is a different sentence. */
  .stale {
    color: var(--warn, var(--dim));
    white-space: nowrap;
  }

  .word {
    white-space: nowrap;
  }
  .word.ok,
  .chip.ok {
    color: var(--ok);
  }
  .word.accent,
  .chip.accent {
    color: var(--accent);
  }
  .word.bad,
  .chip.bad {
    color: var(--bad);
  }
  .word.dim,
  .chip.dim {
    color: var(--dim);
  }

  .back {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--t-small);
    padding: 0;
  }

  .detailnav {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }

  .toreport {
    font-size: var(--t-small);
    color: var(--accent);
    text-decoration: none;
  }

  .toreport:hover {
    text-decoration: underline;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .idcol {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .idcol .rid {
    font-size: var(--t-lead);
    overflow-wrap: anywhere;
  }
  /* WHAT IT IS, WHEN IT STARTED, HOW LONG IT HAS BEEN — one line under the id. */
  .idcol .sub {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: baseline;
    font-size: var(--t-small);
    color: var(--dim);
  }
  .idcol .sub .when {
    color: var(--dim);
  }
  .idcol .sub .dot {
    color: var(--line);
  }
  .rightcol {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: flex-end;
  }
  .dims {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }

  /* ── the two feeds, behind handles ──────────────────────────────────────────────────────────── */
  .handles {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .handle {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-3);
    cursor: pointer;
    font-size: var(--t-small);
    color: var(--dim);
  }
  .handle:hover {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--fg) 25%, var(--line));
  }
  .handle .n {
    font-size: var(--t-micro);
    color: var(--dim);
  }
  .handle .arrow {
    font-size: var(--t-micro);
    color: var(--dim);
  }
  /* SOMETHING LANDED WHILE THE DRAWER WAS SHUT. The one thing hiding a live feed has to get right. */
  .handle.hot {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .handle.hot .n {
    color: var(--accent);
  }
  .blip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: blip 1.6s ease-in-out infinite;
  }
  @keyframes blip {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  /* ── drawer chrome ──────────────────────────────────────────────────────────────────────────── */
  .dtabs {
    display: flex;
    gap: var(--s-1);
  }
  .dtabs button {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--dim);
    padding: var(--s-1) var(--s-3);
    cursor: pointer;
    font-size: var(--t-small);
  }
  .dtabs button[aria-selected='true'] {
    color: var(--fg);
    background: var(--track);
    border-color: var(--line);
  }
  .dtabs .n {
    font-size: var(--t-micro);
    color: var(--dim);
    margin-left: var(--s-1);
  }
  .spacer {
    flex: 1;
  }
  .toquery {
    font-size: var(--t-small);
    color: var(--accent);
    text-decoration: none;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-2);
    white-space: nowrap;
  }
  .toquery:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .dclose {
    background: none;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--dim);
    cursor: pointer;
    padding: 2px var(--s-2);
    font-size: var(--t-small);
  }
  .dclose:hover {
    color: var(--fg);
  }
  .chip {
    font-size: var(--t-small);
    font-family: var(--mono);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px var(--s-2);
  }

  .region {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-3);
    min-width: 0;
  }
  .region.log {
    background: none;
    border: none;
    padding: 0;
  }
  /*
   * ── THE CHAIN OF DEFINITE HEIGHTS, WITHOUT WHICH NEITHER FEED SCROLLS ──────────────────────────
   *
   * `overflow-y: auto` on a box only produces a scrollbar when the box has a height its content can
   * exceed, and the height `.scroller` had was the WRONG ONE rather than no height at all.
   * `LogsRail.svelte:159` sets `height: calc(100vh - 220px)` — the window's height, minus the
   * full-page chrome it was written under. Inside this drawer that is a number about the viewport
   * pinned onto a box whose container is a `position: fixed` panel, so the rail was sized by
   * something that is not its parent and overflowed whenever the two disagreed. The `flex: 1` below
   * is what replaces that `calc` with a share of the PANEL; it is part of the fix, not the bug.
   * Every link below is one hop of the height travelling down from the panel.
   *
   * THE PRE-FIX SPILL MEASUREMENTS THAT USED TO BE QUOTED HERE ARE GONE, deliberately. They were
   * taken against an uncommitted intermediate state of this file that no longer exists and was never
   * stashed, so nobody — including whoever wrote them — can reproduce them. A number that cannot be
   * re-measured is a claim, not evidence. What IS checkable is the `calc(100vh - 220px)` above, in
   * git, today.
   *
   * `min-height: 0` ON EVERY HOP, AND AN EXPLICIT FLOOR ONLY ON THE FEED. In the block axis a box's
   * min-content height IS its content height — there is no shrink-to-fit for heights — so a flex
   * item's default `min-height: auto` means "never smaller than everything inside me", and one link
   * in the chain keeping that default pins the whole chain open. Measured with `flex: 1 1 auto` and
   * no `min-height` on these: the table rendered at its full 1684px inside a 646px body, exactly as
   * before the fix. So every intermediate box says `min-height: 0` and only the scrolling feed
   * carries a real floor (`9rem`, below). A panel too short to honour that floor overflows the feed
   * out of these `overflow: visible` boxes and into `.dbody`, which is the scroll container of last
   * resort and the reason the floor is safe to set at all.
   */
  .live-rows { margin: 0 0 .5rem; opacity: .9; }
  .tailbar {
    display: flex;
    align-items: center;
    gap: .75rem;
    flex-wrap: wrap;
    margin: 0 0 .5rem;
  }
  .tailbar button { font: inherit; padding: .1rem .5rem; cursor: pointer; }
  .small { font-size: .85em; }

  /* The tail scrolls on its own rather than growing the page: a Run that emits for an hour would
     otherwise push every panel below it off the screen. `overflow-anchor: none` stops the browser's
     own scroll anchoring fighting the stick-to-bottom effect. */
  .tail-scroll {
    max-height: min(26rem, 50vh);
    overflow-y: auto;
    overflow-anchor: none;
  }

  .region.dataset.fills,
  .region.log {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  /* In the Runs page the log is a COLUMN, not a full-height sticky rail — `position: static` so it
     does not stick, and `flex: 1` because the rail's own default is `0 1 auto`: it would not GROW,
     which is the hop where the panel's height was being dropped on the floor. */
  .region.log :global(.rail) {
    position: static;
    flex: 1;
    min-height: 0;
  }
  .region.log :global(.scroller) {
    height: auto;
    /* IN A DRAWER THE RAIL FILLS ITS SHEET. The 26rem cap was for the old column, where an
       unbounded rail made the page taller every time a line arrived; here the drawer is already
       viewport-height and capping it would leave dead space under the last line. */
    max-height: none;
    flex: 1;
    /* THE FLOOR, which is what gives `.dbody`'s overflow something to be. 9rem is 126px at this
       console's 14px root and a log row measures 19px (12px over `--lh-tight`, plus 2px of padding
       each side), so it is six and a half lines — below that a log pane is not worth the filter bar
       above it. A panel too short for it hands the remainder up to `.dbody`; measured at 1280x180,
       the scroller holds its 126px and `.dbody` takes 71px of scroll rather than squeezing it. */
    min-height: 9rem;
  }
  .tbl-wrap {
    overflow: auto;
    /* IT FILLS THE PANEL NOW, WHERE IT USED TO BE CAPPED AT `26rem`. This console's root is 14px
       (`html { font: 400 var(--t-body)… }`), so that cap was 364px, and 364px is wrong in both
       directions: at 1280x900 it left 482px of the drawer empty while 1682px of rows went past a
       364px letterbox, and at 1280x420 the heading, the cap and the footnote came to 107px more
       than the panel — which, with no `overflow` anywhere above, was 107px nobody could reach. */
    flex: 1;
    /* The same floor as the rail's, for the same reason — 126px is the header row and three and a
       half rows at 27px each, and a panel too short for that scrolls in `.dbody` instead. */
    min-height: 9rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--mono);
    font-size: var(--t-small);
  }
  thead th {
    text-align: left;
    padding: var(--s-1) var(--s-2);
    color: var(--dim);
    font-weight: 500;
    background: var(--track);
    position: sticky;
    top: 0;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  tbody td {
    padding: var(--s-1) var(--s-2);
    border-bottom: 1px solid var(--line);
    color: var(--fg);
    vertical-align: top;
    white-space: nowrap;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .err-row td:first-child {
    box-shadow: inset 2px 0 0 var(--bad);
  }
  /* The full error text, shown — never truncated. Only THIS cell wraps; the identifier columns
     (host, endpoint) stay on one line and the table scrolls sideways if it must. */
  .err-cell {
    color: var(--bad);
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: 34rem;
  }
  .foot {
    font-size: var(--t-small);
    color: var(--dim);
    margin: var(--s-2) 0 0;
  }
  /* typed input form — one control per declared type */
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--s-2) var(--s-3);
  }
  .fcard {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .flab {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  /* NO DOTTED UNDERLINE AND NO `cursor: help`. It promised a tooltip carrying the field's meaning,
     which is now printed under the value where it can be read without hovering — and a hover
     affordance is not reachable from a touch screen or a keyboard anyway. */
  .fname {
    font-size: var(--t-small);
    color: var(--fg);
    font-family: var(--mono);
  }
  .fdesc,
  .odesc {
    font-size: var(--t-micro);
    color: var(--dim);
    line-height: var(--lh-body);
    max-width: 48ch;
  }
  /* A VALUE THAT WAS NOT SENT IS DRAWN AS ABSENCE, never as an empty box. `fail_on: str = ""`
     rendered as a bordered rectangle with nothing in it — indistinguishable from a field the page
     had failed to fill in. */
  .unset {
    color: var(--dim);
    font-style: italic;
    background: none;
    border-style: dashed;
  }
  .src {
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--mono);
  }
  .bad {
    color: var(--bad);
    font-weight: 500;
  }
  .ftype {
    font-size: var(--t-small);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 var(--s-1);
    font-family: var(--mono);
  }
  .req {
    color: var(--accent);
  }
  .fval {
    font-size: var(--t-small);
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-2);
    overflow-wrap: anywhere;
  }
  /* typed output cards — field, type, and the author's description */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--s-2);
  }
  .ocard {
    background: var(--track);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .ocard .k {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .oname {
    font-family: var(--mono);
    font-size: var(--t-small);
    color: var(--fg);
  }
  .oval {
    font-size: var(--t-small);
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-1) var(--s-2);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--mono);
  }
</style>
