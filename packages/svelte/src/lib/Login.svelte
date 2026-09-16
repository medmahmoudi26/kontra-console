<script lang="ts">
  /**
   * The sign-in screen, and the gate that decides whether the console is reachable without one.
   *
   * ── THIS IS NOT THE SECURITY BOUNDARY ───────────────────────────────────────────────────────────
   *
   * The server refuses unauthenticated requests on its own; this only decides what to DRAW. A
   * console that rendered every panel and let each one fail with its own 401 would not be more
   * permissive — it would be the same thing, harder to read.
   *
   * ── AN INSTALL WITH NO CONSOLE USER IS NOT LOCKED OUT ───────────────────────────────────────────
   *
   * `GET /api/login` says whether signing in is possible at all. Where it is not, the gate steps
   * aside rather than presenting a form nobody can pass — which is what stops this from bricking an
   * installation that predates ADR 0045.
   *
   * ── A 401 ANYWHERE BRINGS THE FORM BACK ─────────────────────────────────────────────────────────
   *
   * `session.install()` clears the token on any 401, and the orchestrator restarting drops every
   * session by design. The honest response to that is this form, not six panels quietly failing.
   */
  import { isSignedIn, login, loginEnabled, onSessionChange } from '@kontra/console-core/run/session';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }
  let { children }: Props = $props();

  type Gate = 'checking' | 'required' | 'open';
  let gate = $state<Gate>('checking');

  /**
   * EMPTY, NOT `admin`.
   *
   * `GET /api/login` says whether signing in is possible and deliberately names nobody, so any
   * prefilled username is a guess — and this install's user is `root`. A wrong name with the right
   * password fails exactly like a wrong password, which sends an operator looking for the wrong
   * thing.
   */
  let user = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function settle(): Promise<void> {
    if (isSignedIn()) {
      gate = 'open';
      return;
    }
    gate = (await loginEnabled()) ? 'required' : 'open';
  }

  $effect(() => {
    void settle();
    return onSessionChange(() => void settle());
  });

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await login(user, password);
      password = '';
      await settle();
    } catch (err) {
      // The server's own sentence: a 503 says the install has no console user and NAMES the command
      // that creates one, which is not something this side should paraphrase.
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if gate === 'checking'}
  <p class="waiting">…</p>
{:else if gate === 'open'}
  {@render children()}
{:else}
  <main class="gate">
    <form onsubmit={(e) => void submit(e)}>
      <h1>kontra</h1>
      <p class="muted">
        `kontra init` printed this credential once, at install. It is on the control plane's disk,
        not in this page.
      </p>

      <!-- svelte-ignore a11y_autofocus -->
      <label>
        <span>user</span>
        <input name="user" autocomplete="username" placeholder="the name `kontra init` printed" autofocus bind:value={user} />
      </label>
      <label>
        <span>password</span>
        <input name="password" type="password" autocomplete="current-password" bind:value={password} />
      </label>

      {#if error}<p class="err" role="alert">{error}</p>{/if}

      <button type="submit" disabled={busy || user === '' || password === ''}>{busy ? 'signing in…' : 'sign in'}</button>
    </form>
  </main>
{/if}

<style>
  .waiting { margin: var(--s-4); font-size: var(--t-small); color: var(--dim); }
  /* CENTRED AND NARROW AT EVERY WIDTH. This is the one screen that is the same in a 390px panel and
     on a 27-inch display — there is nothing here for width to earn. */
  .gate { display: flex; justify-content: center; padding: var(--s-6) var(--s-3); }
  form {
    display: flex; flex-direction: column; gap: var(--s-3); width: 100%; max-width: 320px;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-4);
  }
  h1 { font-size: var(--t-head); font-weight: 600; margin: 0; }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; line-height: var(--lh-body); }
  label { display: flex; flex-direction: column; gap: var(--s-1); }
  label span { font-size: var(--t-small); color: var(--dim); font-family: var(--mono); }
  input {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-2); font-size: var(--t-body);
  }
  .err { margin: 0; font-size: var(--t-small); color: var(--bad); line-height: var(--lh-body); overflow-wrap: anywhere; }
  button {
    font-size: var(--t-small); padding: var(--s-2) var(--s-4); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); cursor: pointer;
  }
  button:disabled { border-color: var(--line); background: var(--track); color: var(--dim); cursor: not-allowed; }
</style>
