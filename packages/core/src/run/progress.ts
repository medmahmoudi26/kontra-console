/**
 * A run's progress streams — one per TOPIC, each shaped by the publisher that owns it.
 *
 * ── WHY THIS IS NOT `logstream.ts` ──────────────────────────────────────────────────────────────
 *
 * That module carries LINES: prose a human reads afterwards, oldest-first, coloured by who wrote
 * it. This carries STATE a machine draws now. A pane cannot recover "12 of 26" from the sentence
 * `crawl: page 12/26` without a regex that breaks the moment somebody rewords the log line — and
 * rewording a log line is not supposed to be a breaking change.
 *
 * ── ONE TOPIC PER PUBLISHER, AND THE FRAMEWORK OWNS ALMOST NOTHING ──────────────────────────────
 *
 * A Method publishes on `<actor>/<method>` — `webcrawl/crawl`, `canary/tick` — and declares the
 * SHAPE it publishes with `@actor.method(streams=…)`, which travels in the actor's catalog entry
 * beside `input` and `output`. A workflow publishes its own on `progress`. So a console groups a
 * run's streams without being told what any of the actors are, and renders each against the schema
 * its owner declared.
 *
 * This model therefore reserves only what is domain-free: `at` (what is being worked on) and
 * `done`/`total` (a bar). `program` briefly lived here and should not have — that is one
 * workspace's vocabulary in everybody's framework, and it made a registry monitor or a subreddit
 * scrape either lie or go undescribed. Everything else is the author's, carried verbatim.
 *
 * ── THE ETA IS DERIVED, NOT PUBLISHED ───────────────────────────────────────────────────────────
 *
 * `done`, `total` and the wall clock are enough. A publisher that computed it would bake one
 * consumer's smoothing policy into every consumer's data.
 */

/** One record off `/api/runs/:runId/progress-stream`, as the publisher sent it. */
export interface ProgressEvent {
  offset: number;
  topic: string;
  data: Record<string, unknown>;
}

/** What one worker is on. `seenAt` is OUR clock, because the record carries no timestamp. */
export interface NodeState {
  node: string;
  at: string;
  actor: string;
  seenAt: number;
}

/** Keys the framework positions itself. Everything else falls through to `fields`. */
export const RESERVED = new Set(['at', 'done', 'total']);
/** Keys the ENGINE adds for routing. They belong in the worker roster, not in a labelled value. */
export const PLUMBING = new Set(['node', 'actor']);

/** The topic a workflow publishes its own progress on, as opposed to `<actor>/<method>`. */
export const WORKFLOW_TOPIC = 'progress';

/** One stream: everything seen on a single topic. */
export interface TopicState {
  topic: string;
  /** `<actor>` of `<actor>/<method>`, or '' for a workflow's own topic. */
  actor: string;
  /** `<method>` of `<actor>/<method>`, or '' for a workflow's own topic. */
  method: string;
  at: string;
  done: number;
  total: number;
  /** Whatever the publisher declared that is neither reserved nor plumbing. */
  fields: Record<string, unknown>;
  /** Per worker, for a topic several nodes publish on. */
  nodes: Record<string, NodeState>;
  /** Our clock at the last record — so a quiet stream can be SAID to be quiet. */
  seenAt: number;
  /** How many records this topic has carried. */
  count: number;
}

export interface RunProgress {
  topics: Record<string, TopicState>;
  offset: number;
  /** When the first record was applied — the base for every rate. */
  startedAt: number;
}

export function emptyProgress(now: number): RunProgress {
  return { topics: {}, offset: -1, startedAt: now };
}

/**
 * Split `<actor>/<method>` into its halves.
 *
 * A topic with no slash is a workflow's own — a workflow is not an actor and has no method, and
 * saying so with empty strings keeps one shape for both rather than a union every caller unpacks.
 */
export function splitTopic(topic: string): { actor: string; method: string } {
  const slash = topic.indexOf('/');
  if (slash <= 0) return { actor: '', method: '' };
  return { actor: topic.slice(0, slash), method: topic.slice(slash + 1) };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function emptyTopic(topic: string, now: number): TopicState {
  const { actor, method } = splitTopic(topic);
  return {
    topic,
    actor,
    method,
    at: '',
    done: 0,
    total: 0,
    fields: {},
    nodes: {},
    seenAt: now,
    count: 0,
  };
}

/**
 * Fold one record into its topic.
 *
 * A FIELD THE RECORD DOES NOT CARRY MUST NOT RESET THE ONE WE HAVE. Publishers name a slow-moving
 * field once and omit it after; a naive `{...prev, ...record}` reads the absent value as undefined
 * and blanks the card on the very next record. Hence `num(v, prev)` and a merged `fields`.
 */
export function applyEvent(prev: RunProgress, ev: ProgressEvent, now: number): RunProgress {
  const d = ev.data ?? {};
  const topic = ev.topic || WORKFLOW_TOPIC;
  const cur = prev.topics[topic] ?? emptyTopic(topic, now);

  const next: TopicState = {
    ...cur,
    seenAt: now,
    count: cur.count + 1,
    at: str(d.at) || cur.at,
    done: num(d.done, cur.done),
    total: num(d.total, cur.total),
  };

  // WHICH WORKER SPOKE. A topic is one KIND of work and may have many speakers — six crawlers
  // doing the same job are one stream with six voices, not six streams — so the node is tracked
  // inside the topic rather than splitting it.
  const node = str(d.node);
  if (node) {
    next.nodes = {
      ...cur.nodes,
      [node]: { node, at: str(d.at), actor: str(d.actor), seenAt: now },
    };
  }

  const fields: Record<string, unknown> = { ...cur.fields };
  for (const [k, v] of Object.entries(d)) {
    if (RESERVED.has(k) || PLUMBING.has(k)) continue;
    fields[k] = v;
  }
  next.fields = fields;

  return {
    ...prev,
    offset: Math.max(prev.offset, ev.offset),
    topics: { ...prev.topics, [topic]: next },
  };
}

/**
 * Topics in a stable order: the workflow's own first, then alphabetical.
 *
 * The workflow leads because it is the only one that knows the whole run — its denominator is the
 * run's, an actor's is one Batch's. A section that reorders itself because a later record happened
 * to arrive first is a section nobody can read.
 */
export function topicsOf(p: RunProgress): TopicState[] {
  return Object.values(p.topics).sort((a, b) => {
    if (a.topic === WORKFLOW_TOPIC) return -1;
    if (b.topic === WORKFLOW_TOPIC) return 1;
    return a.topic.localeCompare(b.topic);
  });
}

/**
 * How long a worker may be silent before the pane stops claiming it is "on" something.
 *
 * WIDE ENOUGH FOR A SLOW UNIT. This was 7s — three missed 2-second beats — which is right for a
 * POLLED beat and wrong for `stream()`: an author publishes once per unit, so a unit taking 16
 * seconds emptied the roster between records and the pane said "no worker has beaten" about a
 * worker that was working. A publish-driven stream has no fixed interval, so the cutoff must be
 * generous enough for a slow unit while still clearing a dead worker.
 */
export const STALE_AFTER_MS = 45_000;

export function liveNodes(t: TopicState, now: number, staleAfter = STALE_AFTER_MS): NodeState[] {
  return Object.values(t.nodes)
    .filter((n) => now - n.seenAt <= staleAfter)
    .sort((a, b) => a.node.localeCompare(b.node));
}

export interface Eta {
  /** Units per second, or null when there is not yet enough to divide by. */
  rate: number | null;
  remainingMs: number | null;
}

/**
 * Time remaining for one topic, or an honest null.
 *
 * NULL UNTIL THE SECOND UNIT LANDS, deliberately. A rate from one sample has an error bar the size
 * of the estimate, and the first unit is the least representative there is — it carries the session
 * load, the browser launch, the handshakes the rest reuse. "4h 12m" that becomes "40s" ten seconds
 * later costs more trust than a dash.
 */
export function eta(t: TopicState, p: RunProgress, now: number): Eta {
  if (t.done < 2 || t.total <= 0 || now <= p.startedAt) return { rate: null, remainingMs: null };
  const rate = t.done / ((now - p.startedAt) / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return { rate: null, remainingMs: null };
  return { rate, remainingMs: ((t.total - t.done) / rate) * 1000 };
}

/**
 * Field order for a topic, from the schema its publisher declared.
 *
 * DECLARATION ORDER, NOT ALPHABETICAL, when a schema is known: an author lists a progress record's
 * fields in the order they want them read, and `Object.keys` over a JSON Schema's `properties`
 * preserves it. Keys the record carries that the schema does not are APPENDED rather than dropped —
 * a worker may be a version ahead of the catalog, and an unlabelled value beats no value.
 */
export function orderedFields(
  fields: Record<string, unknown>,
  schema?: Record<string, unknown>
): [string, unknown][] {
  const props = schema?.properties as Record<string, unknown> | undefined;
  if (!props) return Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const declared = Object.keys(props).filter(
    (k) => k in fields && !RESERVED.has(k) && !PLUMBING.has(k)
  );
  const extra = Object.keys(fields)
    .filter((k) => !(k in props))
    .sort((a, b) => a.localeCompare(b));
  return [...declared, ...extra].map((k) => [k, fields[k]] as [string, unknown]);
}

/**
 * How a topic's count should read: `"16/120"`, `"8"`, or null when it publishes neither.
 *
 * THE BARE `done` CASE IS THE ACTOR CASE, and dropping it lost a number that was being published.
 * The card and the bar were both gated on `total`, and an actor never sends one — deliberately: it
 * knows its Batch, not the run, and a Batch's denominator drawn as the run's is the exact bar-jump
 * the topic split exists to stop. `done` is RESERVED, so it is also excluded from `orderedFields`
 * — which meant an actor publishing `done: 8` had it swallowed at both ends and rendered nowhere.
 * MEASURED on canary-1789943482: both actor topics reported `done` on every record and neither
 * pane showed a count.
 *
 * "8" with no denominator is the honest rendering. It is not a bar — there is nothing to fill —
 * and inventing a total from the largest `done` seen would draw a progress bar that is always
 * nearly full.
 */
export function unitsOf(t: TopicState): string | null {
  if (t.total > 0) return `${t.done}/${t.total}`;
  if (t.done > 0) return `${t.done}`;
  return null;
}

/** A field's declared description, for a tooltip. Absent is absent — never invent a sentence. */
export function describeField(schema: Record<string, unknown> | undefined, key: string): string {
  const props = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  const d = props?.[key]?.description;
  return typeof d === 'string' ? d : '';
}
