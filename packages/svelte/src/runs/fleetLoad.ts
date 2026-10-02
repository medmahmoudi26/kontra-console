/**
 * The reads behind the run page's rack.
 *
 * ── THREE ROUTES, ALL OF THEM ALREADY THERE ─────────────────────────────────────────────────────
 *
 * `/api/infra/stacks/:fqn/state` is the checkpoint, `/api/infra/ops/:fqn` is the converge's live
 * heartbeat, and `/api/pollers` is what is actually polling. NOTHING NEW IS EXPOSED by this feature:
 * all three are the routes `infra/load.ts` already calls, under the same
 * `checkBearer(…, ['KONTRA_STATE_TOKEN'])` gate, reached the same way — `auth.ts` checks a CONSOLE
 * SESSION first, so a signed-in console gets in with no token in the browser and no header at any
 * call site. A route that joined them server-side and hung off `/api/runs/:id` would have had to
 * choose a posture for a payload derived from gated data, and the honest choice would have been this
 * one anyway.
 *
 * ── WHICH STACKS, FROM THE RUN'S OWN HISTORY ───────────────────────────────────────────────────
 *
 * The caller passes `FleetLink`s that `run/fleet.ts:fleetStacksOf` read off the reduced event log the
 * page had already fetched. So there is no discovery request, no second history read, and — the part
 * that matters — no way for this to draw a Fleet the run did not start.
 *
 * ── A FAILED PART IS NAMED, NOT SWALLOWED ──────────────────────────────────────────────────────
 *
 * `infra/load.ts`'s rule and its actual code: `part`, `why` and `collapse` are imported rather than
 * copied, so a 404 means the same thing on both pages. What differs is which statuses are NORMAL: a
 * 404 from `/ops` is an ordinary answer here (Temporal drops a converge on its own retention
 * schedule, and every finished run eventually has one), and so is a 404 from `/state` (a Fleet whose
 * first converge has not written a checkpoint yet). Listing either as a failed read would put a
 * warning on a page that is telling the truth.
 */
import { deriveRack, type FleetLink, type Rack, type StackOpWire } from '@kontra/console-core/run/fleet';
import type { PollerReading, StackStateWire } from '@kontra/console-core/infra/machines';

import { attempt, collapse, part, type Attempt, type Missing } from '../infra/load';

export const POLLERS_URL = '/api/pollers';

export const stateUrl = (fqn: string): string =>
  `/api/infra/stacks/${encodeURIComponent(fqn)}/state`;
export const opUrl = (fqn: string): string => `/api/infra/ops/${encodeURIComponent(fqn)}`;

/** The labels the per-stack reads collapse into, so a run holding three Fleets reports one row per
 *  WAY a read failed rather than three identical ones. `infra/load.ts:collapse` does the folding. */
const STATE_LABEL = '/api/infra/stacks/:fqn/state';
const OP_LABEL = '/api/infra/ops/:fqn';

export interface LoadedRack {
  rack: Rack;
  /** Reads that did not answer. Rendered, because a silently partial rack is a lie about what this
   *  run is running — and, for a Fleet, about what it is spending. */
  missing: readonly Missing[];
}

/**
 * Read every Fleet this run started, once.
 *
 * NO TIMER IN HERE. When this is re-read is the caller's decision and it is made where the run's
 * own liveness is known — see `Runs.svelte`. A loader that scheduled itself would keep reading after
 * the reader navigated away, which is the shape of the bug `Runs.svelte:refresh` guards against with
 * `openRun === id` on every write.
 */
export async function loadRack(
  links: readonly FleetLink[],
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<LoadedRack> {
  const attempts: Attempt[] = [];
  const g = <T,>(url: string, fallback: T, normal?: readonly number[], label?: string) =>
    part<T>(url, fallback, attempts, fetchImpl, normal, label);

  // The fqns, deduplicated. A run that brings a Fleet up and tears it down again has TWO links on
  // one fqn (they differ by execId), and the checkpoint and the op are per STACK — reading them
  // twice would be two identical requests and, on the op route, two chances to disagree.
  const fqns = [...new Set(links.map((l) => l.fqn))];

  const [states, ops, pollers] = await Promise.all([
    /**
     * THE CHECKPOINT READ REPORTS WHETHER IT FAILED, and that is not the same question as what it
     * answered. A 404 is `{}` and so is a read that never got a response, and `narrowStack` folds
     * both to a Fleet with no Machines — but "this Fleet's first converge has not written a
     * checkpoint yet" and "we could not ask" are different facts, and `deriveRack` keys off whether
     * the fqn has an entry AT ALL. So the failed ones are dropped rather than passed on as empty:
     * the rack then draws the Fleet from its link alone, with no Machines and no claim about them.
     */
    Promise.all(
      fqns.map(async (fqn) => {
        const got = await attempt<StackStateWire>(stateUrl(fqn), {}, attempts, fetchImpl, STATE_LABEL, [404]);
        return [fqn, got] as const;
      })
    ),
    Promise.all(
      fqns.map(async (fqn) => [fqn, await g<StackOpWire>(opUrl(fqn), {}, [404], OP_LABEL)] as const)
    ),
    g<Record<string, PollerReading>>(POLLERS_URL, {}),
  ]);

  const wires = Object.fromEntries(
    states.filter(([, got]) => !got.failed).map(([fqn, got]) => [fqn, got.value])
  );

  return {
    rack: deriveRack({ links, wires, ops: Object.fromEntries(ops), pollers, now }),
    missing: collapse(attempts),
  };
}
