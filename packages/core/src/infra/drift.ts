/**
 * Registry drift — the digest a Placement pinned against what that tag resolves to now.
 *
 * ── THE FAILURE THIS ANSWERS IS RECORDED, NOT HYPOTHETICAL ────────────────────────────────────────
 *
 * `control/orchestrator/src/infra/programs/fleet.ts:15-17`, in the header, among the three production
 * incidents that file exists to have ported: "cloud-init installs **Docker only** — no actor image
 * and no version. Baking `cachebuster:0.2.0` into cloud-init is how this fleet silently ran stale code
 * for weeks. What runs is decided at deploy time against an immutable artifact."
 *
 * The immutable artifact is why this page can ask the question at all. `dockerFleet.ts:126` refuses a
 * placement whose `workerImage` is not `repo@sha256:<64 hex>` — "got a tag or an unpinned name" — so
 * the digest a Machine is running is ALWAYS KNOWN, exactly, from the checkpoint. What is not known is
 * whether `<actor>:<version>` still means that digest. `activities/fleet.ts:269-290`
 * (`resolveWorkerImage`) is what turned the tag into a digest at converge, and asking it again is the
 * whole of this comparison.
 *
 * ── UNREACHABLE IS `unknown`, AND IT IS NEVER `drifted` ───────────────────────────────────────────
 *
 * The acceptance criterion says it in one line — "A registry that cannot be reached renders as
 * unknown, not as drift" — and it is the same line `pollers.ts` holds for its own states and
 * `machines.ts` holds for `unknown` vs `nothing-polling`: "we could not ask" and "the answer is no"
 * are different facts about the world. A registry timeout rendered as drift sends an operator to
 * re-deploy a Fleet that is running exactly the code they think it is.
 *
 * `resolveWorkerImage` fails SOFT by design — it returns `''` after trying every base, because a
 * Fleet that refused to converge because it could not reach its registry would trade the job for the
 * accounting. So an empty answer is the COMMON case, not an exceptional one, and {@link driftOf}
 * treats absent, empty, errored and malformed identically: `unknown`, with a sentence saying which.
 *
 * ── NOTHING HERE FETCHES ──────────────────────────────────────────────────────────────────────────
 *
 * Both digests are arguments. `packages/svelte/src/infra/load.ts` does the asking and
 * `infra/Infra.svelte` does the drawing; the verdict is arithmetic with four edges on it, so it is
 * here with a test — CONTEXT.md's "Console core".
 */

/**
 * `repo@sha256:<64 hex>`, split.
 *
 * `repo` KEEPS ITS REGISTRY HOST AND PORT. `resolveWorkerImage` returns
 * `<advertised>/<actor>@sha256:<hex>` where `advertised` is `KONTRA_REGISTRY` with the scheme stripped
 * — `127.0.0.1:5000/canary@sha256:…` — and the colon in `127.0.0.1:5000` is why this is parsed by
 * splitting on the LAST `@` rather than by a naive `host:port/name:tag` pattern.
 */
export interface PinnedImage {
  repo: string;
  /** `sha256:<64 lowercase hex>`, with the algorithm prefix kept: it is part of the digest. */
  digest: string;
}

/** `sha256:<64 hex>` — `dockerFleet.ts:126`'s own test, restated because the console must reach the
 *  same verdict about the same string and there is no shared conformance corpus for it. */
const DIGEST = /^sha256:[a-f0-9]{64}$/;

/**
 * A digest-pinned image reference, or `undefined` if it is not one.
 *
 * STRICT, AND DELIBERATELY AS STRICT AS THE PROGRAM THAT REFUSES. An image that does not parse here
 * is one `dockerFleet` would not have converged, so the honest reading is not "assume a tag" — it is
 * {@link DriftState} `unpinned`, said out loud. Guessing a digest out of a tag is how a page starts
 * reporting drift it invented.
 */
export function parsePinned(ref: string): PinnedImage | undefined {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return undefined;
  const repo = ref.slice(0, at);
  const digest = ref.slice(at + 1);
  if (repo === '' || !DIGEST.test(digest)) return undefined;
  return { repo, digest };
}

/**
 * `sha256:4f2b…` — the first twelve hex, which is what `docker images` shows and what an operator
 * compares by eye.
 *
 * THE FULL DIGEST IS STILL CARRIED on {@link DriftReading}, because "flagged, naming both digests"
 * means both must be copyable. A shortened digest is for reading; the long one is for pasting into
 * `docker pull`.
 */
export function shortDigest(digest: string): string {
  const hex = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return `sha256:${hex.slice(0, 12)}`;
}

/**
 * Four answers, and the fourth is not a worse third.
 *
 * `unpinned` is its own state rather than folded into `unknown`: an unknown digest is the registry's
 * fault and there is nothing to do about it from here, while an unpinned one means the checkpoint
 * holds an image the Fleet's own program would refuse today — a different fact with a different fix.
 */
export type DriftState = 'current' | 'drifted' | 'unknown' | 'unpinned';

/** In the order a reader should be able to tell them apart. Data, so the legend cannot drift. */
export const DRIFT_STATES: readonly DriftState[] = ['current', 'drifted', 'unknown', 'unpinned'];

/** The word, so the state is legible without colour — `machines.ts:stateWord`'s rule. */
export function driftWord(state: DriftState): string {
  switch (state) {
    case 'current':
      return 'current';
    case 'drifted':
      return 'drifted';
    case 'unknown':
      return 'unknown';
    case 'unpinned':
      return 'not digest-pinned';
  }
}

/** What the registry answered for one tag, as `activities/fleet.ts:resolveWorkerImage` answers it. */
export interface ResolvedImage {
  /** `<registry>/<actor>@sha256:<hex>`. EMPTY when every registry base was tried and none answered —
   *  that function's own soft failure, which is a normal answer and not an error. */
  image?: string;
  /** Set when the read itself failed (no route, no session, no control plane). */
  error?: string;
}

export interface DriftReading {
  state: DriftState;
  /** The digest the converge pinned. Absent only when the image did not parse. */
  pinned?: string;
  /** The digest the tag resolves to NOW. Set on `drifted` and `current` and nowhere else — a state
   *  that has no second digest must not be able to print one. */
  now?: string;
  /** `127.0.0.1:5000/canary:0.1.1` — the tag that was asked about, so the sentence names a thing an
   *  operator can `docker pull`. Absent when the repo could not be read off the pinned image. */
  tag?: string;
  /** One sentence: what this state means and, on `unknown`, WHICH ask came back empty. */
  why: string;
}

/**
 * The verdict for one Worker.
 *
 * `undefined` MEANS THERE IS NOTHING TO SAY, and that is how "degrades to absent" is made structural:
 * a DigitalOcean Fleet's Placement carries no `workerImage` at all (its Workers run a Bundle the
 * Machine curls and checks with `sha256sum` — `fleet.ts:65`, "The actor runs NATIVELY"), so there is
 * no container digest and no tag to re-resolve. An absent answer draws no row rather than an empty
 * one, which is `Settings.svelte:32`'s rule for every fact on this surface.
 *
 * `version` IS TAKEN FROM THE PLACEMENT RATHER THAN PARSED OUT OF THE REF, because a digest-pinned
 * ref has no tag in it — that is what pinning means. `resolveWorkerImage` asked
 * `/v2/<actor>/manifests/<version>` with `cfg.version` from the Bundle config, which is the same
 * string the checkpoint echoes as `actorVersion`, so the tag is reconstructed from the two halves the
 * console actually holds.
 */
export function driftOf(
  image: string | undefined,
  version: string,
  resolved: ResolvedImage | undefined
): DriftReading | undefined {
  if (image === undefined || image === '') return undefined;

  const pinned = parsePinned(image);
  if (pinned === undefined) {
    return {
      state: 'unpinned',
      why: `the checkpoint holds ${image}, which is not repo@sha256:<64 hex> — dockerFleet refuses a placement like this, so drift cannot be computed`,
    };
  }

  const tag = version === '' ? pinned.repo : `${pinned.repo}:${version}`;

  // "WE COULD NOT ASK" BEFORE ANY COMPARISON. Every branch below this one would otherwise be a verdict
  // reached from no evidence, and the only wrong answer this function can give is `drifted` from
  // nothing — `resolveWorkerImage` fails soft, so an empty answer is the common case.
  if (resolved === undefined) {
    return {
      state: 'unknown',
      pinned: pinned.digest,
      tag,
      why: 'the registry was not asked what this tag resolves to',
    };
  }
  if (resolved.error !== undefined && resolved.error !== '') {
    return { state: 'unknown', pinned: pinned.digest, tag, why: resolved.error };
  }

  const nowRef = resolved.image ?? '';
  const nowPinned = nowRef === '' ? undefined : parsePinned(nowRef);
  if (nowPinned === undefined) {
    return {
      state: 'unknown',
      pinned: pinned.digest,
      tag,
      why: `the registry did not resolve ${tag} to a digest — it is unreachable from the control plane, or the tag is gone`,
    };
  }

  if (nowPinned.digest === pinned.digest) {
    return {
      state: 'current',
      pinned: pinned.digest,
      now: nowPinned.digest,
      tag,
      why: `${tag} still resolves to the digest this Worker is running`,
    };
  }

  return {
    state: 'drifted',
    pinned: pinned.digest,
    now: nowPinned.digest,
    tag,
    // BOTH DIGESTS, NAMED. "Drifted" alone tells an operator nothing they can act on; the pair tells
    // them which one is on the Machine and which one a re-deploy would put there.
    //
    // "DIFFERENT", NOT "OLDER", AND THAT IS NOT PEDANTRY. Two digests being unequal does not say
    // which came first: a tag rolled back to a previous digest leaves the Worker on NEWER code, and
    // the page would then assert the opposite of the truth to somebody deciding whether to
    // re-deploy. The registry answers what the tag points at now; nothing here answers when.
    why: `running ${shortDigest(pinned.digest)} but ${tag} now resolves to ${shortDigest(nowPinned.digest)} — this Worker is on different code from what the tag names now`,
  };
}

/**
 * The key both the loader and the derivation agree on for one resolve.
 *
 * ONE FUNCTION SO THE TWO SIDES CANNOT SPELL IT DIFFERENTLY. `load.ts` fills the map from
 * `/api/infra/registry/resolve?actor=…&version=…` and `deriveMachines` reads it back by Placement; a
 * key composed independently in each is the shape that silently produces `unknown` everywhere while
 * both halves look right. `@` because an actor name cannot contain one (`sharedQueue`'s own
 * constraint) and a version can contain a dot and a dash.
 */
export function imageKey(actor: string, version: string): string {
  return `${actor}@${version}`;
}
