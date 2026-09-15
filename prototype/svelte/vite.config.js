import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// One file out, so the prototype can be opened from disk or published as a single page.
// A prototype nobody can look at without a dev server is a prototype nobody looks at.
export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 100000000 },
});
