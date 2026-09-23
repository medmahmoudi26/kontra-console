/// <reference types="node" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The console's bundle.
 *
 * ── ONE BUNDLE AGAIN ────────────────────────────────────────────────────────────────────────────
 *
 * This file used to build the React console and `packages/svelte/vite.config.ts` built the other
 * one into the same `dist/`, with `emptyOutDir: false` and a second document name keeping them out
 * of each other's way (ADR 0048 §1). The migration is finished: every Surface serves from Svelte,
 * React is deleted, and the document is `index.html` again.
 *
 * IT STAYS AT THE ROOT because the e2e harness imports `../vite.config` and drives the app with the
 * project's own config — the point of that being that the page under test is built exactly the way
 * `pnpm dev` builds it. A config the suite had to be edited to find would break the one property
 * that makes those specs evidence: they cannot tell which framework is underneath.
 *
 * `root` IS THE SVELTE PACKAGE. The sources and the document live there; only the configuration
 * lives here.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * A PRODUCTION BUILD MUST NOT CARRY A BEARER — and this guard used to say the opposite.
 *
 * The console authenticated with `VITE_KONTRA_EXPLORE_TOKEN`, baked in at build time, and the first
 * version of this check REQUIRED it: a tokenless bundle sent no `Authorization`, the fail-closed
 * `/api/datasets/query` refused it, and the whole workbench answered `query: unauthorized` with
 * nothing in the build to say why. Measured on the live instance, by causing it — `dist/` here is
 * bind-mounted read-only into the running orchestrator, so a `pnpm build` run for an unrelated
 * reason does not produce an artifact to deploy later, it REPLACES what is being served.
 *
 * ADR 0045 removed the reason rather than the symptom. The operator signs in against the credential
 * on the filesystem and the server hands back a session token, so the browser gets its bearer at
 * RUNTIME and the bundle needs none. Which inverts this file's job: a token in the artifact is now
 * a leak with no upside — it cannot rotate, it is the same for every operator, and it outlives the
 * container in whatever registry or backup holds the image.
 *
 * So the check stands, pointing the other way. It is the one place a build can notice.
 */
function refuseBakedCredential(command: string, mode: string): void {
  if (command !== 'build' || mode === 'test') return;
  const baked = (process.env.VITE_KONTRA_EXPLORE_TOKEN ?? '').trim();
  if (baked === '') return;
  throw new Error(
    [
      'refusing to build: VITE_KONTRA_EXPLORE_TOKEN is set.',
      '',
      'The console no longer reads it. Since ADR 0045 the browser gets its bearer by SIGNING IN —',
      '`kontra init` generates the credential at install and prints it once — so a token baked into',
      'the bundle is a credential in a build artifact with nothing to buy: it cannot be rotated, it',
      'is identical for every operator, and it outlives this container in any image that keeps it.',
      '',
      'Unset it and build again:',
      '',
      '    unset VITE_KONTRA_EXPLORE_TOKEN && pnpm build',
      '',
      'If a Makefile or CI job is passing it, that is the thing to fix — it is no longer read.',
    ].join('\n')
  );
}

export default defineConfig(({ command, mode }) => {
  refuseBakedCredential(command, mode);
  return {
    root: path.resolve(here, 'packages/svelte'),
    plugins: [svelte()],
    server: {
      fs: { allow: [here] },
      /**
       * The run API, proxied in dev so the app can use a same-origin `/api` base.
       *
       * THERE IS DELIBERATELY NO `/api/panels` ENTRY (ADR 0020). The Monitor's routes live on the
       * STREAMER's own port, and `panelsClient.ts` builds an absolute base for them — so those
       * requests never reach this proxy and cannot be routed to 8088 by accident.
       *
       * Adding one would make the streamer look same-origin in dev, which means the CORS allow-list
       * and the WS `Origin` check — the two things that actually guard it in production — would
       * never run until they were in front of an operator. Two origins is the decision, so dev pays
       * the same price production does: put the dev origin in `KONTRA_PANEL_ORIGIN`, or the ticket
       * POST is blocked and the socket upgrade answers 403.
       */
      proxy: {
        '/api': {
          target: process.env.VITE_API_TARGET ?? 'http://localhost:8088',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2022',
      outDir: path.resolve(here, 'dist'),
      emptyOutDir: true,
    },
  };
});
