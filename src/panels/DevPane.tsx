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
 * ADR 0045 was written to stop. So a `token` parameter is consumed on the first render: stored,
 * then removed from the address with `replaceState` before anything else runs.
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
import { adoptSessionToken } from '@/run/session';

import { MethodCall } from './MethodCall';
import { useRegisteredFolders } from './RegisteredFolders';
import { folderForActor } from './sourceFolders';

/** What the host asked for, read once from the address. */
export interface DevRequest {
  actorKey: string;
  method: string;
  theme?: 'dark' | 'light';
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
  const request: DevRequest = {
    actorKey: p.get('actor') ?? '',
    method: p.get('method') ?? '',
    ...(theme === 'dark' || theme === 'light' ? { theme } : {}),
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
  // ONE READ, BEFORE ANYTHING ELSE, and the token is gone from the address by the time the first
  // paint happens. `useState(initialiser)` rather than an effect: an effect runs AFTER render, so
  // the credential would be in `location` for at least one frame and in any error report taken
  // during it.
  const [{ request, theme }] = useState(() => {
    const url = new URL(window.location.href);
    const { request, token, stripped } = readDevRequest(url);
    if (token) {
      adoptSessionToken(token);
      window.history.replaceState(null, '', stripped);
    }
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
    return { actor, op, folder: folderForActor(actor, sources) };
  }, [catalog, sources, request.actorKey, request.method]);

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
  if (!resolved.op) {
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
      <MethodCall
        key={`${resolved.actor.key}/${resolved.op.name}`}
        actor={resolved.actor}
        op={resolved.op}
        folder={resolved.folder}
        /* UNKNOWN, not "nothing is serving". The console threads this from a grid that polls once
           per queue; there is no grid here, and `null` is what makes the panel refuse to claim a
           worker state it has not measured. */
        pollers={null}
        polledAt={0}
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
