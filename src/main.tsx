import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import DevPane, { isDevRoute, readDevRequest } from './panels/DevPane';
import { installLocalClipboard, listenForHostCopy, listenForHostPaste } from './panels/hostBridge';
import { startAddressing } from './state/addressing';
import { adoptSessionToken, install as installSession } from './run/session';
import LoginGate from './panels/LoginGate';
import '@xyflow/react/dist/style.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// BEFORE THE FIRST RENDER, not in an effect. The URL is what the store starts from (`address.ts`),
// so a session that opened `/runs/nscheck-123` must never see the `workflows` default — seeding
// after mount would paint the wrong surface for a frame and start its pollers. Outside React on
// purpose too: this subscribes to `popstate` for the life of the document, and StrictMode
// double-invokes effects.
// BEFORE THE FIRST FETCH, and outside React for the same reason `startAddressing` is: this wraps
// `window.fetch` so every same-origin `/api/…` call carries the session token, and a component
// mounting before the wrapper is installed would make an unauthenticated request that 401s for no
// reason a reader could see. It is idempotent, so StrictMode's double invoke costs nothing.
installSession();

// THE EMBEDDABLE PANE BRANCHES HERE, before `startAddressing` and before the shell.
//
// Not inside `App`, and the reason is `startAddressing`: it seeds the surface store from the URL
// and subscribes to `popstate` for the life of the document. `/dev` is not one of the console's
// surfaces, so letting it run would have the store deciding which of workflows|actors|datasets an
// embedded pane is — and then rewriting the address out from under the host that framed it.
//
// It keeps the LoginGate. An embedded pane is not an exemption from signing in: the host normally
// hands a token over in the query string, and when it does not, the gate asking for a password is
// the correct outcome rather than a blank frame.
const EMBEDDED = isDevRoute(window.location.pathname);

if (!EMBEDDED) startAddressing();

// ── THE TOKEN IS TAKEN OUT OF THE ADDRESS HERE, BEFORE THE GATE RENDERS ─────────────────────────
//
// It used to be adopted by `DevPane`'s first render, and the gate made that unreachable. LoginGate
// wraps the pane (below), so it renders FIRST and asks `isSignedIn()` — and a token still sitting
// in the query string is not a session yet. So the gate drew a password form and never rendered
// the child whose job was to consume the credential it had just been handed.
//
// MEASURED, in the editor extension this route exists for: the pane opened on a signed-in host and
// showed a login form anyway, inside a cross-origin iframe where the editor does not forward the
// paste keystroke — so the one credential that would get past it could not even be pasted in.
//
// Same read, same strip, one step earlier: `installSession` above has already wrapped `fetch`, so
// the very first `/api/…` call from the pane carries the token.
if (EMBEDDED) {
  const url = new URL(window.location.href);
  const { token, stripped } = readDevRequest(url);
  if (token) {
    adoptSessionToken(token);
    window.history.replaceState(null, '', stripped);
  }
}

// PASTE ARRIVES AS A MESSAGE HERE, because in a webview's nested frame it arrives no other way —
// see `hostBridge.ts`. Outside React and for the life of the document, like the two above: a
// listener owned by a component would be torn down and re-added by every StrictMode double-invoke,
// and the host has no way to know when it is safe to post.
if (EMBEDDED) {
  listenForHostPaste();
  listenForHostCopy();
  // The other half of the same problem — see `installLocalClipboard`.
  installLocalClipboard();
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <LoginGate>{EMBEDDED ? <DevPane /> : <App />}</LoginGate>
    </ReactFlowProvider>
  </React.StrictMode>
);
