/**
 * The console's credential: where it comes from, where it is kept, and how it reaches a request.
 *
 * WHAT THIS REPLACED. The console used to authenticate with `VITE_KONTRA_EXPLORE_TOKEN` — a bearer
 * BAKED INTO THE BUNDLE at build time. That is a credential inside a build artifact: it is
 * invalidated by any rotation, it cannot differ per operator, and a `pnpm build` run for an
 * unrelated reason replaced the served bundle with one whose token was the empty string, after
 * which every query answered `query: unauthorized` and nothing said why.
 *
 * Now the operator signs in against the credential on the filesystem — the one `kontra init`
 * generates and `~/.kontra/config.yaml` holds the hash of — and the server hands back a session
 * token. That token is the `Authorization` header for everything from then on.
 *
 * ── ONE INTERCEPTOR, NOT FIFTY CALL SITES ───────────────────────────────────────────────────────
 *
 * `src/run/api.ts` alone makes 45 `fetch` calls and there is no shared wrapper. Threading a header
 * through each is fifty edits that must all be correct, and the failure of missing one is a single
 * route that 401s for reasons nobody can see. So `install()` wraps `window.fetch` once.
 *
 * IT IS DELIBERATELY NARROW, because a blanket "add my credential to every request" is how a token
 * ends up somewhere it was never meant to go:
 *
 *   • SAME-ORIGIN `/api/…` ONLY. An absolute URL to another host gets nothing — which matters
 *     concretely, since `panelsClient.ts` builds an absolute base for the STREAMER on another port
 *     (ADR 0020 keeps those two origins apart on purpose).
 *   • AN EXISTING `Authorization` IS NEVER OVERWRITTEN. A caller that knows better keeps its own.
 *   • NO TOKEN, NO HEADER. Before sign-in every request is exactly the request it was before this
 *     file existed, so an unauthenticated install behaves as it always did.
 */

const STORAGE_KEY = 'kontra.session';

/**
 * `localStorage`, and the trade is worth stating rather than assuming.
 *
 * In memory would not survive a refresh, which on a console people leave open all day means signing
 * in after every reload. `localStorage` is readable by script on this origin — so the real defence
 * is that there is nothing else on this origin, and that the token is a SESSION rather than a
 * service token: it expires, it dies with the orchestrator process, and it cannot spend money the
 * way `KONTRA_STATE_TOKEN` can. That separation is what makes it safe to hand a browser at all.
 */
function read(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return ''; // a browser with storage denied still works, it just signs in every time
  }
}

function write(token: string): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage denied — the in-memory copy below still carries this page's session */
  }
}

/**
 * The in-memory copy, which is a FALLBACK and not the source of truth.
 *
 * STORAGE IS READ PER CALL, not captured at import, and that is a correctness point rather than a
 * testing one: a token captured once is a token that never notices a sign-in in another tab, and
 * never notices a sign-out either. This lives only for a browser that denies storage, where the
 * page still has to work for its own lifetime.
 */
let memory = '';

/** The live token. Storage first, memory when storage is unavailable. */
export function sessionToken(): string {
  return read() || memory;
}

export function isSignedIn(): boolean {
  return sessionToken() !== '';
}

/** Everything that has to happen when a token arrives or goes. One place, so nothing drifts. */
function setToken(token: string): void {
  memory = token;
  write(token);
  for (const listener of listeners) listener(token);
}

const listeners = new Set<(token: string) => void>();

/** Subscribe to sign-in and sign-out. Returns the unsubscribe, for a React effect's cleanup. */
export function onSessionChange(fn: (token: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface LoginResult {
  user: string;
  expiresAt: number;
}

/** Is signing in even possible? An install with no console user should say so, not show a form. */
export async function loginEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/login');
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { enabled?: boolean }).enabled);
  } catch {
    return false;
  }
}

/**
 * Sign in. Throws with the server's own sentence, which is the useful one — a 503 says the install
 * has no console user and names the command that creates one, and that is not something this side
 * should paraphrase.
 */
export async function login(user: string, password: string): Promise<LoginResult> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    user?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !body.token) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  setToken(body.token);
  return { user: body.user ?? user, expiresAt: body.expiresAt ?? 0 };
}

/**
 * Sign out. The LOCAL token is cleared whatever the server says, because a failed request must not
 * leave a browser holding a credential it is trying to give up.
 */
export async function logout(): Promise<void> {
  const token = sessionToken();
  setToken('');
  if (!token) return;
  try {
    await fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } catch {
    /* already signed out locally, which is the half that matters */
  }
}

/** Same-origin `/api/…`? The only requests this credential belongs on. */
function isOwnApi(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href
    );
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Wrap `window.fetch` so every same-origin API call carries the session.
 *
 * IDEMPOTENT, because React's StrictMode runs effects twice in development and wrapping a wrapper
 * would double every request's header work for the life of the page.
 */
export function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = sessionToken();
    if (!token || !isOwnApi(input)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // A caller that set its own Authorization knows something this does not.
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    const res = await original(input, { ...init, headers });
    // A SESSION THAT STOPPED WORKING SIGNS YOU OUT, rather than leaving every panel to render its
    // own 401. The orchestrator restarting drops every session by design, and the honest response
    // to that is the login form, not an empty grid.
    if (res.status === 401 && sessionToken()) setToken('');
    return res;
  };
}
