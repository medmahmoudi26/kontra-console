import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
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

startAddressing();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <LoginGate>
        <App />
      </LoginGate>
    </ReactFlowProvider>
  </React.StrictMode>
);
