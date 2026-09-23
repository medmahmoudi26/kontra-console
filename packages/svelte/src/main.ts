import { install } from '@kontra/console-core/run/session';
import { mount } from 'svelte';

import './lib/tokens.css';
import App from './App.svelte';

/**
 * THE SESSION IS ATTACHED BEFORE ANYTHING FETCHES (ADR 0045).
 *
 * `install()` wraps `window.fetch` so every same-origin `/api/` call carries the bearer the login
 * handed back, and clears it on any 401 so an expired session brings the form back instead of six
 * panels failing separately. It has to run before the first surface mounts: a surface that fetched
 * first would send one unauthenticated request and render its own 401 as "empty".
 */
install();

const target = document.getElementById('app');
// A MISSING MOUNT POINT IS LOUD. `mount(App, {target: null})` throws somewhere inside Svelte with a
// message about the target, three frames from anything a reader recognises; this names the id.
if (!target) throw new Error('kontra: no #app element — packages/svelte/index.html is not the document being served');

mount(App, { target });
