/**
 * The Machine is the subject, and what is serving hangs off it.
 *
 * ── WHY THIS IS A DERIVATION AND NOT A ROUTE ─────────────────────────────────────────────────────
 *
 * Nothing on the control plane answers "which Machines exist and what is polling on each of them".
 * Four sources do, separately (ADR 0052 §6): the Pulumi checkpoint says what EXISTS
 * (`control/orchestrator/src/infra/state.ts` reads it), Temporal says what is SERVING
 * (`pollers.ts:QueueState`, over `GET /api/pollers` and `GET /api/queues/:queue/pollers`), and
 * `roles.ts:queueAssignments` says which queues the control plane's own roles poll. The join across
 * them is arithmetic, so it lives here rather than in a component — CONTEXT.md's "Console core":
 * "a derivation with a test is a fact and a component is a drawing of one".
 *
 * ── THE JOIN IS `identityHost`, AND IT COSTS NO NEW FIELD ────────────────────────────────────────
 *
 * A Worker's Temporal identity is `<pid>@<host>@<queue>` (`@kontra/core/queues:workerIdentity`) and
 * a Machine's hostname IS its name — `dockerFleet` sets `hostname: name`, the cloud program names
 * Machines `kf-<tag>-NN` (`infra/programs/fleet.ts:333`). So a poller attributes to a Machine by
 * string equality on `identityHost(identity) === machine.name`, and there is no field to add to
 * either side and no label to keep in step.
 *
 * ── A ROW IS DERIVED FROM ITS OWN IDENTITY, WHICH IS WHY IT CANNOT SHOW A NEIGHBOUR'S ────────────
 *
 * `QueueState.lastPoll` is the freshest poll ACROSS the queue's identities, and on a Fleet that is
 * twelve Machines' answer rendered under one of them. `pollers.ts` says what that costs in as many
 * words: "a queue with one live worker and one killed three minutes ago reports a fresh `lastPoll`
 * and two identities — and a reader that offers both is offering a dead one."
 *
 * So {@link pollFor} never reads `lastPoll`. It filters `workers` down to the identities whose host
 * IS this Machine and folds only those, the same shape `runs/Runs.svelte:169` uses for its status
 * chips (`rows.find((r) => r.runId === openRun)`): showing a neighbour's verdict is unreachable by
 * construction rather than guarded against.
 *
 * ── FIVE STATES, BECAUSE THE FOURTH IS NOT A WORSE THIRD AND `unknown` IS NOT `none` ─────────────
 *
 * ADR 0052 §6 names four and forbids rounding them off: `serving` (a poll inside `POLL_FRESH_MS`),
 * `stale` (an identity Temporal still lists — it keeps them about five minutes after a Worker stops,
 * so the identity ALONE reports a dead Worker as healthy), `undated` (`lastPoll === 0`, which
 * `pollIsFresh` counts as neither), and `nothing-polling` (no identity at all — the Placement
 * converged and a dispatch to it hangs to `StartToClose`, which reads as a slow Run rather than a
 * broken one).
 *
 * There is a fifth and it is not an embellishment: `unknown` is "we could not ask Temporal".
 * `pollers.ts:1-20` holds that line for its own three states — "`unknown` is never `none`. 'We could
 * not ask Temporal' and 'nothing is polling' are different facts about the world" — and
 * `heartbeat.ts` records what conflating them cost: a monitor showing `0/0` forever while looking
 * like a measurement. Folding a describe error into `nothing-polling` would draw a red Fleet for an
 * unreachable cluster and send an operator to restart Workers that are fine.
 *
 * ── TWO MORE SOURCES, BOTH OPTIONAL, BOTH ABSENT RATHER THAN EMPTY ──────────────────────────────
 *
 * ADR 0052 §6's other two signals hang off the same join and are folded in here: Pulumi's converge
 * records per stack ({@link MachineInput.history} → `infra/history.ts`, one tick per converge) and
 * what each Placement's tag resolves to in the registry now ({@link MachineInput.images} →
 * `infra/drift.ts`). NEITHER HAS A ROUTE TODAY — issue 13 owes the history one and nothing at all
 * serves a registry resolve — so both are optional inputs whose absence produces an ABSENT field
 * rather than an empty one. "Nobody asked" and "we asked and there is nothing" are the same
 * distinction this module already refuses to collapse between `unknown` and `nothing-polling`.
 *
 * ── NOTHING HERE READS A CLOCK, A FILE OR A SOCKET ───────────────────────────────────────────────
 *
 * `now` is an argument, the readings are arguments, and the control project is an argument with a
 * default. The Svelte side fetches (`packages/svelte/src/infra/load.ts`) and draws
 * (`infra/Infra.svelte`); everything with an edge on it is here, with a test beside it.
 */
import { identityHost, pollIsFresh, sharedQueue } from '@kontra/core/queues';

import { driftOf, imageKey, type DriftReading, type ResolvedImage } from './drift';
import { strip, type ConvergeStrip, type ConvergeWire } from './history';

// ── WHAT THE CONSOLE CAN READ ─────────────────────────────────────────────────────────────────────

/**
 * One Machine as the Pulumi checkpoint records it.
 *
 * `name` IS THE HOSTNAME AND THEREFORE THE JOIN KEY — see the header. The rest is
 * `infra/state.ts`'s `SHOWN` list narrowed to what answers "what is this box": everything optional,
 * because a Docker container has no region and a Droplet whose price lookup failed has no price
 * (`programs/fleet.ts:MachineEntry.priceHourly` — "0 means unknown, never free").
 */
export interface MachineReading {
  name: string;
  size?: string;
  region?: string;
  address?: string;
  /**
   * `status` AS PULUMI RECORDED IT AT CONVERGE, and it is deliberately NOT turned into up/down here.
   * The checkpoint is written when a stack converges and never again, so a Machine that died an hour
   * ago still reads `active`. Liveness on this page is the POLL STATE, which is a live read; calling
   * a Machine healthy from a stale field is the green-label-over-lost-work failure of ADR 0017.
   */
  status?: string;
  /** DigitalOcean's list price for the size, in USD per month. Absent when the lookup failed. */
  priceMonthly?: number;
  created?: string;
}

/**
 * One Placement, echoed in the stack outputs (`programs/fleet.ts:placements`).
 *
 * `workers` IS A PREFIX, NOT A SPREAD, and that is a decision with a reason on the server side:
 * "THE FIRST `workers` MACHINES, IN NAME ORDER … Taking a prefix means a scale-up ADDS Workers and
 * never relocates one" (`programs/fleet.ts:131-135`). {@link deriveMachines} sorts by name and
 * slices, so the console draws the Workers the converge actually placed rather than one per Machine.
 */
export interface PlacementReading {
  actor: string;
  version: string;
  /** Absent means every Machine — what every Fleet did before packing existed. */
  workers?: number;
  /** Live Sessions per Worker. Shown because it is the other half of "serving but nothing moves". */
  maxSessions?: number;
  /**
   * The digest-pinned Worker image this Placement converged with — `repo@sha256:<64 hex>`.
   *
   * ALWAYS EXACT WHEN IT IS THERE, which is what makes drift answerable at all: `dockerFleet.ts:126`
   * refuses a placement whose image is "a tag or an unpinned name", so the checkpoint cannot hold a
   * floating reference. ABSENT on a DigitalOcean Fleet, whose Workers run natively off a Bundle
   * (`fleet.ts:65`) — see {@link bundleSha}. See `infra/drift.ts` for what is compared against it.
   */
  workerImage?: string;
  /**
   * The Bundle blob's sha, when the Placement runs one instead of a container.
   *
   * THE OTHER ANSWER TO "WHAT IS THIS WORKER RUNNING", and the only one a cloud Fleet has: the Machine
   * curls `bundleUrl` and checks it with `sha256sum` (`machine.ts`), so the bytes are pinned even
   * though there is no image. Drift is NOT computed from it — re-resolving a Bundle means walking the
   * manifest to its config blob to its layer (`activities/fleet.ts:230-266`), a different read from
   * the one-header answer a container tag gives, and one no route offers.
   */
  bundleSha?: string;
}

/** One stack's checkpoint, narrowed: `GET /api/infra/stacks/:fqn/state` folded by the loader. */
export interface StackReading {
  fqn: string;
  project: string;
  stack: string;
  /** Checkpoint mtime — when this stack was last converged. */
  updated?: string;
  machines: MachineReading[];
  placements: PlacementReading[];
}

/**
 * One row of `roles.ts:queueAssignments(roles)`, over the wire.
 *
 * IT IS THE SINGLE AUTHORITY AND IT IS NOT RESTATED. That function returns exactly
 * `{role, purpose, queue, variable}` and it yields ONE row for the materializer role — the
 * `kontra-materializer` queue and its three activities were removed 2026-09-26 as uncalled, measured
 * at an add rate and a dispatch rate of exactly zero. A queue list written in the console would have
 * drawn a second row for a queue nobody polls, and would have gone on drawing it.
 */
export interface QueueAssignmentReading {
  role: string;
  purpose: string;
  queue: string;
  variable: string;
  /**
   * `KONTRA_DATASET_SLOTS`, on the row that variable belongs to.
   *
   * IT SITS BESIDE THE POLL STATE RATHER THAN IN AN ENV DUMP because it is the other half of the
   * reading this page exists to make: `queues.ts` calls the slot count "load-bearing in a way the
   * name does not suggest" — at one slot a single stuck activity stops publishes, page reads, Lease
   * holds and retention TOGETHER. Measured 2026-09-25: a closed shared DuckDB handle held the only
   * slot and the next run's `publishBatch` sat at `ACTIVITY_TASK_SCHEDULED` against a poller Temporal
   * reported healthy. That is `serving` and nothing moving, and the slot count is what explains it.
   */
  slots?: number;
}

/** One queue's poller report, as `routes/pollers.ts` sends it. `error` set means we could not ask. */
export interface PollerReading {
  queue?: string;
  identities?: string[];
  workers?: Array<{ identity: string; lastPoll: number }>;
  /** The freshest poll ACROSS identities. Never read here — see the header. */
  lastPoll?: number;
  error?: string;
}

/** Everything the page has, keyed the way the endpoints key it. */
export interface MachineInput {
  /** Every stack either state root holds, already read. */
  stacks: readonly StackReading[];
  /** `roles.ts:queueAssignments(roles)`. Empty when the route could not be asked. */
  assignments: readonly QueueAssignmentReading[];
  /** Poller reports by queue — `/api/pollers` merged with the per-queue reads. */
  pollers: Readonly<Record<string, PollerReading | undefined>>;
  now: number;
  /** See {@link CONTROL_PROJECT}. */
  controlProject?: string;
  /**
   * Pulumi's converge records by stack fqn — `infra/history.ts`.
   *
   * OPTIONAL, AND THAT IS HOW "DEGRADES TO ABSENT" IS MADE STRUCTURAL. The route these arrive over is
   * issue 13's and does not exist yet; a stack with no entry here gets no {@link StackRow.converges},
   * and the drawing has no strip to draw rather than an empty one to explain.
   */
  history?: Readonly<Record<string, readonly ConvergeWire[] | undefined>>;
  /**
   * What each Placement's tag resolves to in the registry NOW, keyed by
   * `drift.ts:imageKey(actor, version)`. Absent or empty is `unknown`, never drift.
   */
  images?: Readonly<Record<string, ResolvedImage | undefined>>;
}

// ── READING A CHECKPOINT ──────────────────────────────────────────────────────────────────────────

/** `GET /api/infra/stacks/:fqn/state`, as `infra/state.ts:StackState` sends it. */
export interface StackStateWire {
  fqn?: string;
  project?: string;
  stack?: string;
  updated?: string;
  outputs?: Record<string, unknown>;
  resources?: Array<{
    urn?: string;
    type?: string;
    name?: string;
    synthetic?: boolean;
    created?: string;
    modified?: string;
    detail?: Record<string, unknown>;
  }>;
}

/**
 * WHICH RESOURCES ARE MACHINES, when the program did not publish an inventory.
 *
 * MATCHED ON THE TAIL OF THE TYPE, not the whole token, so `digitalocean:index/droplet:Droplet` and
 * `docker:index/container:Container` are both a box and a third provider's `Droplet` is one for free
 * — ADR 0052 §5 makes a Fleet provider a registered module, so a list of full type tokens here would
 * be a place the console had to be taught about every one of them. The narrow risk is a resource type
 * that ends in one of these words and is not a box; the wider one is a whole provider's Machines
 * silently missing from this page, and that is the one that has actually happened to a list in this
 * codebase (`secrets` in `SPA_SURFACES`).
 */
const MACHINE_TYPE_TAILS: readonly string[] = ['Droplet', 'Container'];

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Fold one checkpoint into the Machines and Placements this page joins on.
 *
 * ── THE INVENTORY IS THE AUTHORITY WHEN THERE IS ONE ─────────────────────────────────────────────
 *
 * Both Fleet programs publish `outputs.inventory` keyed by Machine name — "the narrow one-way handoff
 * Fleet gives Execution" (`programs/fleet.ts:310-312`). That is the program's own answer to which
 * boxes exist, so it is preferred over pattern-matching resource types, and the resources are then
 * only where `created`, `status` and `priceMonthly` come from. A stack with no inventory (the host's
 * `kontra-control` program, whose shape ADR 0052 §1 does not fix) falls back to
 * {@link MACHINE_TYPE_TAILS}.
 *
 * ── `placements` OVER THE SCALARS, ALWAYS, BECAUSE INHERITING ONE OF TWO IS A TEARDOWN ───────────
 *
 * `programs/fleet.ts:468-486` keeps both: the `placements` array and `actorName`/`actorVersion`
 * scalars describing the FIRST placement in name order. A packed Fleet cannot be summarised by the
 * scalars, and reading them when the array is there would draw one Worker on a Fleet running two.
 * `cli/fleet.go` prefers the array for the same reason; so does this.
 */
export function narrowStack(fqn: string, wire: StackStateWire): StackReading {
  const [project = '', stack = ''] = fqn.split('/');
  const outputs = wire.outputs ?? {};
  const resources = wire.resources ?? [];

  // name → the checkpoint resource that IS that box, keyed on the provider's own name so a logical
  // URN name that differs from the hostname cannot silently split one Machine into two rows.
  const byName = new Map<string, (typeof resources)[number]>();
  for (const r of resources) {
    if (r.synthetic === true) continue;
    const name = str(r.detail?.['name']) ?? str(r.name);
    if (name !== undefined && !byName.has(name)) byName.set(name, r);
  }

  const inventory = outputs['inventory'];
  const named =
    inventory !== null && typeof inventory === 'object'
      ? Object.keys(inventory as Record<string, unknown>)
      : [...byName.keys()].filter((name) => {
          const type = str(byName.get(name)?.type) ?? '';
          return MACHINE_TYPE_TAILS.some((t) => type.endsWith(`:${t}`));
        });

  const inv = (inventory ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const machines: MachineReading[] = named.map((name) => {
    const d = byName.get(name)?.detail ?? {};
    const entry = inv[name] ?? {};
    return {
      name,
      ...opt('size', str(d['size']) ?? str(entry['size'])),
      ...opt('region', str(d['region'])),
      // The private address is how the Controller reaches it, which is the one an operator debugging
      // a Worker actually types. The public one is second because it is what rate limits by source IP.
      ...opt('address', str(d['ipv4AddressPrivate']) ?? str(entry['host']) ?? str(d['ipv4Address'])),
      ...opt('status', str(d['status'])),
      ...optNum('priceMonthly', num(d['priceMonthly'])),
      ...opt('created', str(byName.get(name)?.created)),
    };
  });

  const raw = outputs['placements'];
  const placements: PlacementReading[] = Array.isArray(raw)
    ? raw.flatMap((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const actor = str(o['actorName']);
        return actor === undefined
          ? []
          : [
              {
                actor,
                version: str(o['actorVersion']) ?? '',
                ...optNum('workers', num(o['workers'])),
                ...optNum('maxSessions', num(o['maxSessions'])),
                ...opt('workerImage', str(o['workerImage'])),
                ...opt('bundleSha', str(o['bundleSha'])),
              },
            ];
      })
    : // A checkpoint that predates packing. One Worker per Machine, which is what every Fleet did.
      //
      // `workerImage` IS NOT READ HERE AND THAT IS NOT AN OVERSIGHT. Both programs echo `bundleUrl`,
      // `bundleSha`, `actorName`, `actorVersion`, `actorEngine`, `controller` and `maxSessions` as
      // top-level scalars describing the first placement (`fleet.ts:471-489`) — and `workerImage` is
      // NOT among them. It exists only inside the `placements` array. So a checkpoint old enough to
      // have no array has no container digest to compare, which renders as no drift line at all
      // rather than as `unknown` about a fact that was never recorded.
      (() => {
        const actor = str(outputs['actorName']);
        return actor === undefined
          ? []
          : [
              {
                actor,
                version: str(outputs['actorVersion']) ?? '',
                ...optNum('maxSessions', num(outputs['maxSessions'])),
                ...opt('bundleSha', str(outputs['bundleSha'])),
              },
            ];
      })();

  return {
    fqn,
    project,
    stack,
    ...opt('updated', str(wire.updated)),
    machines,
    placements,
  };
}

/** Spread-or-omit, so an absent fact is an ABSENT KEY rather than an `undefined` one — the same rule
 *  `Settings.svelte:32` draws by: a fact that is not there draws no row rather than an empty one. */
function opt(key: string, v: string | undefined): Record<string, string> {
  return v === undefined ? {} : { [key]: v };
}
function optNum(key: string, v: number | undefined): Record<string, number> {
  return v === undefined ? {} : { [key]: v };
}

// ── THE FIVE STATES ───────────────────────────────────────────────────────────────────────────────

export type PollState = 'serving' | 'stale' | 'undated' | 'nothing-polling' | 'unknown';

/** In the order a reader should be able to tell them apart. Data, so the legend cannot drift. */
export const POLL_STATES: readonly PollState[] = [
  'serving',
  'stale',
  'undated',
  'nothing-polling',
  'unknown',
];

/** The word, so the state is legible without colour. */
export function stateWord(state: PollState): string {
  if (state === 'nothing-polling') return 'nothing polling';
  return state;
}

/** What the state means for somebody about to dispatch. Shown, because the state alone is jargon. */
export function stateHint(state: PollState): string {
  switch (state) {
    case 'serving':
      return 'a poll inside the freshness window — a dispatch runs now';
    case 'stale':
      return 'Temporal still lists this identity and it has not polled recently; it keeps one for about five minutes after a Worker stops';
    case 'undated':
      return 'Temporal listed the identity without dating it, which is evidence of neither';
    case 'nothing-polling':
      return 'no identity at all — the Placement converged, and a dispatch hangs to StartToClose';
    case 'unknown':
      return 'Temporal could not be asked. This is not the same as nothing polling';
  }
}

/**
 * The project the HOST engine converges. ADR 0052 §1's table: `kontra-control` on the host,
 * `kontra-fleet` / `kontra-docker-fleet` (and any other provider) in the cluster, and the two
 * dispatch tables refuse each other's projects.
 *
 * ONE STRING, EXPORTED AND OVERRIDABLE. `infra/stacks.ts` exports `FLEET_PROJECT` and
 * `DOCKER_FLEET_PROJECT` but has no control arm — the host table is the authority and it lives in a
 * package the browser does not import. Naming everything-that-is-not-control a Fleet means a second
 * provider's project lands in the Fleets half by default, which is where it belongs, instead of
 * disappearing out of a list this console had to be taught about.
 */
export const CONTROL_PROJECT = 'kontra-control';

// ── ROWS ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * One thing serving on one Machine.
 *
 * `key` IS `<machine>::<queue>` AND THAT IS THE POINT. The pair is the row's own identity, the state
 * below was folded from the pollers whose host is that Machine, and nothing in this module can
 * produce a row whose `state` came from a different `key`.
 */
export interface ServingRow {
  key: string;
  /** The Machine this row is under. Empty for a {@link StackRow.declared} row, which has no box. */
  machine: string;
  queue: string;
  /** The actor, or the control-plane role's purpose. */
  title: string;
  /** The actor version. Empty on a role row — a role has no version. */
  version: string;
  state: PollState;
  /** The identity the state was read from. Absent unless a poller on this Machine matched. */
  identity?: string;
  /** That identity's own freshest poll, epoch ms. `0` when Temporal did not date it. */
  lastPoll: number;
  /** Why the state is `unknown`: the describe error, verbatim. */
  unknown?: string;
  /** Facts that belong beside the state — `KONTRA_DATASET_SLOTS`, `maxSessions`, the variable. */
  notes: readonly string[];
  /** The digest-pinned image this Worker is running. See {@link PlacementReading.workerImage}. */
  image?: string;
  /** The Bundle sha, for a Worker that runs one. See {@link PlacementReading.bundleSha}. */
  bundleSha?: string;
  /** Pinned digest vs what the tag resolves to now. ABSENT when there is no image to ask about. */
  drift?: DriftReading;
}

export interface MachineRow extends MachineReading {
  /** `<fqn>::<name>`. Two stacks may both hold a `kf-local-01`. */
  key: string;
  serving: readonly ServingRow[];
}

/**
 * One Placement whose image needs a sentence, said once for the stack.
 *
 * ── WHY THIS IS NOT ON THE ROW ───────────────────────────────────────────────────────────────────
 *
 * DRIFT IS A PROPERTY OF THE PLACEMENT, NOT OF THE MACHINE. Every Worker of one Placement runs the
 * same digest — `dockerFleet.ts:assignmentFor` hands every Machine the same `image` — so the verdict
 * is identical on all of them by construction. MEASURED IN CHROMIUM at 390px on a four-Machine Fleet:
 * the explanatory sentence wraps to four lines and repeating it per Machine cost sixteen lines of
 * identical prose, which on a twelve-Machine Fleet is forty-eight. A warning repeated until it is
 * scenery is the same failure `load.ts:collapse` fixes for the missing-route list.
 *
 * So {@link ServingRow.drift} stays on every row — the digest and the verdict ARE per-Worker facts,
 * and ADR 0052 §6 wants "each Worker shows the digest it is running" — and the SENTENCE is here,
 * deduplicated to one per Placement.
 */
export interface DriftNote {
  /** `<actor>@<version>`, which is also `drift.ts:imageKey`: one note per Placement, not per Machine. */
  key: string;
  title: string;
  version: string;
  drift: DriftReading;
}

export interface StackRow {
  fqn: string;
  project: string;
  stack: string;
  updated?: string;
  kind: 'control' | 'fleet';
  machines: readonly MachineRow[];
  /**
   * Rows with no Machine to hang off: a queue this control plane says it polls that no Machine in
   * this stack is polling, or a Placement on a stack with no Machines.
   *
   * SHOWN, NOT DROPPED, for the same reason the unattributed bucket exists. A `kontra-datasets` row
   * with `nothing polling` is the single most actionable line on this page, and it has no box —
   * which is precisely what is wrong with it.
   */
  declared: readonly ServingRow[];
  /** Sum of `priceMonthly` across this stack's Machines. `0` when nothing priced. */
  priceMonthly: number;
  /**
   * This stack's recent life, one tick per Pulumi converge — `infra/history.ts`.
   *
   * ABSENT, NOT EMPTY, WHEN THE RECORDS WERE NOT READ. The route is issue 13's and does not exist
   * yet, so the ordinary case today is no history at all; an empty {@link ConvergeStrip} would be
   * this console asserting that a stack has never converged, which for every stack on the live volume
   * is false. Absent means "not asked", empty-with-zero-ticks means "asked, and it never converged".
   */
  converges?: ConvergeStrip;
  /**
   * The Placements on this stack whose image needs saying out loud — `drifted` and `unpinned`, one
   * note each. Empty when every image is current, unknown, or absent.
   *
   * `current` AND `unknown` ARE NOT HERE and that is deliberate. A Fleet running exactly what its tag
   * names needs no paragraph, and `unknown` is the state of EVERY Placement on every install today —
   * no route serves a registry resolve — so a note for it would put the same sentence on every stack
   * on the page and bury the one that differs. Both still draw their word on the Worker's own row.
   */
  driftNotes: readonly DriftNote[];
}

/**
 * A poller whose host matches no Machine anywhere.
 *
 * SHOWN, NOT DROPPED. `@kontra/core/queues:identityHost` is explicit: "a custom `Identity` is legal,
 * and a Worker we cannot attribute is `unknown`, not `none`." This bucket is where a developer
 * running `kontra serve --actor` against the same control plane appears, and dropping it is what
 * otherwise makes a 12-Machine Fleet report thirteen pollers.
 */
export interface UnattributedRow {
  /** `<queue>::<identity>`. One row per identity per queue. */
  key: string;
  identity: string;
  /** The host the identity names, when it names one. */
  host?: string;
  queue: string;
  state: PollState;
  lastPoll: number;
  /** False when `identityHost` could not read a host out of the identity at all. */
  parsed: boolean;
}

export interface MachineView {
  control: readonly StackRow[];
  fleets: readonly StackRow[];
  unattributed: readonly UnattributedRow[];
  /** Machines across every stack — the number the group headers count. */
  machines: number;
}

// ── THE FOLD ──────────────────────────────────────────────────────────────────────────────────────

/**
 * This Machine's own poll state on this queue.
 *
 * READS `workers`, NEVER `lastPoll` — the header says why at length. The fold takes the FRESHEST
 * poll among the identities whose host is this Machine, because two PIDs on one box are two
 * identities and a Worker that was restarted leaves the old one listed for about five minutes.
 */
export function pollFor(
  machine: string,
  report: PollerReading | undefined,
  now: number
): { state: PollState; identity?: string; lastPoll: number; unknown?: string } {
  // "We could not ask" first, because every answer below it would be a count from no evidence.
  if (report === undefined) {
    return { state: 'unknown', lastPoll: 0, unknown: 'this queue was not reported' };
  }
  if (report.error !== undefined) return { state: 'unknown', lastPoll: 0, unknown: report.error };

  let best: { identity: string; lastPoll: number } | undefined;
  for (const w of report.workers ?? []) {
    if (identityHost(w.identity) !== machine) continue;
    if (best === undefined || w.lastPoll > best.lastPoll) best = w;
  }
  if (best === undefined) return { state: 'nothing-polling', lastPoll: 0 };

  // `0` is Temporal listing an identity without dating it. `pollIsFresh` counts it as neither fresh
  // nor stale, and so does this: undated is its own answer.
  if (best.lastPoll <= 0) {
    return { state: 'undated', identity: best.identity, lastPoll: 0 };
  }
  return {
    state: pollIsFresh(best.lastPoll, now) ? 'serving' : 'stale',
    identity: best.identity,
    lastPoll: best.lastPoll,
  };
}

/** The same fold for a poller we already have in hand, used by the unattributed bucket. */
function stateOf(lastPoll: number, now: number): PollState {
  if (lastPoll <= 0) return 'undated';
  return pollIsFresh(lastPoll, now) ? 'serving' : 'stale';
}

/**
 * One row, for one Machine, from one thing the stack wants served.
 *
 * IT TAKES THE WHOLE {@link Wanted} RATHER THAN ITS FIELDS. It used to take `queue`, `title`,
 * `version` and `notes` as four positional arguments; carrying the pinned image and the Bundle sha
 * through as well would have made it eight, and a call with eight positional arguments is where
 * `title` and `version` get swapped by an edit that typechecks. The object is built once per wanted
 * thing and passed whole, so a new fact on a row is a field and not another argument.
 */
function row(
  machine: string,
  w: Wanted,
  report: PollerReading | undefined,
  now: number,
  images: Readonly<Record<string, ResolvedImage | undefined>>
): ServingRow {
  const poll = pollFor(machine, report, now);
  // The verdict, from `drift.ts`, which returns `undefined` when there is no image to ask about — a
  // cloud Fleet's Workers run a Bundle and have no container digest. Absent draws no row.
  const drift =
    w.image === undefined ? undefined : driftOf(w.image, w.version, images[imageKey(w.title, w.version)]);
  return {
    key: `${machine}::${w.queue}`,
    machine,
    queue: w.queue,
    title: w.title,
    version: w.version,
    notes: w.notes,
    state: poll.state,
    lastPoll: poll.lastPoll,
    ...(poll.identity === undefined ? {} : { identity: poll.identity }),
    ...(poll.unknown === undefined ? {} : { unknown: poll.unknown }),
    ...(w.image === undefined ? {} : { image: w.image }),
    ...(w.bundleSha === undefined ? {} : { bundleSha: w.bundleSha }),
    ...(drift === undefined ? {} : { drift }),
  };
}

/** What one stack says should be serving, before any Machine is chosen for it. */
interface Wanted {
  queue: string;
  title: string;
  version: string;
  notes: string[];
  /** See {@link PlacementReading.workerImage}. A role row has none — a role runs this process. */
  image?: string;
  bundleSha?: string;
}

/**
 * The control stack's queues, from `queueAssignments(roles)` and nowhere else.
 *
 * `purpose` IS THE TITLE, and that is the whole reason this function returns what it returns: the
 * assignment already carries the sentence a reader needs ("dataset write, paging and retention"), so
 * the console does not get to write its own words for a queue whose meaning the server decides.
 */
function wantedFromRoles(assignments: readonly QueueAssignmentReading[]): Wanted[] {
  return assignments.map((a) => ({
    queue: a.queue,
    title: a.purpose,
    // A role has no version. Empty rather than the role name, so `sharedQueue`'s `-shared` suffix
    // convention cannot be read into a queue that does not follow it.
    version: '',
    notes: [
      a.role,
      a.variable,
      // The slot count reads as a sentence rather than a bare number, because "1" beside a queue name
      // is not obviously the thing that serialises publishes, page reads, Lease holds and retention.
      ...(a.slots === undefined
        ? []
        : [`${a.slots} activity slot${a.slots === 1 ? '' : 's'} (KONTRA_DATASET_SLOTS)`]),
    ],
  }));
}

/** A Fleet's Placements. The queue is derived, never read off the checkpoint. */
function wantedFromPlacements(placements: readonly PlacementReading[]): Wanted[] {
  return placements.map((p) => ({
    // `sharedQueue` is the cross-language derivation held to one answer by
    // `shared/conformance/queues.json` §shared. Reading a queue name out of the checkpoint instead
    // would be a fifth implementation of a rule that has four.
    queue: sharedQueue(p.actor, p.version),
    title: p.actor,
    version: p.version,
    notes:
      p.maxSessions === undefined || p.maxSessions === 0
        ? []
        : [`${p.maxSessions} session${p.maxSessions === 1 ? '' : 's'} per Worker`],
    ...(p.workerImage === undefined ? {} : { image: p.workerImage }),
    ...(p.bundleSha === undefined ? {} : { bundleSha: p.bundleSha }),
  }));
}

/**
 * Every Machine this control plane owns, and what is serving on each.
 *
 * ── TWO PLACEMENT RULES, ONE PER HALF, AND NEITHER IS THE OTHER'S ────────────────────────────────
 *
 * A FLEET knows which Machines a Placement landed on without asking Temporal, because the converge
 * decided it: the first `workers` Machines IN NAME ORDER (`programs/fleet.ts:131-135` — "Taking a
 * prefix means a scale-up ADDS Workers and never relocates one"). So a Fleet Machine gets its row
 * whether or not anything is polling, which is exactly how `nothing polling` comes to be drawn under
 * a box that exists: the Placement converged and the Worker is not there.
 *
 * THE CONTROL STACK has no placements. `queueAssignments` describes the PROCESS — which queues the
 * roles this PID serves will poll — and thirteen containers do not each poll them; one does. So a
 * role row is attributed to the Machine its poller NAMES, by the same `identityHost` equality as
 * everything else, and a role row nobody names lands in {@link StackRow.declared}. Spreading role
 * rows across every container instead would draw twenty-four `nothing polling` rows under `postgres`
 * and `redis` and bury the one that matters.
 *
 * ORDER IS NAME ORDER in both halves, because the prefix rule above is name order and a console that
 * listed Machines in checkpoint order would put the Workers under the wrong boxes on a packed Fleet.
 */
export function deriveMachines(input: MachineInput): MachineView {
  const controlProject = input.controlProject ?? CONTROL_PROJECT;
  const { now, pollers } = input;
  // Both default to nothing asked, which is what the two routes behind them are today: issue 13 owes
  // the history one and nothing at all serves a registry resolve. See the two field comments.
  const history = input.history ?? {};
  const images = input.images ?? {};

  // Every Machine name across BOTH halves, which is what decides whether a poller is attributable.
  // Both, not this stack's: a `kontra serve` on a laptop must not be attributed to a Fleet Machine,
  // and a Fleet Machine's Worker must not land in Unattributed because we were looking at the
  // control stack when we asked.
  const known = new Set<string>();
  for (const s of input.stacks) for (const m of s.machines) known.add(m.name);

  const stacks: StackRow[] = input.stacks.map((s) => {
    const kind: 'control' | 'fleet' = s.project === controlProject ? 'control' : 'fleet';
    const machines = [...s.machines].sort((a, b) => a.name.localeCompare(b.name));
    const names = new Set(machines.map((m) => m.name));

    const serving = new Map<string, ServingRow[]>(machines.map((m) => [m.name, []]));
    const declared: ServingRow[] = [];
    const put = (name: string, r: ServingRow): void => void serving.get(name)?.push(r);

    if (kind === 'control') {
      for (const w of wantedFromRoles(input.assignments)) {
        const report = pollers[w.queue];
        // The hosts this queue's pollers name, narrowed to Machines in THIS stack. A describe error
        // leaves it empty and the row lands in `declared` carrying `unknown` — which is right: we
        // cannot say which container polls a queue we could not ask about.
        const on = [...new Set((report?.workers ?? []).map((p) => identityHost(p.identity)))].filter(
          (h): h is string => h !== undefined && names.has(h)
        );
        if (on.length === 0) {
          declared.push(row('', w, report, now, images));
          continue;
        }
        for (const name of on) put(name, row(name, w, report, now, images));
      }
    } else {
      const wanted = wantedFromPlacements(s.placements);
      for (const [i, p] of s.placements.entries()) {
        const w = wanted[i];
        if (w === undefined) continue;
        const limit = p.workers === undefined || p.workers <= 0 ? machines.length : p.workers;
        const on = machines.slice(0, limit);
        if (on.length === 0) {
          // A Placement echoed by a stack with no Machines. Its state is `nothing polling` because no
          // Machine is polling it — if something is, it is in the unattributed bucket, which is the
          // honest place for a Worker we cannot put in a box.
          declared.push(row('', w, pollers[w.queue], now, images));
          continue;
        }
        for (const m of on) put(m.name, row(m.name, w, pollers[w.queue], now, images));
      }
    }

    // ASKED-AND-EMPTY IS A STRIP; NOT-ASKED IS NO STRIP. `history[s.fqn]` present and empty means the
    // route answered and this stack has never converged — `infra/state.ts:18` calls that "a normal
    // answer" and `strip([])` renders it as a strip with no ticks. `undefined` means nobody asked,
    // which must not draw anything at all.
    const records = history[s.fqn];

    // ONE NOTE PER PLACEMENT, not per Machine — see {@link DriftNote}. Keyed on `imageKey` so a
    // packed Fleet running two Actors gets two notes and a Fleet running one on twelve boxes gets one.
    const notes = new Map<string, DriftNote>();
    for (const r of [...serving.values()].flat().concat(declared)) {
      if (r.drift === undefined) continue;
      if (r.drift.state !== 'drifted' && r.drift.state !== 'unpinned') continue;
      const key = imageKey(r.title, r.version);
      if (!notes.has(key)) notes.set(key, { key, title: r.title, version: r.version, drift: r.drift });
    }

    return {
      fqn: s.fqn,
      project: s.project,
      stack: s.stack,
      ...(s.updated === undefined ? {} : { updated: s.updated }),
      kind,
      machines: machines.map((m) => ({ ...m, key: `${s.fqn}::${m.name}`, serving: serving.get(m.name) ?? [] })),
      declared,
      priceMonthly: machines.reduce((n, m) => n + (m.priceMonthly ?? 0), 0),
      ...(records === undefined ? {} : { converges: strip(records) }),
      driftNotes: [...notes.values()],
    };
  });

  // ── the unattributed bucket ─────────────────────────────────────────────────────────────────────
  const unattributed: UnattributedRow[] = [];
  for (const [queue, report] of Object.entries(pollers)) {
    // A queue that could not be described has no identities to attribute; reporting its absence as
    // "nobody" is the conflation this whole module refuses.
    if (report === undefined || report.error !== undefined) continue;
    for (const w of report.workers ?? []) {
      const host = identityHost(w.identity);
      if (host !== undefined && known.has(host)) continue;
      unattributed.push({
        key: `${queue}::${w.identity}`,
        identity: w.identity,
        ...(host === undefined ? {} : { host }),
        queue,
        state: stateOf(w.lastPoll, now),
        lastPoll: w.lastPoll,
        parsed: host !== undefined,
      });
    }
  }
  unattributed.sort((a, b) => a.key.localeCompare(b.key));

  return {
    control: stacks.filter((s) => s.kind === 'control'),
    fleets: stacks.filter((s) => s.kind === 'fleet'),
    unattributed,
    machines: stacks.reduce((n, s) => n + s.machines.length, 0),
  };
}
