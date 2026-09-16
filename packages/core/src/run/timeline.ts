/**
 * A Run's history, laid out against time.
 *
 * ── WHY A TIMELINE AND NOT A PROGRESS BAR ───────────────────────────────────────────────────────
 *
 * A percentage answers "how far", which is the least interesting question about a Run. It cannot
 * show that a dispatch started four seconds after its neighbour, that one activity is taking six
 * times as long as the rest, or that the failure happened early and everything after it was wasted.
 * Laid out against time, all three are one glance.
 *
 * ── A BAR IS AN EVENT THAT CLOSES SOMETHING ─────────────────────────────────────────────────────
 *
 * `RunEvent.dur` is "seconds this event closes, when it closes something" — so a completion carries
 * the span of the thing it completed, and its start is `t - dur`. That is the whole derivation.
 * Nothing here reconstructs pairs by scanning for a matching `Scheduled`, because the server has
 * already done it and a second reconstruction is a second set of edge cases.
 *
 * Events with `dur === 0` are MOMENTS — a signal, a marker, the run starting. They are ticks on the
 * axis, not bars, and drawing them as one-pixel bars would make a timer fired at t=3 look like work.
 *
 * ── LANES ARE THE THING, NOT THE CATEGORY ───────────────────────────────────────────────────────
 *
 * Grouping by `cat` gives four lanes for any run, which tells you nothing about a run with forty
 * dispatches. Grouping by what the event is ABOUT — the linked workflow where there is one, the
 * subject of the detail otherwise — gives one lane per dispatch, which is the shape a person is
 * looking for when they ask why a run is slow.
 */
import type { RunEvent } from './api';

/** One span on the chart: something that started, and either ended or has not yet. */
export interface Bar {
  /** The event that closed it, for a drill-down. */
  id: number;
  /** Seconds from the run's first event. */
  start: number;
  end: number;
  cat: RunEvent['cat'];
  label: string;
  attempt: number;
  failed: boolean;
  /** Still running at the time this was rendered — drawn open-ended rather than to `end`. */
  open: boolean;
}

/** A row of the chart. */
export interface Lane {
  key: string;
  label: string;
  bars: Bar[];
}

/** A moment with no duration: drawn on the axis, never as a bar. */
export interface Moment {
  id: number;
  t: number;
  type: string;
  label: string;
  failed: boolean;
}

export interface Timeline {
  lanes: Lane[];
  moments: Moment[];
  /** Seconds. The axis, with the open bars taken into account. */
  span: number;
  /** Bars still open when this was built. The number worth a colour. */
  running: number;
  failed: number;
}

/** Categories that are WORK. A timer or a marker has a time but is not a thing being done. */
const WORK = new Set<RunEvent['cat']>(['activity', 'child']);

/**
 * What a row is about.
 *
 * The linked workflow id where there is one — that is exactly the set of rows that are navigable,
 * so it is also the set a person already thinks of as a thing. Otherwise the detail's subject: the
 * part before the first separator, which for a dispatch is the actor and node.
 */
function laneKey(e: RunEvent): string {
  if (e.link?.workflowId) return e.link.workflowId;
  const subject = (e.summary || e.detail || e.type).split(/\s+[·—|]\s+|\s{2,}/)[0] ?? '';
  return subject.trim() || e.cat;
}

export function buildTimeline(events: readonly RunEvent[], nowSeconds?: number): Timeline {
  const lanes = new Map<string, Lane>();
  const moments: Moment[] = [];
  let failed = 0;
  let running = 0;
  let maxT = 0;

  for (const e of events) {
    maxT = Math.max(maxT, e.t);
    const isFailure = e.cat === 'failure' || /Failed|TimedOut|Terminated|Cancel/i.test(e.type);

    if (e.dur > 0 && WORK.has(e.cat)) {
      const key = laneKey(e);
      const lane = lanes.get(key) ?? { key, label: key, bars: [] };
      lane.bars.push({
        id: e.id,
        // CLAMPED AT ZERO. A `dur` longer than `t` means the thing began before the first event in
        // this log — an archived history that starts mid-run — and a negative start would draw off
        // the left edge rather than saying so.
        start: Math.max(0, e.t - e.dur),
        end: e.t,
        cat: e.cat,
        label: e.summary || e.detail || e.type,
        attempt: e.attempt,
        failed: isFailure,
        open: false,
      });
      lanes.set(key, lane);
      if (isFailure) failed += 1;
      continue;
    }

    if (isFailure) failed += 1;
    moments.push({
      id: e.id,
      t: e.t,
      type: e.type,
      label: e.summary || e.detail || e.type,
      failed: isFailure,
    });
  }

  // OPEN WORK: something scheduled or started that nothing closed. Derived by subtraction rather
  // than by tracking state, because the log is the authority and a bar with no closing event is
  // exactly "still going" — which is the row a person opening this page is looking for.
  const closed = new Set<string>();
  for (const lane of lanes.values()) for (const b of lane.bars) closed.add(`${lane.key}:${b.attempt}`);
  const now = nowSeconds ?? maxT;
  for (const e of events) {
    if (!WORK.has(e.cat) || e.dur > 0) continue;
    if (!/Scheduled|Started/i.test(e.type)) continue;
    const key = laneKey(e);
    if (closed.has(`${key}:${e.attempt}`)) continue;
    const lane = lanes.get(key) ?? { key, label: key, bars: [] };
    lane.bars.push({
      id: e.id,
      start: e.t,
      end: Math.max(e.t, now),
      cat: e.cat,
      label: e.summary || e.detail || e.type,
      attempt: e.attempt,
      failed: false,
      open: true,
    });
    lanes.set(key, lane);
    running += 1;
    closed.add(`${key}:${e.attempt}`);
  }

  for (const lane of lanes.values()) {
    lane.bars.sort((a, b) => a.start - b.start);
    maxT = Math.max(maxT, ...lane.bars.map((b) => b.end));
  }

  return {
    // OLDEST FIRST, by when the lane's work began. A chart sorted by name buries the dispatch that
    // started late, which is the one being looked for.
    lanes: [...lanes.values()].sort((a, b) => (a.bars[0]?.start ?? 0) - (b.bars[0]?.start ?? 0)),
    moments,
    span: Math.max(maxT, 1),
    running,
    failed,
  };
}

/** Seconds, for an axis label. Short enough to sit under a gridline. */
export function short(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${Math.round(seconds % 60)}s`;
}
