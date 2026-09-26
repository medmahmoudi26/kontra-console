/**
 * The converge strip — a stack's recent life as one tick per Pulumi history record.
 *
 * ── THE RECORDS ARE ALREADY ON DISK AND NOTHING READS THEM ────────────────────────────────────────
 *
 * `control/orchestrator/src/infra/state.ts` reads `.pulumi/stacks/<project>/<stack>.json` and stops
 * there. Beside it, `.pulumi/history/<project>/<stack>/*.history.json` holds one record per converge
 * — issue 13's whole subject. MEASURED on the live volume
 * (`/var/lib/docker/volumes/kontra_pulumi-state/_data/pulumi-state/.pulumi/history`) on 2026-09-26:
 * 112 records across 20 stacks, 74 `update` and 38 `destroy`, 106 `succeeded` and 6 `failed`,
 * durations 0–46 s with a median of 13 s, and `kontra-docker-fleet/canary` alone holding 51 of them.
 * Every one carries `kind`, `startTime`, `endTime`, `result`, `config`, `version` and `message`;
 * TWO OF THE 112 CARRY NO `resourceChanges` AT ALL, which is why {@link Converge.counted} exists.
 *
 * ── `startTime` IS EPOCH **SECONDS**, AND THAT IS THE ONE BUG THIS FILE EXISTS TO NOT HAVE ────────
 *
 * The first record on that volume is `startTime: 1790186351`. Read as milliseconds that is
 * 1970-01-21; read as seconds it is 2026-09-23T17:59:11Z, which is when the converge actually ran and
 * agrees with the checkpoint's own `manifest.time`. A strip that trusted the number verbatim would
 * draw every tick fifty-six years old and label the newest converge "20976d ago" — wrong in a way
 * that still renders, which is the failure mode this repository keeps finding.
 *
 * So {@link toMs} DETECTS rather than assumes: below 1e11 the value can only be seconds (1e11 s is
 * the year 5138) and at or above it can only be milliseconds (1e11 ms is 1973). Detection rather than
 * a constant multiply because the route these records will arrive over does not exist yet — issue 13
 * owes it — and a server that normalises to milliseconds on the way out is the more correct server.
 * Both spellings must draw the same strip, and a test pins both directions.
 *
 * ── HEIGHT IS LINEAR IN DURATION, WITH A FLOOR, AND BOTH HALVES ARE DECISIONS ─────────────────────
 *
 * Linear against the longest tick IN THE VISIBLE WINDOW. The distribution above is the argument: the
 * bulk sits at 12–17 s and the interesting records are the 34 s, 35 s and 46 s ones. A square-root
 * scale (which reads prettier, because it lifts the median to half-height) shows that 3.5× outlier as
 * 1.9× — it compresses away the entire signal the strip exists to carry.
 *
 * The floor is {@link MIN_HEIGHT}, because three of the 112 records have `endTime === startTime`. A
 * proportional tick for those is zero pixels tall, and a missing tick in a row of ticks reads as
 * "nothing converged then" rather than as "that converge was instant" — an absence where there is a
 * fact. Scaling against the VISIBLE longest rather than the whole history for the same class of
 * reason: normalising to an elided outlier flattens every tick the reader can actually see against a
 * number they cannot.
 *
 * ── NOTHING HERE READS A CLOCK, A FILE OR A SOCKET ───────────────────────────────────────────────
 *
 * Same rule as `infra/machines.ts`: the records are an argument and the drawing is
 * `packages/svelte/src/infra/Infra.svelte`. A strip with a test is a fact; the strip on the screen is
 * a drawing of one.
 */

// ── WHAT ONE RECORD LOOKS LIKE ON THE WIRE ────────────────────────────────────────────────────────

/**
 * One `*.history.json`, as Pulumi's DIY backend writes it and as the route issue 13 owes must pass
 * through.
 *
 * EVERY FIELD IS OPTIONAL because this is untrusted JSON from a route that does not exist yet, and
 * `narrowStack`'s neighbour in `machines.ts` makes the same choice for the same reason: a proxy's
 * error page arriving as a 200 must produce an empty strip rather than reach `.map()` inside a render
 * (`run/api.ts:231-233`).
 *
 * `environment` and `config` are deliberately NOT declared. Pulumi redacts the environment to
 * `PULUMI_CONFIG_PASSPHRASE: 'set'` and the cloud token never appears, but a field a type does not
 * name is a field no component can print by accident — and every one of the 112 records measured has
 * `config: {}` and `message: ''`, so there is nothing there to draw.
 */
export interface ConvergeWire {
  /** `update` / `destroy` on disk today; `preview`, `refresh`, `import` and `rename` are Pulumi's
   *  other `UpdateKind`s and are accepted rather than dropped. See {@link toneOf}. */
  kind?: string;
  /** `succeeded` / `failed` on disk today. `in-progress` is Pulumi's third. */
  result?: string;
  /** Epoch SECONDS on disk. See {@link toMs} — read as milliseconds this is 1970. */
  startTime?: number;
  endTime?: number;
  /** `{create, update, delete, replace, same}`, any subset. ABSENT on 2 of 112 records measured. */
  resourceChanges?: Record<string, number>;
}

// ── THE TONE, WHICH IS WHAT THE STRIP DRAWS ───────────────────────────────────────────────────────

/**
 * What a tick is, once `kind` and `result` are read together.
 *
 * FIVE, NOT FOUR, and the extra one is `running`: Pulumi's DIY backend writes a record at completion
 * so `in-progress` is rare on disk, but the console reaches this data through a route while a
 * `stackWorkflow` may be mid-converge (`infraRoutes.ts:176` starts one), and a converge still going
 * is not a converge that succeeded.
 */
export type ConvergeTone = 'ok' | 'failed' | 'preview' | 'destroy' | 'running';

/** In the order a reader should be able to tell them apart. Data, so the legend cannot drift from
 *  the ticks — the same reason `machines.ts` exports `POLL_STATES`. */
export const CONVERGE_TONES: readonly ConvergeTone[] = ['ok', 'failed', 'preview', 'destroy', 'running'];

/**
 * `kind` + `result` → one tone, and THE PRECEDENCE IS THE DECISION.
 *
 * `failed` wins over everything, including `destroy`. A teardown that failed leaves Machines running
 * and money being spent, so folding it into the destroy tone — where a reader expects to see
 * something disappear — hides the one record on the strip that needs acting on. `running` comes next
 * because an unfinished converge has no outcome yet to colour. Then `preview`, which changed nothing
 * by definition and must never look like an update that did. Then `destroy`. Then `ok`.
 *
 * AN UNKNOWN `kind` IS `ok` RATHER THAN DROPPED — a `refresh` or an `import` did happen, and a tick
 * missing from the strip is the one thing the strip cannot say. ADR 0052 §5 makes a Fleet provider a
 * registered module, so a list of kinds this console had to be taught about is the shape that has
 * already failed here once (`secrets` in `SPA_SURFACES`).
 */
export function toneOf(kind: string, result: string): ConvergeTone {
  if (result === 'failed') return 'failed';
  if (result === 'in-progress') return 'running';
  if (kind === 'preview') return 'preview';
  if (kind === 'destroy') return 'destroy';
  return 'ok';
}

/** The word, so a tick is legible without colour — `machines.ts:stateWord`'s rule. */
export function toneWord(tone: ConvergeTone): string {
  switch (tone) {
    case 'ok':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'preview':
      return 'preview';
    case 'destroy':
      return 'destroyed';
    case 'running':
      return 'still running';
  }
}

// ── ONE CONVERGE ──────────────────────────────────────────────────────────────────────────────────

/** The five counts Pulumi keeps, defaulted to 0 so a caller never reads `undefined + 1`. */
export interface ConvergeChanges {
  create: number;
  update: number;
  delete: number;
  replace: number;
  /** Resources the converge left alone. NOT part of {@link Converge.touched}. */
  same: number;
}

export interface Converge {
  /** Stable within a strip: the index pins it even when two converges share a second, which they can
   *  — `startTime` has one-second resolution and `kontra fleet up` immediately re-places. */
  key: string;
  kind: string;
  result: string;
  tone: ConvergeTone;
  /** Epoch MILLISECONDS, whichever unit the wire used. */
  startedAt: number;
  endedAt: number;
  durationMs: number;
  changes: ConvergeChanges;
  /** create + update + delete + replace. What the converge actually did. */
  touched: number;
  /**
   * False when the record carried no `resourceChanges` at all.
   *
   * `touched === 0` AND `counted === false` ARE DIFFERENT FACTS — "this converge changed nothing" and
   * "Pulumi did not record what it changed". Two of the 112 records measured are the second, and
   * printing `0 resources` for them is the same conflation `machines.ts` refuses between `unknown`
   * and `nothing-polling`.
   */
  counted: boolean;
  /** 0–1, {@link MIN_HEIGHT} at the floor. The drawing multiplies this by its own strip height. */
  height: number;
  /** The whole record in one line, for the tick's `title`. See {@link convergeTitle}. */
  title: string;
}

/**
 * The most recent converges a strip draws, and the rest are counted rather than shown.
 *
 * 60 FITS THE NARROWEST VIEWPORT THIS CONSOLE SUPPORTS. A tick is 3px with a 1px gap (3px because
 * that is the width at which a border-style is distinguishable — `Infra.svelte` records the same
 * measurement for `double`), so 60 ticks is 240px; at 320px the card's content box is about 288px.
 * The busiest stack on the live volume holds 51 records, so nothing is elided there today — but a
 * strip that silently overflowed its card would be the horizontal-scroll failure `overflow.mjs`
 * exists to catch, and one that silently clipped would drop ticks with no count to say so.
 */
export const MAX_TICKS = 60;

/** The shortest tick that is still a tick. Three of the 112 records measured have a zero duration,
 *  and a zero-height tick reads as a gap in the strip — an absence where there is a fact. */
export const MIN_HEIGHT = 0.18;

/** One stack's strip, and everything the header beside it needs. */
export interface ConvergeStrip {
  /** OLDEST FIRST, so the strip reads left-to-right like every other timeline in this console and
   *  the newest converge is the one nearest the facts beside it. */
  ticks: readonly Converge[];
  /** Records the server sent. `ticks.length` when nothing was elided. */
  total: number;
  /** `total - ticks.length`. Drawn as `+N earlier`, never dropped silently. */
  elided: number;
  /** The duration the heights are scaled against — the longest tick SHOWN, not the longest ever. */
  longestMs: number;
  /** How many of the shown ticks failed. The number worth a word beside the strip. */
  failed: number;
  /** The newest tick. Absent only when there are none, which is a stack that never converged. */
  latest?: Converge;
}

// ── READING THE WIRE ──────────────────────────────────────────────────────────────────────────────

/**
 * Whatever epoch unit arrived, in milliseconds.
 *
 * 1e11 IS THE ONLY BOUNDARY THAT WORKS FOR BOTH. As seconds it is the year 5138; as milliseconds it
 * is 1973. So every instant this console will ever be shown — a Pulumi record from 2026 written in
 * seconds (1.79e9) or the same record normalised to milliseconds (1.79e12) — lands unambiguously on
 * one side. The header says what the alternative cost: a strip fifty-six years old that still draws.
 */
export function toMs(t: number | undefined): number {
  if (t === undefined || !Number.isFinite(t) || t <= 0) return 0;
  return t < 1e11 ? Math.round(t * 1000) : Math.round(t);
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * How long a converge took, in words.
 *
 * NOT `run/api.ts:fmtDuration`, AND THE REASON IS ON THE VOLUME. That function answers `—` for
 * anything at or below zero, and three of the 112 records measured have `endTime === startTime` — so
 * the ticks whose whole story is "this converge was instant" would read as "duration not recorded",
 * which is the one other thing a dash could mean on this strip. Pulumi's wire has one-second
 * resolution, so `under 1s` is the most the record can honestly support and `0s` would claim more.
 *
 * It is also not a second general formatter: it is only ever called on a Pulumi converge span, which
 * is why it lives beside the thing it measures rather than in `panels/chrome/format.ts`.
 */
export function convergeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'under 1s';
  const s = Math.round(ms / 1000);
  if (s === 0) return 'under 1s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The change counts as a phrase, in the order a reader cares about them.
 *
 * `same` COMES LAST AND IS NAMED `unchanged`, because it is the only count that is not something the
 * converge did. A `{replace: 1, same: 1}` record — the single most common shape on the volume, 33 of
 * 112 — means one resource was torn down and rebuilt and one was left alone; printing `2 resources`
 * would say a converge touched twice what it touched.
 */
export function changeWords(c: ConvergeChanges, counted: boolean): string {
  if (!counted) return 'changes not recorded';
  const bits: string[] = [];
  if (c.create > 0) bits.push(`${c.create} created`);
  if (c.update > 0) bits.push(`${c.update} updated`);
  if (c.replace > 0) bits.push(`${c.replace} replaced`);
  if (c.delete > 0) bits.push(`${c.delete} deleted`);
  if (c.same > 0) bits.push(`${c.same} unchanged`);
  return bits.length === 0 ? 'no resources' : bits.join(', ');
}

/**
 * Everything about one converge in one line — the tick's `title`, which is where the acceptance
 * criterion's "changes and duration on hover" lands.
 *
 * A NATIVE `title` RATHER THAN A HOVER CARD. It works on a keyboard focus walk, it is readable by a
 * screen reader, it needs no JavaScript and no `{@html}` (which `scripts/no-raw-html.mjs` bans
 * outright), and Playwright can assert it as an attribute rather than by racing a transition.
 *
 * THE INSTANT IS ISO-8601 UTC. Every other record in this system — the Manifest, the journal, the
 * lake — is UTC (`panels/widgets/format.ts:formatInstant` says so), and a Fleet spans time zones, so
 * a local-time tooltip would not correlate with the log an operator is reading beside it.
 */
export function convergeTitle(c: Omit<Converge, 'title' | 'key' | 'height'>): string {
  const when = c.startedAt > 0 ? new Date(c.startedAt).toISOString() : 'an unrecorded time';
  return [
    `${c.kind} · ${toneWord(c.tone)}`,
    convergeDuration(c.durationMs),
    changeWords(c.changes, c.counted),
    when,
  ].join(' · ');
}

/** One wire record, narrowed. Exported for the test; the strip is what a caller wants. */
export function narrowConverge(wire: ConvergeWire, index: number): Converge {
  const kind = typeof wire.kind === 'string' && wire.kind !== '' ? wire.kind : 'update';
  const result = typeof wire.result === 'string' && wire.result !== '' ? wire.result : 'succeeded';
  const startedAt = toMs(wire.startTime);
  const ended = toMs(wire.endTime);
  // A record whose end precedes its start is a clock going backwards mid-converge. Clamped to the
  // start rather than negated: a negative width is not drawable and `under 1s` is the honest reading
  // of a span we cannot measure. The strip is not the place to litigate clock skew.
  const endedAt = ended > startedAt ? ended : startedAt;
  const raw = wire.resourceChanges;
  const counted = raw !== null && typeof raw === 'object';
  const changes: ConvergeChanges = {
    create: count(raw?.['create']),
    update: count(raw?.['update']),
    delete: count(raw?.['delete']),
    replace: count(raw?.['replace']),
    same: count(raw?.['same']),
  };
  const base = {
    kind,
    result,
    tone: toneOf(kind, result),
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    changes,
    touched: changes.create + changes.update + changes.delete + changes.replace,
    counted,
  };
  return {
    // The index leads so the key is stable under re-read even where `startTime` repeats.
    key: `${index}-${startedAt}`,
    ...base,
    height: MIN_HEIGHT,
    title: convergeTitle(base),
  };
}

/**
 * Every record the server sent, as a strip.
 *
 * ORDER IS NORMALISED HERE AND NOT TRUSTED. Issue 13's acceptance criterion says the route lists
 * converges "newest-last", but the route does not exist yet and the files it will read are named by a
 * nanosecond suffix that sorts lexically rather than numerically past a digit boundary. Sorting on
 * `startedAt` means a server that answers newest-first — or that walks a directory in whatever order
 * the filesystem hands it back — still draws a strip whose left end is the oldest converge. Ties keep
 * the order the server used, so two converges inside one second stay in the sequence they arrived.
 *
 * AN EMPTY LIST IS A STRIP WITH NO TICKS, NEVER A THROW. `infra/state.ts:18` already calls a stack
 * that never converged "a normal answer", and this is the same answer one layer up: the only thing
 * the drawing does with it is not draw a strip.
 */
export function strip(records: readonly ConvergeWire[], max: number = MAX_TICKS): ConvergeStrip {
  const all = records
    .map((w, i) => ({ c: narrowConverge(w, i), i }))
    .sort((a, b) => a.c.startedAt - b.c.startedAt || a.i - b.i)
    .map(({ c }) => c);

  const limit = max > 0 ? max : all.length;
  const shown = all.length > limit ? all.slice(all.length - limit) : all;

  // Scaled against the longest tick SHOWN. See the header: normalising to an elided outlier flattens
  // every tick the reader can see against a number they cannot.
  const longestMs = shown.reduce((n, c) => Math.max(n, c.durationMs), 0);
  const ticks = shown.map((c) => ({
    ...c,
    // `longestMs === 0` is every shown converge finishing inside one second — they are all equal, so
    // they are all full height. Flooring them instead would draw a uniform strip as a uniformly
    // suspicious one.
    height: longestMs <= 0 ? 1 : MIN_HEIGHT + (1 - MIN_HEIGHT) * (c.durationMs / longestMs),
  }));

  return {
    ticks,
    total: all.length,
    elided: all.length - ticks.length,
    longestMs,
    failed: ticks.filter((c) => c.tone === 'failed').length,
    ...(ticks.length === 0 ? {} : { latest: ticks[ticks.length - 1]! }),
  };
}
