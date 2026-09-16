import { defineConfig } from 'vitest/config';

// `jsdom`, NOT `node`, and the first version of this file got that wrong.
//
// It said `environment: 'node'` with a comment claiming "anything here that needs a document is in
// the wrong package" — which sounds right and is not. This package is FRAMEWORK-free, not DOM-free.
// `session.ts` reads the browser's storage, `hostBridge.ts` talks to the embedding host through the
// document: both are shared by the React console and the Svelte one, both belong here, and neither
// imports a framework. The guard enforces the actual rule; the test environment should not invent a
// stricter one it cannot defend.
export default defineConfig({
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
