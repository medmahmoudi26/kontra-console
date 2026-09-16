import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * The console's bundle, as the package builds it.
 *
 * ── ONE DOCUMENT, ONE OWNER ─────────────────────────────────────────────────────────────────────
 *
 * While the migration ran there were two bundles writing into one `dist/`, which is why this built
 * `svelte.html` with `emptyOutDir: false` — the React build ran first and owned `index.html`. Both
 * of those are gone with React: the document is `index.html`, the directory is emptied on build,
 * and nothing has to know the order two builds run in.
 *
 * The ROOT config is the one the e2e harness imports; this one is what `pnpm --filter` builds. They
 * produce the same artifact and the root one adds the dev proxy.
 */
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2022',
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
