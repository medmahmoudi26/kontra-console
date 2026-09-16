import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

/**
 * `jsdom`, because this bundle's code touches the document.
 *
 * Not a concession: the grid's cell renderers return `HTMLElement` by design — ag-grid's vanilla
 * API asks for one — and a renderer that cannot be tested without a browser is a renderer nobody
 * tests. The same correction was made in `@kontra/console-core`: framework-free is not DOM-free.
 */
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
