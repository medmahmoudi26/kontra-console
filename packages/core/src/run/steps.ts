/**
 * A Run's history as the STEPS it took — the reading the run page leads with.
 *
 * ── WHY THIS EXISTS BESIDE `timeline.ts` ────────────────────────────────────────────────────────
 *
 * The timeline groups events into lanes keyed on `summary || detail`, and an activity's two halves
 * disagree about both: `ActivityTaskScheduled` carries the summary somebody wrote (`hold c-1790…`)
 * and `ActivityTaskCompleted` carries none, so it falls through to the machinery
 * (`activityType=holdFleetLease`). One activity, two lanes — which is where the raw `activityType=`
 * strings on screen came from, and why a finished activity also drew a phantom open bar that never
 * closed (measured on `canary-1790194348`: three completed activities reported as `3 running`).
 *
 * The fix is not a better label. It is to stop reconstructing pairs from labels at all: a step is
 * an OPENER, an optional start, and a CLOSER, matched in order per subject. Temporal spells that
 * three ways — activity, child workflow, Nexus operation — and they are the same shape to a person
 * watching, so they are read into one type here.
 *
 * ── FIFO PER SUBJECT, AND WHY THAT IS ENOUGH ────────────────────────────────────────────────────
 *
 * Two steps with the same subject never interleave within one workflow: the workflow awaits each
 * before scheduling the next, so the oldest open one is always the one a closer refers to. Where
 * that stops being true — a workflow that fires several of the same activity concurrently — the
 * exact fix is `scheduledEventId`, which Temporal puts on every closing event and the reduction in
 * `shared/core/src/history.ts` does not yet carry. {@link buildSteps} is written so that adding it
 * is a change to {@link matchOf} and to nothing else.
 *
 * ── NOTHING HERE FETCHES, DECODES OR READS A CLOCK ──────────────────────────────────────────────
 *
 * Pure over the reduced log, like `timeline.ts` and for the same reason: every state a run page can
 * be in is assertable from literal events, with no cluster and no wall clock. `now` is passed in.
 */

import type { RunEvent } from './api';

/** What kind of thing Temporal was doing. Three spellings of "a step". */
export type StepKind = 'activity' | 'child' | 'nexus';

export type StepState = 'scheduled' | 'running' | 'done' | 'failed';

/** One thing the run did. */
export interface Step {
  kind: StepKind;
  /** The subject the opener and closer agree on — an activity type, a workflow type, an endpoint. */
  subject: string;
  /** The opening event's id, which is this step's identity for a drill-down. */
  openId: number;
  /** Temporal's summary on the OPENER, where the author wrote one. */
  summary: string;
  /** Seconds from the run's first event. */
  t0: number;
  /** When it closed, or `null` while it has not. */
  t1: number | null;
  state: StepState;
  /** The closing event's detail, when it closed badly. '' otherwise. */
  error: string;
  /** Which occurrence of this subject — 1-based. */
  seq: number;
  /** This subject happens more than once in the run, so `seq` is worth showing. */
  repeats: boolean;
  /** The workflow this step is about, where the event named one — what makes a row navigable. */
  link?: RunEvent['link'];
}

interface Frame {
  kind: StepKind;
  open: string;
  start: string;
  close: RegExp;
  subject: (e: RunEvent) => string;
}

const ACTIVITY_TYPE = /activityType=([^\s·]+)/;
const WORKFLOW_TYPE = /workflowType=([^\s·]+)/;
const ENDPOINT = /endpoint=([^\s·]+)/;

/**
 * The three shapes, and the ONE property that makes this work: for each, the opener and every
 * closer carry the same subject in their `detail`. That is what pairs them — not the label.
 */
const FRAMES: readonly Frame[] = [
  {
    kind: 'activity',
    open: 'ActivityTaskScheduled',
    start: 'ActivityTaskStarted',
    close: /^ActivityTask(Completed|Failed|TimedOut|Canceled)$/,
    subject: (e) => ACTIVITY_TYPE.exec(e.detail)?.[1] ?? '',
  },
  {
    kind: 'child',
    open: 'StartChildWorkflowExecutionInitiated',
    start: 'ChildWorkflowExecutionStarted',
    close: /^ChildWorkflowExecution(Completed|Failed|TimedOut|Canceled|Terminated)$/,
    // THE CHILD'S ID, NOT ITS TYPE — and the difference is the whole correctness of this region
    // for any workflow that fans out.
    //
    // `detail` carries only `workflowType=Surface`, which every one of a campaign's 462 crawl
    // children shares. Keyed on that, they all queue under ONE subject and `matchOf` closes them
    // FIFO — so the first completion closes the first-STARTED step whether or not that is the child
    // that actually finished. Children that run concurrently almost never finish in the order they
    // were initiated, so the rows drift apart from the truth immediately: on campaign-1790599185
    // the page drew `john_deere_bbp` and `visa` as COMPLETE while both were still running, and
    // `indrive` as in flight two and a half hours after it closed.
    //
    // `link.workflowId` is on the initiated, started AND closing events, so keying on it gives each
    // child its own queue. FIFO is then correct rather than coincidental: the only events sharing a
    // key are that one child's, including its retries, which do reuse the id and should pair in order.
    subject: (e) => e.link?.workflowId ?? WORKFLOW_TYPE.exec(e.detail)?.[1] ?? '',
  },
  {
    kind: 'nexus',
    open: 'NexusOperationScheduled',
    start: 'NexusOperationStarted',
    close: /^NexusOperation(Completed|Failed|TimedOut|Canceled)$/,
    subject: (e) => ENDPOINT.exec(e.detail)?.[1] ?? '',
  },
];

/** The open step a closing event refers to. FIFO per subject — see the header. */
function matchOf(waiting: Step[]): Step | undefined {
  return waiting[0];
}

/**
 * Read the log as steps, oldest first.
 *
 * A step with no closer is OPEN — that is the one in flight, and it is derived by not having been
 * closed rather than by scanning for a state, because the log is the authority.
 */
export function buildSteps(events: readonly RunEvent[]): Step[] {
  const waiting = new Map<string, Step[]>();
  const steps: Step[] = [];

  for (const e of events) {
    for (const f of FRAMES) {
      const subject = f.subject(e);
      // An event of this shape whose subject we cannot read pairs with nothing. Skipping it is
      // better than opening a step keyed on '' that every later closer would match.
      if (!subject) continue;
      const key = `${f.kind}:${subject}`;

      if (e.type === f.open) {
        const step: Step = {
          kind: f.kind,
          subject,
          openId: e.id,
          summary: e.summary ?? '',
          t0: e.t,
          t1: null,
          state: 'scheduled',
          error: '',
          seq: 0,
          repeats: false,
          ...(e.link ? { link: e.link } : {}),
        };
        steps.push(step);
        const q = waiting.get(key);
        if (q) q.push(step);
        else waiting.set(key, [step]);
      } else if (e.type === f.start) {
        const step = matchOf(waiting.get(key) ?? []);
        if (step) step.state = 'running';
      } else if (f.close.test(e.type)) {
        const q = waiting.get(key) ?? [];
        const step = matchOf(q);
        if (!step) continue;
        q.shift();
        step.t1 = e.t;
        step.state = e.type.endsWith('Completed') ? 'done' : 'failed';
        if (step.state === 'failed') step.error = e.detail;
      }
    }
  }

  const counts = new Map<string, number>();
  for (const s of steps) {
    const key = `${s.kind}:${s.subject}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    s.seq = n;
  }
  for (const s of steps) s.repeats = (counts.get(`${s.kind}:${s.subject}`) ?? 0) > 1;
  return steps;
}

/** Is this step still open as of the instant the caller is drawing? */
export const isOpen = (s: Step): boolean => s.t1 === null;

/**
 * What to CALL a step, in the words the docs use.
 *
 * The table is kontra's own vocabulary and covers the steps kontra's own machinery takes. Anything
 * else falls back to the activity type with its camel case broken up — still a worse label than a
 * person would write, but never `activityType=holdFleetLe…`, which is what the run page showed.
 */
const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  holdFleetLease: ['Hold the Fleet lease', 'Claims capacity so nothing else takes these Machines.'],
  dropFleetLease: [
    'Drop the Fleet lease',
    'Releases capacity. Machines nothing else holds are destroyed.',
  ],
  resolveBundle: ['Resolve the Actor bundle', 'Works out which built version of the Actor to place.'],
  convergeFleetSessions: [
    'Converge Sessions',
    'Brings Session slots on each Machine to the requested density.',
  ],
  queuePollers: [
    'Wait for a worker',
    'Checks something is polling the Actor’s queue before dispatching to it.',
  ],
  OpenSession: ['Open a Session', 'A live process on a Machine that Units are handed to.'],
  CloseSession: ['Close the Session', ''],
  publishBatch: [
    'Publish the Batch',
    'Writes the rows into the lake and records the materialization.',
  ],
};

export interface StepName {
  title: string;
  /** One sentence on what the step is for. '' where there is nothing worth saying. */
  what: string;
  /** The machine-readable subject, kept visible — the friendly view never replaces the real one. */
  sub: string;
}

export function nameStep(s: Step): StepName {
  if (s.kind === 'child') {
    // NOT EVERY CHILD IS A FLEET. These words were written when bringing a stack up was the only
    // child workflow a run started. A campaign starts one `Surface` or `Hunt` child PER PROGRAM, so
    // the fleet sentence gets repeated over every crawl on the page — eight rows all claiming to
    // bring Machines up, when one of them did that and the rest were crawling different companies.
    // The id underneath keeps them apart, but the title is what a reader actually reads.
    const type = s.link?.type ?? '';
    if (type && type !== 'stackWorkflow') {
      return {
        title: `Run ${type}`,
        what: 'A child workflow, running its own steps and reporting back to this one.',
        sub: s.link?.workflowId ?? s.subject,
      };
    }
    return {
      title: 'Bring the Fleet up',
      what: 'A whole stack — Machines, network, the Warden on each one — as one child workflow.',
      sub: s.link?.workflowId ?? s.subject,
    };
  }
  if (s.kind === 'nexus') {
    const units = /(\d+)\s+units?/.exec(s.summary)?.[1];
    const actor = /^[^\s·]+\s*·\s*([^\s·]+)/.exec(s.summary)?.[1];
    return {
      title: units ? `Sweep ${units} unit${units === '1' ? '' : 's'}` : 'Dispatch to the Actor',
      what: 'The work itself. One Unit is one target, dispatched over Nexus to a Session.',
      sub: actor ? `${actor} · ${s.subject}` : s.subject,
    };
  }
  const known = NAMES[s.subject];
  return {
    title: known ? known[0] : unCamel(s.subject),
    what: known ? known[1] : '',
    sub: s.summary || s.subject,
  };
}

function unCamel(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/* ── the failure, unwrapped ──────────────────────────────────────────────────────────────────── */

/** Who said this line. `cause` is the innermost — the one somebody wrote for a reader. */
export type Blame = 'kontra' | 'temporal' | 'cause';

export interface Cause {
  who: Blame;
  msg: string;
  /** The innermost one. Exactly one entry carries this when there is any entry at all. */
  root?: boolean;
}

/**
 * The frames Temporal glues between the sentence an author wrote and the one that actually failed.
 * Splitting on them is what lets the panel lead with the innermost line and still say honestly
 * which layer produced each part.
 */
const TEMPORAL_FRAMES: readonly RegExp[] = [
  /Child Workflow execution failed\.?/,
  /Activity task failed:?/,
  /activity ScheduleToStart timeout/,
];

/**
 * Unwrap a failure into its chain, outermost first.
 *
 * WHY THIS IS NEEDED AT ALL: a fleet failure arrives as one string four layers deep — kontra's own
 * sentence, two Temporal frames, then sixty lines of Pulumi transcript in which exactly one line
 * says what to fix (`cannot read the fleet SSH key at /root/.ssh/id_rsa (set KONTRA_SSH_KEY)`).
 * That line was reaching the browser and never being drawn: the transcript rendered the turn's
 * `because` (`state=failed`) and never touched its `error`.
 */
export function causes(raw: string): Cause[] {
  if (!raw) return [];
  const out: Cause[] = [];
  const seen = new Set<string>();
  const push = (who: Blame, text: string): void => {
    const msg = text.replace(/^[\s·:]+|[\s·:]+$/g, '').trim();
    if (msg.length < 3) return;
    const key = msg.slice(0, 90);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ who, msg });
  };

  const head = raw.split('\n')[0] ?? '';

  // kontra's own sentence: everything before the first Temporal frame, minus the event machinery
  // the reduction prefixes onto a detail.
  let lead = head;
  for (const re of TEMPORAL_FRAMES) lead = lead.split(re)[0] ?? lead;
  push('kontra', lead.replace(/^workflowType=\S+\s*·?\s*/, '').replace(/^identity=\S+\s*·?\s*/, ''));

  for (const re of TEMPORAL_FRAMES) {
    const m = re.exec(head);
    if (m) push('temporal', m[0].replace(/:$/, ''));
  }

  // The root cause: the innermost `Error:`/`error:` line that is not a stack frame. Shortest wins —
  // the long ones are the same sentence with `Unhandled exception:` bolted on the front.
  const errs: string[] = [];
  for (const line of raw.split('\n')) {
    if (/^\s+at\s/.test(line)) continue;
    const i = Math.max(line.lastIndexOf('Error: '), line.lastIndexOf('error: '));
    if (i >= 0) errs.push(line.slice(i + 7).trim());
  }
  if (errs.length) {
    errs.sort((a, b) => a.length - b.length);
    push('cause', errs[0]!);
  }

  const last = out[out.length - 1];
  if (last) last.root = true;
  return out;
}

/** The innermost line of a chain — what a one-line summary of a failure should say. */
export function rootCause(chain: readonly Cause[]): string {
  return chain.find((c) => c.root)?.msg ?? '';
}

/* ── formatting ──────────────────────────────────────────────────────────────────────────────── */

/** Seconds, short enough to sit at the end of a row. */
export function shortSeconds(s: number): string {
  if (!Number.isFinite(s)) return '—';
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  // ONE DECIMAL UP TO A MINUTE. Whole seconds drew `41s → 41s · 122ms` on every sub-second step,
  // which reads as a bar with no width rather than as a fast one.
  if (s < 60) return `${s.toFixed(1)}s`;
  // ROUNDED ONCE, THEN SPLIT. It was `Math.floor(s / 60)` and `Math.round(s % 60)` computed
  // independently, so any value in the last half-second of a minute rounded its remainder up to 60
  // while the minutes stayed put: 8219.6 s printed `136m 60s`. Observed on a Fleet's elapsed
  // readout, which ticks once a second and therefore lands on it constantly.
  const total = Math.round(s);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/**
 * When a step happened and how long it took.
 *
 * A range is noise for a step quicker than the eye — `at 41.1s · 122ms` says both facts, where
 * `41.1s → 41.1s` says neither.
 */
export function stepClock(s: Step, now: number): string {
  const end = s.t1 ?? now;
  const dur = end - s.t0;
  if (s.t1 === null) return `${shortSeconds(s.t0)} → now · ${shortSeconds(dur)}`;
  if (dur < 1) return `at ${shortSeconds(s.t0)} · ${shortSeconds(dur)}`;
  return `${shortSeconds(s.t0)} → ${shortSeconds(s.t1)} · ${shortSeconds(dur)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `23 Sep 2026 · 19:22:58` — when a run started, in local time.
 *
 * A run id carries an epoch (`canary-1790191378`) and nobody reads one at a glance, so the page
 * says the date beside the id rather than expecting it to be decoded.
 */
export function startedAtText(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '';
  const d = new Date(epochMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
