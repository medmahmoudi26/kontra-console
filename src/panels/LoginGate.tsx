/**
 * The sign-in screen, and the gate that decides whether the console is reachable without one.
 *
 * WHY THIS EXISTS. The CLI authenticates by reading `~/.kontra/config.yaml`; a browser cannot. Until
 * this, the console got in by carrying a bearer BAKED INTO ITS BUNDLE at build time — a credential
 * inside a build artifact, invalidated by any rotation, and silently replaced with an empty string
 * by a build run for an unrelated reason, after which every query answered `query: unauthorized`.
 *
 * THE GATE IS NOT THE SECURITY BOUNDARY and must not be mistaken for one. The server refuses
 * unauthenticated requests on its own; this only decides what to draw. A console that rendered its
 * panels and let each one fail with its own 401 would be a worse version of the same thing, not a
 * more permissive one.
 *
 * AN INSTALL WITH NO CONSOLE USER IS NOT LOCKED OUT. `GET /api/login` reports whether signing in is
 * possible at all; when it is not, the gate steps aside rather than presenting a form nobody can
 * pass. That is the pre-login behaviour, preserved, so this cannot brick an existing installation —
 * and the server is still the thing deciding what those requests may do.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isSignedIn, login, loginEnabled, onSessionChange } from '@kontra/console-core/run/session';

type Gate = 'checking' | 'required' | 'open';

export default function LoginGate({ children }: { children: ReactNode }): JSX.Element {
  const [gate, setGate] = useState<Gate>('checking');

  const settle = useCallback(async () => {
    if (isSignedIn()) {
      setGate('open');
      return;
    }
    // Not signed in — but an install with no console user must not be shown a form.
    setGate((await loginEnabled()) ? 'required' : 'open');
  }, []);

  useEffect(() => {
    void settle();
    // A 401 anywhere clears the token (`session.ts`), which has to bring the form back — otherwise
    // an expired session leaves an operator staring at panels that quietly fail.
    return onSessionChange(() => void settle());
  }, [settle]);

  if (gate === 'checking') return <div className="p-6 text-sm text-muted-foreground">…</div>;
  if (gate === 'open') return <>{children}</>;
  return <LoginForm />;
}

function LoginForm(): JSX.Element {
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(user, password);
      // No navigation: `onSessionChange` re-settles the gate, so the console appears in place.
    } catch (err) {
      // THE SERVER'S OWN SENTENCE. A 503 says the install has no console user and names the command
      // that creates one; replacing that with "login failed" would throw away the only useful part.
      setError(err instanceof Error ? err.message : String(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border p-6"
        data-testid="login-form"
      >
        <div>
          <h1 className="font-mono text-sm font-medium">kontra</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with the credential <code>kontra init</code> printed at install.
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">user</span>
          <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>

        {error && (
          <p className="whitespace-pre-wrap text-xs text-destructive" data-testid="login-error">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'signing in…' : 'sign in'}
        </Button>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Lost it? <code>kontra user add &lt;name&gt;</code> makes another. Only the hash is stored,
          so the one printed at install cannot be recovered.
        </p>
      </form>
    </div>
  );
}
