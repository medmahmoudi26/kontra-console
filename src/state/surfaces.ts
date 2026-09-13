/**
 * The surfaces, and the two that used to be surfaces and are not any more.
 *
 * ONE LIST, READ BY THREE THINGS. The nav rail draws it, `address.ts` gives each one a path, and
 * `control/orchestrator/src/server.ts` keeps a copy so a cold load of any of them comes back as the
 * shell. It was three lists — a `VIEWS` array in `SideNav.tsx`, a `PATHS` record in `address.ts`,
 * and a `SPA_SURFACES` set on the server — and the third one has already drifted from the first two
 * once: `/datasets/acme.com` answered `404 {"error":"not found"}` on a cold load because the server
 * was asking whether the last segment looked like a file rather than whether the FIRST segment was
 * a surface. Two of the three can now only be wrong together.
 *
 * ── ONE DECLARATION, NOT A UNION BESIDE AN ORDER BESIDE A TABLE ──────────────────────────────────
 *
 * {@link DECLARED} is the only place a surface is written down. `View`, `SURFACES`, `PATHS` and
 * `SPA_SEGMENTS` are all derived from it, and `path` is COMPUTED from the id rather than typed
 * beside it. That shape is the fix for a real escape, and the escape is worth recording because the
 * guard that was supposed to catch it did fire — on everything except the one thing that mattered.
 *
 * `secrets` WAS ADDED TO THE UNION AND TO THE DETAIL TABLE AND SHIPPED UNREACHABLE. The `Record<View,
 * …>` guards did exactly what their comments promised: the compiler refused to build until the icon
 * map, the rail counts, the surface detail and the address union all had a `secrets` arm. The ORDER
 * was a plain `readonly View[]`, and an array has no exhaustiveness — so `SURFACES` drew six items
 * and not seven, `PATHS.secrets` was `undefined` while typed `string`, `formatAddress({view:
 * 'secrets'})` returned `undefined`, and `parseAddress('/secrets')` returned `null`. A whole surface,
 * fully built and fully tested, that nothing in the app could navigate to. Its suite passed because
 * the suite pinned the list as it was before the change.
 *
 * DERIVING THE UNION FROM THE LIST is what makes that unrepresentable rather than merely tested: a
 * surface that is not in `DECLARED` is not a `View`, so there is no half-declared state to be in.
 *
 * ── WHAT CHANGED, AND WHY THE RETIRED HALF IS HERE RATHER THAN DELETED ───────────────────────────
 *
 *  - **Catalog is new**, and it is first. It is the whole registry — every workflow and every actor
 *    this control plane knows about, in one searchable list. It does not replace Workflows or
 *    Actors: those are where you WORK on one, and this is where you FIND one. See `panels/catalog.ts`.
 *  - **Runs is retired.** A run is reached through the workflow that produced it, because a
 *    conversation belongs to a thread. The global list was a place where a run id and the code that
 *    produced it were two different searches.
 *  - **Scratch is retired as a top level.** It comes back as a workflow's own design tab, where a
 *    drawing has a subject — ADR 0026 survives unchanged and is strengthened by it.
 *  - **Secrets is its own surface**, because a write-only store with a binding lifecycle and a read
 *    audit is something an operator opens DURING a run, not something configured once.
 *  - **Settings is what is left**: which control plane, and how it is displayed.
 *
 * A RETIRED SURFACE IS NOT A DELETED URL. `/runs/nscheck-123` is in somebody's tab, somebody's
 * notes and somebody's Slack, and answering it with a 404 or a blank page teaches an operator that
 * links from this console rot. It is an address that still means something — it names a run — so it
 * REDIRECTS to where that run lives now and the id survives the move. {@link RETIRED} is what makes
 * that a fact about the address space rather than a special case buried in a parser, and it is why
 * the server must keep serving `/runs/*` and `/scratch/*`: the shell has to load before it can
 * redirect anything.
 */

/**
 * A surface, as it is declared. `path` is absent on purpose — see {@link DECLARED}.
 *
 * `id` IS `string` HERE AND `View` EVERYWHERE ELSE, and the two cannot be the same type without a
 * circle: `View` is derived FROM this list, so constraining the list by `View` would be asking the
 * compiler to define it in terms of itself. This shape is the loosest thing that still refuses a
 * surface with no label or no hint.
 */
interface SurfaceDecl {
  id: string;
  label: string;
  /** One sentence, for the tooltip. It says what the surface HOLDS, not what it is called. */
  hint: string;
}

/**
 * Every surface, in the order the rail draws them — which is the order the work happens.
 *
 * THIS IS THE ONLY DECLARATION. Everything else in this module is computed from it, which is what
 * makes a half-added surface impossible rather than merely unlikely (see the file header).
 *
 * Catalog first because it is where you arrive: the registry of everything this control plane
 * knows, and the way to the two surfaces under it. Workflows is the centre of the WORK — a workflow
 * is a thread and each of its runs is a conversation. Actors and Datasets are what a run calls and
 * what it produces. Monitor is the machines under all of it. Secrets and Settings are last because
 * they are the two that are not about a running system, and they are in that order because a secret
 * is read while something runs and a setting is not.
 */
const DECLARED = [
  {
    id: 'catalog',
    label: 'Catalog',
    hint: 'everything registered on this control plane — every workflow you can run and every actor you can call a Method on, searchable in one list',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    hint: 'your caller workflows, each run of one, and everything that run did — a run is reached through the workflow that produced it',
  },
  {
    id: 'actors',
    label: 'Actors',
    hint: 'what is deployed and registered, the Methods each Actor declares, and a form to call one',
  },
  {
    id: 'datasets',
    label: 'Datasets',
    hint: 'every Dataset ever written, filling as a run writes it — open one to query it',
  },
  {
    id: 'monitor',
    label: 'Monitor',
    hint: 'the wall of read-only Terminals over tmux',
  },
  {
    id: 'secrets',
    label: 'Secrets',
    hint: 'named secrets, the actor slots they are bound to, and who read one — write-only, never readable back',
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'this installation: the control plane it talks to, and how it is displayed',
  },
] as const satisfies readonly SurfaceDecl[];

/**
 * The surfaces, as a type.
 *
 * DERIVED FROM {@link DECLARED}, which is what closes the hole the file header describes: a surface
 * that is not in that list is not a `View`, so it cannot be half-added. The union is still what
 * makes every `Record<View, …>` in the app a compile-time guard — an eighth surface that nobody
 * gives an icon, a count or a page fails to build the day it is added.
 */
export type View = (typeof DECLARED)[number]['id'];

/** What the rail needs to draw one item, and what the router needs to address it. */
export interface Surface extends SurfaceDecl {
  id: View;
  /** The first path segment, with its leading slash. `/workflows`. */
  path: string;
}

/**
 * A surface's address.
 *
 * COMPUTED, NEVER DECLARED. It was a field beside the label, which meant every surface carried a
 * string that had to equal `/${id}` and a test to check that it did. One less thing to get wrong,
 * and one less test that could pass over a stale list.
 */
function pathOf(id: View): string {
  return `/${id}`;
}

/** Every surface, in nav order. */
export const SURFACES: readonly Surface[] = DECLARED.map((d) => ({ ...d, path: pathOf(d.id) }));

/** Every surface's path, keyed by view. Total by construction — it is built from {@link DECLARED}. */
export const PATHS: Record<View, string> = Object.fromEntries(
  DECLARED.map((d) => [d.id, pathOf(d.id)])
) as Record<View, string>;

/**
 * Where an unknown or malformed address lands, and where a cold `/` lands.
 *
 * STILL WORKFLOWS, NOT CATALOG, and that is a decision rather than an oversight. An operator opens
 * this console to see what their system is DOING; the registry is what they open when they are
 * looking for something. Landing on a browse page would put a search box in front of the answer to
 * "is anything running", every time.
 *
 * `satisfies` RATHER THAN A `View` ANNOTATION, so the type stays the literal. `address.ts` builds
 * its default Address from this, and that address is a member of a union whose Workflows arm also
 * carries a workflow and a run — widened to `View` it stops being assignable to any single arm.
 */
export const DEFAULT_VIEW = 'workflows' satisfies View;

/**
 * A first path segment that WAS a surface, and the surface that answers for it now.
 *
 * `runs` carries an id and `scratch` never did, which is the whole difference between them at this
 * level: `/runs/<id>` has something to hand on and `/scratch` has nothing to say. Both land on
 * Workflows, because that is where a run and a workflow's sketch both live now.
 */
export const RETIRED: Record<string, { to: 'workflows'; carries: 'run' | 'nothing' }> = {
  runs: { to: 'workflows', carries: 'run' },
  scratch: { to: 'workflows', carries: 'nothing' },
};

/**
 * Every first path segment this app answers for — live and retired.
 *
 * THIS IS THE LIST `control/orchestrator/src/server.ts` COPIES. It is restated there rather than
 * imported because the console is a separate package the server does not depend on, and
 * `spaFallback.test.ts` pins the pair. A segment missing there 404s on cold load for any id with a
 * dot in it, which is exactly the failure that list was introduced to fix — and a RETIRED segment
 * missing there means the redirect never runs, because the shell that would perform it never loads.
 */
export const SPA_SEGMENTS: readonly string[] = [
  ...DECLARED.map((d) => d.id),
  ...Object.keys(RETIRED),
];
