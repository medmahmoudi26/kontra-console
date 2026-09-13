import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import DevPane, { isDevRoute } from './panels/DevPane';
import { startAddressing } from './state/addressing';
import { install as installSession } from './run/session';
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
// hands a token over in the query string (consumed and stripped by DevPane), and when it does not,
// the gate asking for a password is the correct outcome rather than a blank frame.
const EMBEDDED = isDevRoute(window.location.pathname);

if (!EMBEDDED) startAddressing();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <LoginGate>{EMBEDDED ? <DevPane /> : <App />}</LoginGate>
    </ReactFlowProvider>
  </React.StrictMode>
);
