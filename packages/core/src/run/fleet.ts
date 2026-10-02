/**
 * The Machines a RUN stood up, as something that can be drawn while it is happening.
 *
 * ── WHY THE RUN PAGE NEEDS ITS OWN DERIVATION AND NOT THE INFRA PAGE'S ──────────────────────────
 *
 * `infra/machines.ts` answers "which Machines does this control plane own, and what is polling on
 * each" — an inventory, read once, for an operator who came to look at the estate. This answers a
 * different question with the same bytes: "what is THIS run building, right now". Three things
 * differ and each of them is the reason this is a second module rather than a flag on the first:
 *
 *   • SCOPE. The infra page shows every stack on the volume; a run owns the handful of Fleet children
 *     its own history names, and showing it a neighbouring campaign's Machines would be a lie about
 *     what it is spending.
 *   • A MACHINE THAT DOES NOT EXIST YET IS A FACT HERE. The inventory has no use for one — it lists
 *     what is there. A bring-up is mostly the period before the boxes exist, and a rack that draws
 *     nothing for the first four minutes is the empty-region-reads-as-a-hang failure
 *     `Progress.svelte` already exists to fix.
 *   • THE ENGINE'S CURSOR. `stackWorkflow`'s heartbeat carries the URN of the resource Pulumi is on
 *     THIS SECOND (`activities/infra.ts` — `last = {op, urn}`). The infra page has no window in which
 *     that is meaningful; here it is the whole point.
 *
 * ── IT DERIVES NOTHING TWICE ────────────────────────────────────────────────────────────────────
 *
 * `narrowStack` and `deriveMachines` are called, not reimplemented. The checkpoint → Machines →
 * Placements → poll-state fold is theirs and has a 685-line test beside it; what this module adds is
 * the three facts above, folded ON TOP. A second reading of a checkpoint that disagreed with the
 * infra page about which Workers are on which box would be exactly the kind of fourth authority
 * `routes/runStream.ts` refuses to become.
 *
 * ── NOTHING HERE READS A CLOCK, A FILE OR A SOCKET ──────────────────────────────────────────────
 *
 * `infra/machines.ts`'s rule, kept: every reading is an argument, `now` is an argument, and the
 * drawing is `runs/Rack.svelte`. A derivation with a test is a fact; the rack on the screen is a
 * drawing of one.
 */
import {
  deriveMachines,
  narrowStack,
  type MachineRow,
  type PollerReading,
  type PollState,
  type StackStateWire,
} from '../infra/machines';
import type { RunEvent } from './api';

// ── WHICH CHILDREN OF THIS RUN ARE FLEETS ─────────────────────────────────────────────────────────

/**
 * The workflow type every Fleet converge runs under — `control/orchestrator/src/workflows/stack.ts`.
 *
 * MATCHED ON THE TYPE, NEVER ON THE ID's PREFIX, and that is the decision in this half of the file.
 * A stack's workflow id IS its fqn (`kontra-fleet/recon-s4`), so `startsWith('kontra-fleet/')` looks
 * like a free discriminator — and it is a list this console would have to be taught about. ADR 0052
 * §5 makes a Fleet provider a registered module: `kontra-docker-fleet` already exists, a third
 * provider's project is a string nobody here will hear about, and the failure is silent — that
 * provider's Machines simply never appear. `stackWorkflow` is one string that covers all of them,
 * and `infraRoutes.ts` starts every one of them with it.
 */
export const STACK_WORKFLOW = 'stackWorkflow';

/** One Fleet converge this run started. */
export interface FleetLink {
  /** `<project>/<stack>` — the child's workflow id AND the stack's fqn. They are the same string
   *  by construction (ADR 0019), which is what makes one workflow the mutex for one stack. */
  fqn: string;
  /**
   * Temporal's run id for THIS execution.
   *
   * CARRIED BECAUSE THE ID IS REUSED. `kontra-fleet/recon-s4` is the workflow id of the bring-up AND
   * of the teardown, so a reader that asks by id alone gets whichever ran last — on a finished run
   * that is the teardown, and the rack would report a Fleet being destroyed as the thing the run
   * built. `EventLink.execId` carries the same warning in the same words.
   */
  execId?: string;
  /** Seconds since the run's first event — the same clock `Progress.svelte` draws against. */
  t0: number;
  /** Epoch ms, for a reader that wants a wall time. */
  at: number;
  /** Seconds this child ran, from the event that closed it. 0 while it is still open. */
  dur: number;
  /** The child reached a terminal state in this run's history. */
  closed: boolean;
  /** It closed by failing, timing out, being cancelled or being terminated. */
  failed: boolean;
}

/** Every event type that ENDS a child workflow, and whether ending that way is a failure. */
const CHILD_CLOSED: Readonly<Record<string, boolean>> = {
  ChildWorkflowExecutionCompleted: false,
  ChildWorkflowExecutionFailed: true,
  ChildWorkflowExecutionCanceled: true,
  ChildWorkflowExecutionTimedOut: true,
  ChildWorkflowExecutionTerminated: true,
  StartChildWorkflowExecutionFailed: true,
};

/**
 * The Fleet converges this run started, in the order it started them.
 *
 * ── THE TYPE IS LEARNED ONCE AND APPLIED TO EVERY EVENT ABOUT THAT CHILD ────────────────────────
 *
 * Only `StartChildWorkflowExecutionInitiated` reliably names a `workflowType`; the Started and
 * Completed events for the same child may carry only the id. So the type is collected in a first
 * pass and every link is resolved against it, rather than dropping the events that happen not to
 * repeat it. Without that a Fleet would be found but never seen to close, and the rack would report
 * a converge still running twenty minutes after it finished — the exact class of wrong-but-renders
 * failure this console keeps finding.
 *
 * ── ONE ENTRY PER (id, execId), NOT PER ID ──────────────────────────────────────────────────────
 *
 * A run that brings a Fleet up and tears it down again has TWO converges under one id, and they are
 * different operations with different outcomes. Keying on the id alone would fold them into one row
 * whose `dur` came from the bring-up and whose `failed` came from the teardown.
 */
export function fleetStacksOf(events: readonly RunEvent[]): FleetLink[] {
  const typeOf = new Map<string, string>();
  for (const e of events) {
    const id = e.link?.workflowId;
    if (id !== undefined && e.link?.type) typeOf.set(id, e.link.type);
  }

  const order: string[] = [];
  const byKey = new Map<string, FleetLink>();

  for (const e of events) {
    const link = e.link;
    if (!link?.workflowId) continue;
    if ((link.type ?? typeOf.get(link.workflowId)) !== STACK_WORKFLOW) continue;
    // An fqn is `<project>/<stack>` and nothing else. A `stackWorkflow` whose id is not one cannot be
    // read into a stack, and inventing one would point the state read at a path that is not there.
    if (!/^[^/]+\/[^/]+$/.test(link.workflowId)) continue;

    const key = `${link.workflowId}::${link.execId ?? ''}`;
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = {
        fqn: link.workflowId,
        ...(link.execId === undefined ? {} : { execId: link.execId }),
        t0: e.t,
        at: e.at,
        dur: 0,
        closed: false,
        failed: false,
      };
      byKey.set(key, entry);
      order.push(key);
    }

    const closedAs = CHILD_CLOSED[e.type];
    if (closedAs !== undefined) {
      entry.closed = true;
      entry.failed = closedAs;
      // `dur` is the closing event's own measure of the window it closes. 0 means the history did
      // not record one, which is not the same as an instant converge — left at 0, and the drawing
      // falls back to the elapsed clock.
      if (e.dur > 0) entry.dur = e.dur;
    }
  }

  return order.map((k) => byKey.get(k)!).filter((l): l is FleetLink => l !== undefined);
}

// ── WHAT THE ENGINE IS DOING RIGHT NOW ────────────────────────────────────────────────────────────

/** `GET /api/infra/ops/:fqn`, as `infraRoutes.ts:readStackOp` sends it. Every field optional: this is
 *  untrusted JSON, and the route answers 404 for a converge Temporal has dropped. */
export interface StackOpWire {
  fqn?: string;
  /** Temporal's status for the converge — `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`. */
  status?: string;
  /** `stackWorkflow`'s `getProgress` query: `{phase, op}` while it runs, `{result, changes}` after.
   *  The workflow's own four words — it carries NO resource, see {@link StackOpWire.cursor}. */
  progress?: Record<string, unknown>;
  /**
   * The engine's activity heartbeat, decoded: `{op, urn}` for the resource it is on RIGHT NOW.
   *
   * A SEPARATE FIELD BECAUSE IT IS A SEPARATE AUTHORITY. `progress` is a variable the workflow
   * assigns at four points; this is what the Pulumi engine emitted milliseconds ago. The route's own
   * comment used to promise the second and return the first — the URN was on the pending activity,
   * which a workflow query cannot reach — so `urn` is read off `progress` too, below, and finding it
   * there is not expected on any control plane that has this field.
   */
  cursor?: Record<string, unknown>;
}

/**
 * The resource Pulumi is on, parsed out of a URN.
 *
 * A URN is `urn:pulumi:<stack>::<project>::<type>::<name>`, and the last two fields are the only ones
 * worth drawing: the type says what kind of thing, the name says which one. The name is what joins
 * back to a Machine, because `programs/fleet.ts` names every resource after the Machine it belongs to
 * — `kf-recon-01` for the Droplet, `kf-recon-01-actor-webcrawl` for the Placement.
 */
export interface Cursor {
  /** `create`, `update`, `delete`, `same`, … — Pulumi's own word for the step. */
  op: string;
  /** The resource type, e.g. `digitalocean:index/droplet:Droplet`. Empty when the urn had none. */
  type: string;
  /** The resource's own name, the tail of the urn. */
  name: string;
  /** The Machine this step is about, when the name identifies one. */
  machine?: string;
  /** The Actor being placed, when this step is a Placement rather than a Machine. */
  actor?: string;
}

/** `urn:pulumi:<stack>::<project>::<type>::<name>` → the last two fields. `undefined` when the string
 *  is not a urn at all — the heartbeat carries whatever Pulumi put in it, and a `{changes}` frame has
 *  no urn in it whatsoever. */
export function parseUrn(urn: unknown): { type: string; name: string } | undefined {
  if (typeof urn !== 'string' || !urn.startsWith('urn:pulumi:')) return undefined;
  const parts = urn.split('::');
  if (parts.length < 4) return undefined;
  const name = parts[parts.length - 1] ?? '';
  const type = parts[parts.length - 2] ?? '';
  return name === '' ? undefined : { type, name };
}

/**
 * Which Machine — and which Placement — a resource name is about.
 *
 * THE NAMES ARE THE SERVER'S AND THEY ARE NOT GUESSED AT. `programs/fleet.ts` builds exactly two:
 * `kf-<tag>-NN` for a Droplet and `` `${m.name}-actor-${actor.name}` `` for the Command that installs
 * a Worker on it. So the Placement's name CONTAINS its Machine's, and splitting on `-actor-` is
 * reading the server's own composition rather than matching a pattern. A name that is neither — a
 * provider, a synthetic — yields no machine, and the cursor then says what it says without pointing
 * at a box.
 */
export function resourceRole(name: string): { machine?: string; actor?: string } {
  const at = name.indexOf('-actor-');
  if (at > 0) {
    return { machine: name.slice(0, at), actor: name.slice(at + '-actor-'.length) };
  }
  // A Machine's own name. Matched rather than assumed, so a provider resource called `default_4_5_0`
  // does not become a Machine nothing will ever draw.
  return /^kf-[a-z0-9-]+-\d+$/.test(name) ? { machine: name } : {};
}

/**
 * What one `/api/infra/ops/:fqn` read says the engine is on, folded.
 *
 * `cursor` FIRST, `progress` AS A FALLBACK, and the fallback is for a control plane older than the
 * field rather than for a shape that occurs. `progress` is `stackWorkflow`'s stored `{phase, op}`
 * and has never carried a `urn`; reading it anyway costs one property access and means a console
 * deployed ahead of its orchestrator degrades to no cursor instead of to a wrong one.
 *
 * `op` COMES FROM THE SAME BAG AS THE URN, always. The two words are different vocabularies —
 * `progress.op` is the WORKFLOW's (`up`, `preview`, `destroy`) and `cursor.op` is PULUMI's for one
 * resource (`create`, `delete`, `same`) — and mixing them would render `destroy kf-recon-03` for a
 * Machine being made during a teardown of a different one.
 */
export function cursorOf(wire: StackOpWire | undefined): Cursor | undefined {
  for (const bag of [wire?.cursor, wire?.progress]) {
    if (bag === undefined || bag === null) continue;
    const parsed = parseUrn(bag['urn']);
    if (parsed === undefined) continue;
    const op = bag['op'];
    return {
      op: typeof op === 'string' ? op : '',
      type: parsed.type,
      name: parsed.name,
      ...resourceRole(parsed.name),
    };
  }
  return undefined;
}

// ── THE RACK ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A Machine's lifecycle, which is NOT its poll state and never stands in for it.
 *
 * `infra/machines.ts` is explicit that a checkpoint's `status` field "is written when a stack
 * converges and never again, so a Machine that died an hour ago still reads `active`" — calling a box
 * healthy from a stale field is the green-label-over-lost-work failure of ADR 0017. So these five
 * words are about EXISTENCE ONLY, derived from what the checkpoint holds and what the engine says it
 * is doing right now, and whether a Worker is actually serving stays the {@link PollState} on the
 * Actor, which is a live read.
 *
 *   planned     the converge asked for this Machine and the checkpoint does not hold it yet
 *   creating    the engine's cursor is on THIS Machine, this second
 *   up          the checkpoint holds it and nothing is currently tearing it down
 *   destroying  the cursor is on it during a `destroy`
 *   gone        the checkpoint held it and no longer does
 */
export type MachineLife = 'planned' | 'creating' | 'up' | 'destroying' | 'gone';

/**
 * Does this Machine EXIST — is there a box somewhere with an address, accruing cost?
 *
 * `creating` IS NOT ONE OF THEM, and that is the line worth drawing precisely. A Machine the engine
 * is creating is a provider call in flight: nothing has booted, nothing is billable, and counting it
 * would make the headline number jump forward and then sit still while the box it already counted
 * finished coming up. `destroying` IS one: the teardown is in flight and the Droplet is still there
 * until the provider says otherwise — the honest direction to be wrong in, given what an
 * over-optimistic teardown count costs (see the orphan note in `infra/history.ts`).
 */
export function machineExists(life: MachineLife): boolean {
  return life === 'up' || life === 'destroying';
}

export interface RackActor {
  /** `<machine>::<actor>` — the pair is the unit's own identity. */
  key: string;
  name: string;
  version: string;
  /** The five states of `infra/machines.ts`, unchanged. `unknown` is never `nothing-polling`. */
  state: PollState;
  /** Why the state is `unknown`: the describe error, verbatim. */
  unknown?: string;
  /** The engine is installing THIS Worker on THIS Machine right now. */
  placing: boolean;
  /** The Bundle sha this Worker was placed with — what `sha256sum` on the Machine checked. */
  bundleSha?: string;
}

export interface RackMachine {
  /** `<fqn>::<name>`. Two Fleets may both hold a `kf-recon-01`. */
  key: string;
  name: string;
  life: MachineLife;
  region?: string;
  size?: string;
  priceMonthly?: number;
  created?: string;
  actors: RackActor[];
}

export interface RackFleet {
  fqn: string;
  project: string;
  stack: string;
  /** The Fleet's tag — the `kf-<tag>-NN` prefix, the DigitalOcean tag and the inventory group. Read
   *  off the checkpoint's own outputs, empty when the first converge has not written them yet. */
  tag: string;
  /** Temporal's status for the converge: `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`. */
  status?: string;
  /** `stackWorkflow`'s own word: `starting`, `running`, `done`, `compensating`. */
  phase?: string;
  /** `up`, `preview` or `destroy`. THE ONE FACT THE RUN'S HISTORY CANNOT SUPPLY — a `StackOp`
   *  travels in the child's input, which is a payload the event log never decodes. */
  op?: string;
  /** What the engine is on this second. Absent when it is between resources or already done. */
  cursor?: Cursor;
  /** A converge is in flight: this is the window in which the rack changes on its own. */
  converging: boolean;
  /** The converge ended by failing. */
  failed: boolean;
  machines: RackMachine[];
  /**
   * How many Machines this Fleet is FOR, from the checkpoint's own `machines` output.
   *
   * ABSENT DURING A FIRST CONVERGE, and that absence is honest rather than a gap. Pulumi writes stack
   * outputs when an `up` COMPLETES, while the checkpoint's resources are written as each one is
   * created — so mid-first-bring-up the boxes are appearing with no total to count them against.
   * Inventing one (from the cursor, from the highest `NN` seen so far) would put a denominator on the
   * screen that no authority stated, and it would be wrong exactly when it mattered: a converge that
   * dies after two of four Machines would report "2 of 2".
   */
  planned?: number;
  /** Sum of `priceMonthly` across the Machines that exist. 0 when nothing priced — `programs/fleet.ts`
   *  is explicit that a failed price lookup is 0 and that 0 means UNKNOWN, never free. */
  priceMonthly: number;
  /** The child's window in this run's history. */
  link?: FleetLink;
}

export interface RackInput {
  /** Every Fleet child this run started — {@link fleetStacksOf}. */
  links: readonly FleetLink[];
  /** `GET /api/infra/stacks/:fqn/state` by fqn. A stack with no entry was not read. */
  wires: Readonly<Record<string, StackStateWire | undefined>>;
  /** `GET /api/infra/ops/:fqn` by fqn. */
  ops: Readonly<Record<string, StackOpWire | undefined>>;
  /** `GET /api/pollers` — which Workers are actually polling. */
  pollers: Readonly<Record<string, PollerReading | undefined>>;
  now: number;
}

export interface Rack {
  fleets: RackFleet[];
  /** Machines that exist across every Fleet this run holds. */
  machines: number;
  /** Machines the converges asked for, when every Fleet has published its count. Absent when any of
   *  them has not — a partial total is a wrong total. */
  planned?: number;
  /** Sum of `priceMonthly` across every Machine that exists and priced. */
  priceMonthly: number;
  /** At least one converge is in flight — the window in which this changes on its own. */
  converging: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Every Machine this run stood up, and what is on each.
 *
 * ── ONE FLEET PER (fqn, execId), IN THE ORDER THE RUN STARTED THEM ──────────────────────────────
 *
 * The links decide the order and the membership; the checkpoint only fills them in. A stack on the
 * volume that this run did not start does not appear, however interesting it is — a run's rack must
 * describe what the run is spending and nothing else.
 *
 * ── A MACHINE IS PLANNED UNTIL THE CHECKPOINT HOLDS IT ──────────────────────────────────────────
 *
 * `planned` machines are drawn from the Fleet's own `machines` output and its `tag`, using the SERVER'S
 * naming rule (`kf-<tag>-NN`, 1-based, zero-padded to two) — `programs/fleet.ts:333`. This is the one
 * place this module writes a name the server also writes, and it is guarded: a planned slot only ever
 * appears for an index the checkpoint has NOT filled, so a mismatch shows up as a box that never
 * becomes real rather than as a duplicate of one that did.
 */
/**
 * ONE ROW PER FLEET, NOT ONE PER CONVERGE — and the distinction is the bug that put this here.
 *
 * `fleetStacksOf` keys on `(fqn, execId)` deliberately: a new `stackWorkflow` execution is what tells
 * the page to re-read, so the key it drives has to change when one starts. THE RACK IS A DIFFERENT
 * QUESTION. A Fleet is its fqn; a converge is an operation ON that Fleet, and a Run performs at least
 * two of them — one to bring the Machines up, one to destroy them.
 *
 * Mapping links straight to rows therefore drew ONE Fleet TWICE, and because every row reads
 * `wires[link.fqn]` and `ops[link.fqn]` — both keyed by fqn alone — the two rows were not even
 * different views of the two converges. They were the SAME checkpoint and the SAME current op,
 * rendered twice. MEASURED on canary-1790686685, whose input asked for ONE machine:
 *
 *   Infrastructure  CONVERGING          2 of 2 machines
 *   c-1790686685  tearing down   9.2s
 *   c-1790686685  tearing down  21.6s      <- same fleet, same machine kf-c-1790686685-01
 *
 * So the operator was told they had two Machines when they had asked for and received one, and both
 * rows claimed to be tearing down because both were reading the destroy converge's op. An
 * infrastructure panel that overstates the machine count is the one kind of wrong this panel must
 * never be: it is what somebody checks to find out what they are paying for.
 *
 * THE LAST LINK WINS, not the first. Later means the more recent converge, which is the one whose
 * cursor and status describe what the Fleet is doing NOW. First-seen order is preserved so the
 * Fleets stay in the order the Run started them.
 */
function oneFleetPerFqn(links: readonly FleetLink[]): FleetLink[] {
  const order: string[] = [];
  const latest = new Map<string, FleetLink>();
  for (const l of links) {
    if (!latest.has(l.fqn)) order.push(l.fqn);
    latest.set(l.fqn, l);
  }
  return order.map((fqn) => latest.get(fqn)!);
}

export function deriveRack(input: RackInput): Rack {
  const { links: allLinks, wires, ops, pollers, now } = input;
  const links = oneFleetPerFqn(allLinks);

  // ONE CALL, ALL STACKS. `deriveMachines` needs every Machine name across the whole input to decide
  // whether a poller is attributable; feeding it one stack at a time would put a Fleet's own Workers
  // in the unattributed bucket for the stacks that were not in front of it.
  const present = links.filter((l) => wires[l.fqn] !== undefined);
  const view = deriveMachines({
    stacks: present.map((l) => narrowStack(l.fqn, wires[l.fqn] ?? {})),
    assignments: [],
    pollers,
    now,
  });
  const rows = new Map([...view.fleets, ...view.control].map((s) => [s.fqn, s]));

  const fleets: RackFleet[] = links.map((link) => {
    const wire = wires[link.fqn];
    const row = rows.get(link.fqn);
    const op = ops[link.fqn];
    const outputs = wire?.outputs ?? {};
    const cursor = cursorOf(op);

    const status = str(op?.status);
    const phase = str((op?.progress ?? {})['phase']);
    const opName = str((op?.progress ?? {})['op']);
    // CONVERGING IS TEMPORAL'S WORD, NOT THE PHASE'S. A `stackWorkflow` whose worker died reports
    // `phase: running` for ever — that is a stored value in a workflow that is not moving — while
    // `status` comes from `describe` and turns to FAILED or TIMED_OUT. Reading the phase alone is how
    // a wedged converge draws as a live one.
    const converging = status === 'RUNNING' || (status === '' && !link.closed && wire !== undefined);
    const tag = str(outputs['tag']);
    const planned = count(outputs['machines']);

    const machines: RackMachine[] = (row?.machines ?? []).map((m) =>
      rackMachine(link.fqn, m, { cursor, opName, status })
    );
    const held = new Set(machines.map((m) => m.name));

    /**
     * ═══ THE MACHINES THE CHECKPOINT DOES NOT HOLD ═══
     *
     * Two sources, and they are needed for different halves of a bring-up:
     *
     *   • THE SLOTS THE FLEET ASKED FOR — `planned` names them by the server's own rule, so a Fleet
     *     of four draws four boxes from the first second. Only available once an `up` has COMPLETED
     *     and written its outputs, which means never during a first converge.
     *   • THE ONE THE ENGINE'S CURSOR NAMES. Pulumi writes a resource into the checkpoint AFTER the
     *     provider has made it, so the Machine being created is in no checkpoint and, on a first
     *     converge, in no `planned` list either. This was the gap: `creating` could not appear at
     *     all until a Fleet had converged once, so the most eventful minute of the very run somebody
     *     is watching — the first one — drew two static boxes and nothing else.
     *
     * Both can only ADD a box, and neither can add one the checkpoint already holds.
     */
    const extra = new Map<string, MachineLife>();
    if (planned !== undefined && tag !== '') {
      for (let i = 1; i <= planned; i += 1) {
        // `gone` once the converge is over: a Machine the Fleet is for, that the checkpoint does
        // not hold, and that nothing is building, is one that was destroyed or never made.
        extra.set(`kf-${tag}-${String(i).padStart(2, '0')}`, converging ? 'planned' : 'gone');
      }
    }
    if (cursor?.machine !== undefined && cursor.actor === undefined) {
      extra.set(cursor.machine, cursor.op === 'delete' || opName === 'destroy' ? 'destroying' : 'creating');
    }
    for (const [name, life] of extra) {
      if (held.has(name)) continue;
      machines.push({ key: `${link.fqn}::${name}`, name, life, actors: [] });
    }
    machines.sort((a, b) => a.name.localeCompare(b.name));

    return {
      fqn: link.fqn,
      project: row?.project ?? link.fqn.split('/')[0] ?? '',
      stack: row?.stack ?? link.fqn.split('/')[1] ?? '',
      tag,
      ...(status === '' ? {} : { status }),
      ...(phase === '' ? {} : { phase }),
      ...(opName === '' ? {} : { op: opName }),
      ...(cursor === undefined ? {} : { cursor }),
      converging,
      failed: link.failed || status === 'FAILED' || status === 'TIMED_OUT',
      machines,
      ...(planned === undefined ? {} : { planned }),
      priceMonthly: row?.priceMonthly ?? 0,
      link,
    };
  });

  const planned = fleets.every((f) => f.planned !== undefined)
    ? fleets.reduce((n, f) => n + (f.planned ?? 0), 0)
    : undefined;

  return {
    fleets,
    machines: fleets.reduce((n, f) => n + f.machines.filter((m) => machineExists(m.life)).length, 0),
    ...(planned === undefined ? {} : { planned }),
    priceMonthly: fleets.reduce((n, f) => n + f.priceMonthly, 0),
    converging: fleets.some((f) => f.converging),
  };
}

/** One Machine the checkpoint holds, with the engine's cursor folded in. */
function rackMachine(
  fqn: string,
  m: MachineRow,
  ctx: { cursor?: Cursor; opName: string; status: string }
): RackMachine {
  const onMe = ctx.cursor?.machine === m.name;
  // `delete` beats the operation name: a `destroy` converge is not the only way a Machine is deleted —
  // a replacement is a delete inside an `up` — and what the engine says it is doing to THIS resource
  // is more specific than what the workflow says it is doing to the stack.
  const tearing = onMe && (ctx.cursor?.op === 'delete' || ctx.opName === 'destroy');

  return {
    key: `${fqn}::${m.name}`,
    name: m.name,
    life: tearing ? 'destroying' : onMe && ctx.cursor?.actor === undefined ? 'creating' : 'up',
    ...(m.region === undefined ? {} : { region: m.region }),
    ...(m.size === undefined ? {} : { size: m.size }),
    ...(m.priceMonthly === undefined ? {} : { priceMonthly: m.priceMonthly }),
    ...(m.created === undefined ? {} : { created: m.created }),
    actors: m.serving.map((s) => ({
      key: `${m.name}::${s.title}`,
      name: s.title,
      version: s.version,
      state: s.state,
      ...(s.unknown === undefined ? {} : { unknown: s.unknown }),
      // The engine is running THIS Machine's install Command for THIS Actor. That is the window in
      // which `nothing polling` is the expected answer rather than a problem, and saying so is the
      // difference between a rack that looks broken for four minutes and one that looks busy.
      placing: ctx.cursor?.machine === m.name && ctx.cursor?.actor === s.title,
      ...(s.bundleSha === undefined ? {} : { bundleSha: s.bundleSha }),
    })),
  };
}
