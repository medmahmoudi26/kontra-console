/**
 * Everything `deriveMachines` needs, fetched once and assembled.
 *
 * ── FOUR ENDPOINTS, ONE VIEW, AND NO ENDPOINT ANSWERS IT ─────────────────────────────────────────
 *
 * The same shape as `catalog/load.ts` and for the same reason: the page is a JOIN across what Pulumi
 * converged, what Temporal is serving, and which queues this control plane's own roles poll. Adding a
 * `/api/infra/machines` that did the join on the server would move the derivation out of
 * `@kontra/console-core`, where it has a test (`infra/machines.test.ts`).
 *
 * ── A FAILED PART IS NAMED, NOT SWALLOWED ────────────────────────────────────────────────────────
 *
 * Every part degrades to its empty value and the URL goes in {@link Loaded.missing} with WHY. This is
 * not tidiness: `routes/pollers.ts` records that three call sites 404ed on `/api/pollers` and fell
 * back to `{}`, and because an absent report is indistinguishable from an unreachable cluster, "every
 * actor on the page rendered 'UNKNOWN / the cluster could not be asked' while its worker was polling
 * happily." `machines.ts` keeps `unknown` apart from `nothing-polling` precisely so that an absent
 * part reads as "we could not ask" — and this list is what tells the reader WHICH ask failed.
 *
 * THREE OF THE SEVEN READS HAVE NO ROUTE BEHIND THEM YET, which is why {@link collapse} exists: one
 * missing route produces one row per stack, and twenty rows all saying "this control plane does not
 * serve that route" bury the other two that say something else.
 *
 * ── THESE ARE THE FIRST BROWSER CLIENTS OF `/api/infra/*` ────────────────────────────────────────
 *
 * Nothing in this console called any of them before. They are gated — `infraRoutes.ts:54` runs
 * `checkBearer(…, ['KONTRA_STATE_TOKEN'])`, fail-closed — but `auth.ts:58-82` checks a CONSOLE SESSION
 * FIRST ("A CONSOLE SESSION ADMITS EVERYTHING THE CONSOLE DOES"), so a signed-in console reaches them
 * through the `session.ts` fetch wrapper with no token in the browser and no header at any call site.
 * A 503 here means the opposite: no session AND no `KONTRA_STATE_TOKEN` configured, which
 * {@link why} says in words rather than as a number. The two routes below that do not exist yet are
 * specified under the SAME prefix on purpose: they inherit that check rather than inventing a second.
 *
 * ── NO INTERVAL ──────────────────────────────────────────────────────────────────────────────────
 *
 * One read on mount and one on the reader's own click. `scripts/no-polling.mjs` fails the build on
 * `setInterval`, and there is no stream to ride here: `EventSource` cannot send a bearer and does not
 * go through the wrapped `fetch` (`core/run/logstream.ts:17-23`), so a gated route cannot be
 * subscribed to at all. A "re-read" button is the honest shape for a page whose facts change when
 * somebody converges something.
 */
import type { ConvergeWire } from '@kontra/console-core/infra/history';
import { imageKey, type ResolvedImage } from '@kontra/console-core/infra/drift';
import {
  deriveMachines,
  narrowStack,
  type MachineView,
  type PollerReading,
  type QueueAssignmentReading,
  type StackReading,
  type StackStateWire,
} from '@kontra/console-core/infra/machines';

/**
 * WHICH QUEUES THIS CONTROL PLANE'S ROLES POLL — the one read this page needs that does not exist yet.
 *
 * `roles.ts:queueAssignments(roles)` is the single authority and it has NO HTTP route: its only
 * non-test caller is the boot log (`main.ts:190`). The row shape below is that function's return type
 * verbatim — `{role, purpose, queue, variable}` — plus `KONTRA_DATASET_SLOTS`, which ADR 0052 §6 wants
 * beside the poll state rather than buried in an env dump.
 *
 * UNTIL THE ROUTE EXISTS THIS 404s AND THE CONTROL-STACK QUEUES DRAW NOTHING, which is the correct
 * failure: a hardcoded list would have shipped a page showing `kontra-materializer`, a queue removed
 * on 2026-09-26 as uncalled — measured at an add rate and a dispatch rate of exactly zero. The page
 * says it could not ask instead of answering from memory.
 */
export const ROLES_URL = '/api/infra/roles';

/**
 * ONE STACK'S CONVERGE RECORDS — issue 13's route, and it does not exist yet either.
 *
 * `infra/state.ts` reads `.pulumi/stacks/<project>/<stack>.json` and stops. The records beside it,
 * `.pulumi/history/<project>/<stack>/*.history.json`, are read by nothing in the orchestrator — 112 of
 * them sat unread on the live volume when this was written. Issue 13 says "Expose it on the read-only
 * infra API", so this is spelled as a sibling of `/state` and `/leases`, which is where
 * `registerInfraRoutes` puts a per-stack read.
 *
 * A 404 HERE IS NOT WHAT A 404 ON `/state` MEANS, and the difference decides whether the reader sees a
 * warning. `readStack` answers 404 for a stack that was never converged and `infra/state.ts:18` calls
 * that "a normal answer", so this loader lists it as normal. Issue 13's own acceptance criterion is
 * that a never-converged stack returns AN EMPTY LIST, not an error — so a 404 from this route can only
 * mean the route is not served, and it is reported.
 */
export const historyUrl = (fqn: string): string =>
  `/api/infra/stacks/${encodeURIComponent(fqn)}/history`;

/**
 * WHAT A TAG RESOLVES TO NOW — the read nothing in the system offers, in any form.
 *
 * ── WHY THE BROWSER NAMES THE ACTOR AND THE SERVER NAMES THE REGISTRY ───────────────────────────
 *
 * The obvious spelling — `?ref=<repo>:<tag>` — makes the orchestrator fetch a URL the browser chose,
 * which is a request-forgery surface on a process that holds `DIGITALOCEAN_TOKEN` and the cluster's
 * SSH key. So the query carries only `actor` and `version`, which is what the console read out of the
 * checkpoint, and the registry comes from the server's own `KONTRA_REGISTRY`. That is also the exact
 * signature of the function the route would wrap: `activities/fleet.ts:resolveWorkerImage(registry,
 * actor, version)`, whose three fallback bases (`registryBase`, `host.docker.internal`, `registry`)
 * are knowledge the browser has no way to hold.
 *
 * ── AND WHY IT ANSWERS AN IMAGE REF RATHER THAN A BARE DIGEST ───────────────────────────────────
 *
 * Because that function already returns `<advertised>/<actor>@sha256:<hex>`, or `''` when every base
 * failed. Keeping its return value verbatim makes the route a three-line wrapper and keeps the
 * soft-failure contract intact: `''` means "the registry could not be reached", which
 * `infra/drift.ts` renders as `unknown` and never as drift.
 */
export const resolveUrl = (actor: string, version: string): string =>
  `/api/infra/registry/resolve?actor=${encodeURIComponent(actor)}&version=${encodeURIComponent(version)}`;

/** The label the two routes above share in {@link Loaded.missing} when every stack 404s on them. */
const HISTORY_LABEL = '/api/infra/stacks/:fqn/history';
const RESOLVE_LABEL = '/api/infra/registry/resolve';

/** What a Worker's drift line says when the RESOLVE READ failed, as opposed to when the registry
 *  answered and could not reach itself. Not a status code: that number is already in `missing`. */
const RESOLVE_WHY = 'the registry could not be asked what this tag resolves to';

/** What {@link ROLES_URL} must answer. */
interface RolesWire {
  /** `resolveRoles()` — `api`, `materializer`, `infra`, or a named subset. */
  roles?: string[];
  /** `queueAssignments(roles)`. The API role appears in no row: it polls nothing. */
  assignments?: QueueAssignmentReading[];
}

/**
 * What {@link historyUrl} must answer.
 *
 * A BARE ARRAY IS TOLERATED TOO. Every other route on this API wraps its list in a named key
 * (`{stacks}`, `{leases}`, `{nodes}`), so `{records}` is the shape to expect — but the route does not
 * exist, and a console that drew nothing because the server chose the other spelling would look
 * exactly like a console whose parser was broken. `run/api.ts:fetchRunHeartbeats` unwraps its own
 * envelope the same way.
 */
interface HistoryWire {
  records?: ConvergeWire[];
}

/** What {@link resolveUrl} must answer — `resolveWorkerImage`'s return value, named. */
interface ResolveWire {
  /** `<advertised>/<actor>@sha256:<hex>`, or `''` when no registry base answered. */
  image?: string;
}

/** A read that did not answer, and what that means for somebody reading the page. */
export interface Missing {
  url: string;
  /** `0` when the request never got a response at all. */
  status: number;
  why: string;
  /** How many reads failed this way. Present only when more than one — see {@link collapse}. */
  count?: number;
}

/** One failed read, before {@link collapse} folds the repeats. Exported because `collapse` is — it is
 *  the half with an edge on it and it has its own tests. */
export interface Attempt extends Missing {
  /** The row this attempt collapses into: a route PATTERN for a per-stack read, the url otherwise. */
  label: string;
}

export interface Loaded {
  view: MachineView;
  /** Reads that did not answer. Rendered, because a silently partial page is a lie. */
  missing: readonly Missing[];
  /** `KONTRA_ORCHESTRATOR_ROLES`, as this process resolved it. Empty when unasked. */
  roles: readonly string[];
}

/**
 * Why a read failed, in words.
 *
 * THE CODES CARRY DIFFERENT FIXES and a bare `HTTP 503` sends the reader to the wrong one. 503 from
 * these routes is `auth.ts:72-77` failing CLOSED because no token is configured — not an outage; 404
 * is a control plane older than the route; 0 is the control plane being unreachable, which is the one
 * case where nothing on this page can be trusted.
 */
export function why(status: number): string {
  if (status === 0) return 'the control plane did not answer';
  if (status === 401 || status === 403) return 'this read needs a signed-in console session';
  if (status === 404) return 'this control plane does not serve that route';
  if (status === 503) {
    return 'refused: no console session, and KONTRA_STATE_TOKEN is not configured on the server';
  }
  return `HTTP ${status}`;
}

/**
 * One row per WAY a read failed, not one per read.
 *
 * A PER-STACK READ AGAINST A MISSING ROUTE FAILS ONCE PER STACK. Twenty stacks were on the live
 * volume when this was written and two of the routes this loader calls do not exist, so the
 * uncollapsed list is twenty-one identical rows and one that matters — and a warning list nobody
 * finishes reading is a warning list that does not warn. `runs.spec.ts` records the same class of
 * mistake from the other side: "That is exactly how this went unnoticed."
 *
 * GROUPED BY (label, status), NOT BY WORDS. Two different routes can both 404 and they are two
 * different missing routes; folding them together because `why(404)` returns one sentence would hide
 * one of them. A group of one keeps its concrete URL, because with a single stack the fqn is the
 * useful half.
 */
export function collapse(attempts: readonly Attempt[]): Missing[] {
  const out: Missing[] = [];
  const at = new Map<string, number>();
  for (const a of attempts) {
    const key = `${a.label} ${a.status}`;
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, out.length);
      out.push({ url: a.url, status: a.status, why: a.why });
      continue;
    }
    const row = out[seen]!;
    // The second occurrence is what turns a concrete URL into the pattern: one fqn is information,
    // twenty are noise, and the pattern is what the reader has to go and implement.
    out[seen] = { url: a.label, status: row.status, why: row.why, count: (row.count ?? 1) + 1 };
  }
  return out;
}

async function part<T>(
  url: string,
  fallback: T,
  attempts: Attempt[],
  fetchImpl: typeof fetch,
  /** Statuses that are a normal ANSWER rather than a failed read — see the one caller. */
  normal: readonly number[] = [],
  /** What this read collapses into when it is one of N. Defaults to the url, i.e. never collapses. */
  label: string = url
): Promise<T> {
  try {
    // `credentials: 'same-origin'` written explicitly at every call site in this console, and no
    // `authorization` header: `core/run/session.ts:184-201` wraps `window.fetch` once and a header
    // here would opt out of the rotation-aware wrapper (session.ts:192 keeps a caller's own header).
    const res = await fetchImpl(url, { credentials: 'same-origin' });
    if (!res.ok) {
      if (!normal.includes(res.status)) {
        attempts.push({ url, label, status: res.status, why: why(res.status) });
      }
      return fallback;
    }
    return (await res.json()) as T;
  } catch {
    attempts.push({ url, label, status: 0, why: why(0) });
    return fallback;
  }
}

/**
 * One read, and WHETHER IT FAILED — which {@link part} alone cannot tell a caller.
 *
 * ITS OWN ATTEMPT LIST, because these run concurrently. Comparing the shared list's length before and
 * after the await would see a SIBLING's failure land in between: the same shape of mistake
 * `machines.ts:pollFor` refuses when it reads a queue's freshest poll instead of a Machine's own.
 *
 * The distinction is load-bearing for both routes that do not exist yet. "The route answered and there
 * is nothing" and "the route is not there" must not produce the same value, or a missing route draws an
 * empty converge strip — this console asserting that a stack has never converged, which is false for
 * every stack on the live volume.
 */
async function attempt<T>(
  url: string,
  fallback: T,
  attempts: Attempt[],
  fetchImpl: typeof fetch,
  label: string
): Promise<{ value: T; failed: boolean }> {
  const own: Attempt[] = [];
  const value = await part<T>(url, fallback, own, fetchImpl, [], label);
  attempts.push(...own);
  return { value, failed: own.length > 0 };
}

/** Every distinct `<actor>@<version>` any Placement pinned a container image for. The only tags worth
 *  asking the registry about: a Placement with no image has no tag and no drift (`drift.ts:driftOf`). */
function pinnedTags(stacks: readonly StackReading[]): Array<{ actor: string; version: string }> {
  const seen = new Map<string, { actor: string; version: string }>();
  for (const s of stacks) {
    for (const p of s.placements) {
      if (p.workerImage === undefined || p.workerImage === '') continue;
      seen.set(imageKey(p.actor, p.version), { actor: p.actor, version: p.version });
    }
  }
  return [...seen.values()];
}

export async function loadInfra(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<Loaded> {
  const attempts: Attempt[] = [];
  const g = <T,>(url: string, fallback: T, normal?: readonly number[], label?: string) =>
    part<T>(url, fallback, attempts, fetchImpl, normal, label);

  const [listed, pollers, roles] = await Promise.all([
    g<{ stacks?: string[] }>('/api/infra/stacks', {}),
    // Every actor and workflow queue the registry knows, in one round trip. `routes/pollers.ts`:
    // "ONE ROUND TRIP, NOT N. The page knows N queues and polls; asking per queue would open a
    // describe per actor per poll against the shared Temporal connection."
    g<Record<string, PollerReading>>('/api/pollers', {}),
    g<RolesWire>(ROLES_URL, {}),
  ]);

  const fqns = (listed.stacks ?? []).filter((f) => typeof f === 'string' && f.includes('/'));
  const assignments = roles.assignments ?? [];

  const [states, historyRows, roleQueues] = await Promise.all([
    Promise.all(
      // One state read per stack, concurrently. `encodeURIComponent` because an fqn is
      // `<project>/<stack>` and the route takes it as ONE segment — `infra/dashboard.ts:109` does the
      // same, and `infraRoutes.ts:229` decodes it back.
      // A 404 IS A NORMAL ANSWER HERE, not a failed read: `infra/state.ts:18` calls `null` from
      // `readStack` "a normal answer" — the stack has never been converged. Listing it as a read that
      // failed would put a warning on a page that is telling the truth.
      fqns.map(async (fqn) => [fqn, await g<StackStateWire>(`/api/infra/stacks/${encodeURIComponent(fqn)}/state`, {}, [404])] as const)
    ),
    // One converge-record read per stack. NOT normal on 404 — see `historyUrl`: issue 13's route
    // answers an empty list for a stack that never converged, so a 404 can only be a missing route,
    // and every stack reports it under one collapsed row.
    Promise.all(
      fqns.map(async (fqn) => {
        const { value, failed } = await attempt<HistoryWire | ConvergeWire[]>(
          historyUrl(fqn),
          {},
          attempts,
          fetchImpl,
          HISTORY_LABEL
        );
        // A FAILED READ LEAVES THE STACK WITH NO ENTRY AT ALL, not with an empty list. `records` OR a
        // bare array otherwise — see {@link HistoryWire}. `machines.ts:StackRow.converges` keeps the
        // two apart: absent is "nobody asked", a strip with no ticks is "asked, never converged".
        const records = Array.isArray(value) ? value : (value.records ?? []);
        return [fqn, failed ? undefined : records] as const;
      })
    ),
    // The control stack's queues are not actor queues, so `/api/pollers` does not carry them: it
    // gathers `<actor>-<version>` and workflow queues off the registry. One describe each.
    Promise.all(
      [...new Set(assignments.map((a) => a.queue))]
        .filter((q) => q !== '' && pollers[q] === undefined)
        .map(async (q) => [q, await g<PollerReading>(`/api/queues/${encodeURIComponent(q)}/pollers`, { queue: q, error: why(0) })] as const)
    ),
  ]);

  // THE STACKS ARE NARROWED BEFORE THE LAST ROUND, because which tags to ask the registry about is a
  // fact only the checkpoints carry. One extra round trip, and the alternative is asking about every
  // actor in the catalog — including the ones no Fleet is running.
  const stacks = states.map(([fqn, wire]) => narrowStack(fqn, wire));

  const resolved = await Promise.all(
    pinnedTags(stacks).map(async (t) => {
      const { value, failed } = await attempt<ResolveWire>(
        resolveUrl(t.actor, t.version),
        {},
        attempts,
        fetchImpl,
        RESOLVE_LABEL
      );
      // A FAILED READ AND AN UNREACHABLE REGISTRY ARE BOTH `unknown`, and they are still two different
      // sentences: one is fixed on the control plane, the other in the registry. `image: ''` is
      // `resolveWorkerImage`'s own soft failure and `drift.ts` words that one; this is ours.
      const answer: ResolvedImage = failed ? { error: RESOLVE_WHY } : { image: value.image ?? '' };
      return [imageKey(t.actor, t.version), answer] as const;
    })
  );

  return {
    view: deriveMachines({
      stacks,
      assignments,
      pollers: { ...pollers, ...Object.fromEntries(roleQueues) },
      now,
      // Only the stacks whose history actually answered. A failed read is an ABSENT KEY.
      history: Object.fromEntries(historyRows.filter((r): r is readonly [string, ConvergeWire[]] => r[1] !== undefined)),
      images: Object.fromEntries(resolved),
    }),
    missing: collapse(attempts),
    roles: roles.roles ?? [],
  };
}
