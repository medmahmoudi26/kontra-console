import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * The Svelte console's bundle.
 *
 * ── TWO BUNDLES, ONE `dist/`, AND THE TWO RULES THAT MAKES ──────────────────────────────────────
 *
 * The orchestrator serves both SPAs from one origin (ADR 0048 §1), so they share `dist/` and
 * `dist/assets/`. Vite hashes every emitted name, so the two asset sets coexist without a prefix —
 * `svelte-Dr8LF2Ru.js` beside `index-B3WA71v4.js`. A `base` of `/s/` was the first attempt and it
 * only moved the URLs without moving the files.
 *
 * `emptyOutDir: false`, because the React build runs FIRST and owns the directory. Without this,
 * building Svelte deletes the React console. The order lives in the root `build` script — a build
 * tool cannot enforce the order of two builds it does not run.
 *
 * The document is `svelte.html` and not `index.html` for the same reason: one name, one owner.
 */
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    outDir: '../../dist',
    emptyOutDir: false,
    // `svelte.html`, NOT `index.html`: both builds write into one `dist/` and the React build
    // owns that name. Two entries called index.html means the second silently replaces the first.
    rollupOptions: { input: 'svelte.html' },
  },
});
