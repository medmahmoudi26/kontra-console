/**
 * THE EMBEDDABLE RUNNER — the Method form, with no console around it.
 *
 * WHY IT EXISTS. An editor extension should not reimplement a form renderer, a schema loader or a
 * runner. Windmill's VSCode extension renders nothing at all: it embeds a `/dev` route of the web
 * app in an iframe and posts the open file into it. That is the right shape, and kontra has the
 * expensive half already — `MethodCall` renders the form, regenerates the caller live and runs a
 * one-shot probe (ADR 0033). What was missing was a way to show that one pane on its own.
 *
 * IT IS THE SAME COMPONENT, NOT A COPY. If this file ever grew its own form, the pane and the
 * console would drift the first time either was fixed, and the extension would slowly become a
 * worse version of the thing it embeds. Everything below is addressing and chrome removal.
 *
 * ── THE TOKEN NEVER STAYS IN THE URL ────────────────────────────────────────────────────────────
 *
 * An iframe host can only hand a credential over in the query string. A bearer that LIVES there
 * ends up in history, in referrers and in any log that records a path — which is most of what
 * ADR 0045 was written to stop. So a `token` parameter is consumed before the first render:
 * stored, then removed from the address with `replaceState`.
 *
 * THAT HAPPENS IN `main.tsx`, NOT HERE, and the difference is load-bearing: `LoginGate` wraps this
 * pane, so anything this component does is behind a gate that has already decided whether there is
 * a session. Consuming the token here meant it was never consumed at all.
 *
 * ── ADDRESSING ──────────────────────────────────────────────────────────────────────────────────
 *
 *   /dev?actor=<name>@<version>&method=<name>[&theme=dark|light][&token=…]
 *
 * The actor key is the catalog's own `key`, so a caller that has one does not have to know how it
 * is composed.
 */

import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '@/state/store';
import { fetchPollers } from '@/run/api';
import type { PollerReport } from '@/run/workflowState';
import { announceReady } from './hostBridge';

import { MethodCall } from './MethodCall';
import { useRegisteredFolders } from './RegisteredFolders';
import { methodFromDisk, shapeSig, useDiskSchema } from './diskSchema';
import { folderForActor } from './sourceFolders';

/** What the host asked for, read once from the address. */
export interface DevRequest {
  actorKey: string;
  method: string;
  theme?: 'dark' | 'light';
  /**
   * THE FOLDER THE HOST IS SHOWING, absolute. The editor knows it — the file is open in it — and
   * saying so removes the only guess in this route.
   *
   * WITHOUT IT THE PANE READ THE WRONG CHECKOUT, deterministically. `folderForActor` joins an
   * actor to a folder by name and version, which is right for the Actors grid where the catalog is
   * the unit. `workspaces.kontra` normally holds the SAME actor in several workspaces — `hello`
   * and `qa` both carry hello@0.1.0 — so both folders score identically and the tie-break is
   * whichever was registered first. Edit the one you have open, save, and the pane re-reads the
   * other one and shows no change. That is the bug this parameter closes.
   */
  dir?: string;
}

/**
 * Parse the address, and TAKE the token out of it.
 *
 * Exported for the test, which is the only way to assert the token does not survive: the removal
 * is a side effect on `history`, and a component test would be asserting on the browser rather than
 * on this decision.
 */
export function readDevRequest(url: URL): { request: DevRequest; token: string; stripped: string } {
  const p = url.searchParams;
  const token = p.get('token') ?? '';
  const theme = p.get('theme');
  const dir = p.get('dir') ?? '';
  const request: DevRequest = {
    actorKey: p.get('actor') ?? '',
    method: p.get('method') ?? '',
    ...(theme === 'dark' || theme === 'light' ? { theme } : {}),
    // NOT stripped from the address the way `token` is: it is a path, not a credential, and
    // keeping it means a frame reload lands on the same folder instead of falling back to a guess.
    ...(dir ? { dir } : {}),
  };
  const rest = new URL(url.href);
  rest.searchParams.delete('token');
  return { request, token, stripped: rest.pathname + rest.search + rest.hash };
}

/** Is this address the embeddable pane? Checked before the console's own shell renders. */
export function isDevRoute(pathname: string): boolean {
  return pathname === '/dev' || pathname === '/dev/';
}

export default function DevPane(): JSX.Element {
  // THE TOKEN IS ALREADY GONE BY NOW — `main.tsx` takes it out of the address before the first
  // render, which is a step EARLIER than this component. It had to move: `LoginGate` wraps this
  // pane, so when there was no session yet the gate drew a password form and this initialiser
  // never ran — the credential the host handed over sat unread in the query string. What is left
  // here is the addressing, which is this component's own business.
  const [{ request, theme }] = useState(() => {
    const { request } = readDevRequest(new URL(window.location.href));
    return { request, theme: request.theme };
  });

  // The host's theme, so an embedded pane does not read as broken inside a dark editor.
  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const catalog = useAppStore((s) => s.catalog);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  // THE SAME HOOK THE ACTORS PAGE USES. The call routes are keyed by the registered folder holding
  // the code, so the pane has to resolve one exactly as the console does — a second notion of
  // "which folder is this Actor's" is a second answer to the question both routes are keyed by.
  const folders = useRegisteredFolders('actor');
  const sources = folders.sources;

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const resolved = useMemo(() => {
    const actor = catalog.find((a) => a.key === request.actorKey);
    if (!actor) return { actor: undefined, op: undefined, folder: undefined };
    const op =
      actor.operations.find((o) => o.name === request.method) ??
      // A single-Method actor addressed without a name is the same courtesy the dispatch path
      // gives: unnamed is accepted when there is only one, refused when there are several.
      (actor.operations.length === 1 && !request.method ? actor.operations[0] : undefined);
    // THE HOST'S FOLDER WINS OUTRIGHT when it named one. `folderForActor` stays as the fallback
    // for a pane opened without `dir` (the console's own links), where a name+version guess is all
    // there is.
    const named = request.dir ? sources.find((f) => f.path === request.dir) : undefined;
    return { actor, op, folder: named ?? folderForActor(actor, sources) };
  }, [catalog, sources, request.actorKey, request.method, request.dir]);

  /* ── THE FORM FOLLOWS THE FILES, NOT THE CATALOG ──────────────────────────────────────────────
   *
   * A catalog entry is what a worker published AT BOOT. Beside an editor that is the wrong truth:
   * add a parameter, save, and the catalog still describes the code that booted an hour ago, so the
   * form offers fields that no longer exist and omits the one just written. This re-reads the
   * folder and lets what is on disk win.
   *
   * RE-READ ON THE HOST'S SIGNAL, not on a timer. The editor knows the exact moment the file was
   * saved — the save went through it — so it says so (`hostBridge.ts`) and this fetches once. A
   * poll would be the same answer, later and repeatedly, for a pane that is usually idle.
   *
   * THE CATALOG IS STILL THE FALLBACK. A folder whose schema will not derive — a syntax error mid
   * edit is the common one — keeps rendering the last good form rather than replacing it with an
   * error, because a form that vanishes on every keystroke that does not yet parse is worse than a
   * form that is briefly stale. `diskError` is surfaced beside it instead. */
  const folderId = resolved.folder?.id;
  /* ONE READER FOR BOTH SURFACES — see `diskSchema.ts`. This logic used to live here and only here,
     which is exactly why the Actors page could not draw a form for an Actor that had never served. */
  const { disk, diskError } = useDiskSchema(folderId);
  /* THE EXTENSION'S HANDSHAKE, which is all that is left here.
   *
   * `useDiskSchema` owns the reading and the live refresh now, including the server-sent stream that
   * makes a plain browser tab as instant as this pane. What the host still adds is nothing: its
   * save signal became redundant the moment the server learned to say the folder changed. The
   * READINESS announcement stays, because the host queues messages until it hears one. */
  useEffect(() => {
    announceReady();
  }, []);

  /* ASK WHO IS POLLING, rather than passing `null` and rendering "Temporal could not be asked".
   * That sentence is true only when the question was not put, and this pane never put it — so it
   * reported a missing answer as if Temporal were unreachable, next to a Run button it had
   * disabled. The route exists and the Actors grid already uses it. */
  const queue = resolved.actor ? `${resolved.actor.name}-${resolved.actor.version}` : '';
  const [pollers, setPollers] = useState<PollerReport | null>(null);
  const [polledAt, setPolledAt] = useState(0);

  useEffect(() => {
    if (!queue) return;
    let live = true;
    const read = async (): Promise<void> => {
      const report = await fetchPollers(queue);
      if (!live) return;
      setPollers(report);
      setPolledAt(Date.now());
    };
    void read();
    // A worker is started OUTSIDE this pane — in a terminal, or by the Actors page — so unlike the
    // schema there is no host event to hang this on. Ten seconds is slow enough to be invisible on
    // an idle pane and fast enough that serving an Actor and turning back to the form is one move.
    const timer = window.setInterval(() => void read(), 10_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [queue]);

  /** The Method to render: the file's version when it derived, the catalog's when it did not. */
  const op = useMemo(() => methodFromDisk(resolved.op, disk), [disk, resolved.op]);

  if (!request.actorKey) {
    return <Notice title="No actor was named">Add <code>?actor=&lt;name&gt;@&lt;version&gt;</code> to the address.</Notice>;
  }
  if (!catalog.length) {
    return <Notice title="Loading…">Reading the catalog.</Notice>;
  }
  if (!resolved.actor) {
    return (
      <Notice title={`No actor named ${request.actorKey}`}>
        Nothing in the catalog has that key. Register the folder, or serve it — an actor publishes
        itself on boot.
      </Notice>
    );
  }
  if (!resolved.op || !op) {
    const names = resolved.actor.operations.map((o) => o.name).join(', ') || 'none';
    return (
      <Notice title={`No Method named ${request.method || '(unnamed)'}`}>
        {resolved.actor.key} declares: {names}
      </Notice>
    );
  }
  if (!resolved.folder || resolved.folder.absent) {
    return (
      <Notice title="This Actor's folder is not registered here">
        The call routes are keyed by the registered folder holding the code, and this one is
        {resolved.folder ? ' missing from disk' : ' not registered'}.
      </Notice>
    );
  }

  // NO SHELL, NO RAIL, NO NAVIGATION — that is the entire difference from the console, and it is
  // why this is a route rather than a prop on the existing page.
  return (
    <div className="min-h-screen bg-background p-3" data-testid="dev-pane">
      {diskError ? (
        <p className="mb-2 font-mono text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
          showing the last schema that derived — {diskError}
        </p>
      ) : null}
      <MethodCall
        /* THE SHAPE IS IN THE KEY, so a saved edit REMOUNTS the form. `MethodCall` seeds its field
           state from `op` on mount; handing it a new `op` alone would leave the old fields sitting
           there, which is the exact failure this whole path exists to remove. */
        key={`${resolved.actor.key}/${op.name}/${shapeSig(op)}`}
        actor={resolved.actor}
        op={op}
        folder={resolved.folder}
        /* UNKNOWN, not "nothing is serving". The console threads this from a grid that polls once
           per queue; there is no grid here, and `null` is what makes the panel refuse to claim a
           worker state it has not measured. */
        pollers={pollers}
        polledAt={polledAt}
        /* THE COMMAND, because this pane has no card and no workbench to point at — and it comes
           from the SERVER, not from here. This used to be built locally as
           `kontra serve --actor <dir> --watch`, which is right on a laptop and cannot work against
           the Compose cluster: the operator runs it on the host, where there is no SDK, and the
           actor dies on `import temporalio`. Only the orchestrator knows whether it is a container.
           Absent (an older server) shows no hint rather than a wrong one. `--watch` re-execs the
           Worker on save, which is the half of "instant" the form cannot do: the form follows the
           file already, but a worker holds what it imported at boot. */
        {...(disk?.serve ? { howToServe: disk.serve } : {})}
        onClose={() => {
          /* nothing to close back to — the pane IS the page */
        }}
      />
    </div>
  );
}


function Notice({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm space-y-2 rounded-lg border border-border p-5">
        <h1 className="font-mono text-sm font-medium">{title}</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
