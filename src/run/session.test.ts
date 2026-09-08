/**
 * The fetch interceptor, and the three things that keep it from being a way to leak a credential.
 *
 * It exists because `run/api.ts` alone makes 45 `fetch` calls with no shared wrapper — threading a
 * header through each is fifty edits that must all be right. Wrapping once is the smaller risk, but
 * only if the wrapper is narrow, so this pins the narrowness rather than the convenience.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install, isSignedIn, logout, onSessionChange, sessionToken } from './session';

const KEY = 'kontra.session';
let calls: Array<{ url: string; auth: string | null }> = [];
let status = 200;

/**
 * THE UNDERLYING fetch, swapped per test — never `window.fetch` itself.
 *
 * The first version of this file reassigned `window.fetch` in `beforeEach` AFTER `install()` had
 * wrapped it, which threw the wrapper away. Every test that asserted "no header was added" then
 * passed because there was no interceptor at all — four vacuous tests that would have passed with
 * the feature deleted. `install()` is idempotent, so it cannot be re-applied to repair that.
 *
 * So the wrapper is installed ONCE, over a stub that delegates here, and tests change what it
 * delegates TO. `assertWrapped` below fails if that ever stops being true.
 */
let underlying: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push({ url, auth: new Headers(init?.headers ?? {}).get('authorization') });
  return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
};

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => underlying(input, init)) as typeof fetch;
install();
const wrapped = window.fetch;

beforeEach(() => {
  calls = [];
  status = 200;
  window.localStorage.setItem(KEY, 'session-token-abc');
});

afterEach(() => {
  window.localStorage.removeItem(KEY);
});

/** NON-VACUOUS GUARD. Without this every "no header" assertion below is trivially true. */
function assertWrapped(): void {
  expect(window.fetch, 'the interceptor was replaced — every assertion here would be vacuous').toBe(wrapped);
}

describe('what the interceptor attaches a credential to', () => {
  it('sends it on a same-origin /api call', async () => {
    assertWrapped();
    await fetch('/api/datasets/query', { method: 'POST' });
    expect(calls.at(-1)?.auth).toBe('Bearer session-token-abc');
  });

  it('does NOT send it to another origin', async () => {
    assertWrapped();
    // `panelsClient.ts` builds an absolute base for the STREAMER on another port — ADR 0020 keeps
    // those two origins apart on purpose, and a blanket "add my credential to everything" would
    // hand the session to a second service that never asked for it.
    await fetch('http://elsewhere.example:8090/api/panels/terminals');
    expect(calls.at(-1)?.auth).toBeNull();
  });

  it('does NOT send it to a same-origin path outside /api', async () => {
    assertWrapped();
    await fetch('/index.html');
    expect(calls.at(-1)?.auth).toBeNull();
  });

  it('never overwrites an Authorization the caller set', async () => {
    assertWrapped();
    await fetch('/api/anything', { headers: { authorization: 'Bearer caller-knows-better' } });
    expect(calls.at(-1)?.auth).toBe('Bearer caller-knows-better');
  });

  it('sends nothing at all once signed out', async () => {
    assertWrapped();
    // Through the real API rather than a module-registry trick: `logout()` is what a person clicks
    // and what a 401 triggers, so testing that path tests the one that runs.
    await logout();
    calls = [];
    await fetch('/api/datasets/query');
    expect(calls.at(-1)?.auth, 'a signed-out request must be the request it was before').toBeNull();
    expect(isSignedIn()).toBe(false);
    expect(sessionToken()).toBe('');
  });
});

describe('a session that stopped working', () => {
  it('signs you out on a 401, so the form comes back instead of an empty grid', async () => {
    // The orchestrator restarting drops every session by design (they live in its memory). The
    // honest response is the login form, not every panel rendering its own 401.
    const seen: string[] = [];
    const off = onSessionChange((t) => seen.push(t));
    assertWrapped();
    status = 401; // the underlying answer changes; the wrapper stays
    expect(isSignedIn(), 'precondition: signed in').toBe(true);
    await fetch('/api/datasets/query');
    off();
    expect(isSignedIn(), 'a 401 must clear the session').toBe(false);
    expect(seen, 'and it must notify, or the gate never re-renders').toContain('');
  });
});
