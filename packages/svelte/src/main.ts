import { mount } from 'svelte';

import App from './App.svelte';

const target = document.getElementById('app');
// A MISSING MOUNT POINT IS LOUD. `mount(App, {target: null})` throws somewhere inside Svelte with a
// message about the target, three frames from anything a reader recognises; this names the id.
if (!target) throw new Error('kontra: no #app element — packages/svelte/index.html is not the document being served');

mount(App, { target });
