/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The console reuses the orchestrator's pure core — the contract types, the Transcript reader, the
// Warden's vocabulary — as the single source of truth rather than copying it.
//
// IT IS A DEPENDENCY NOW, NOT AN ALIAS. `@core` used to be `path.resolve(here, '../backend/src')`
// and `@contract` `../backend/contract`, which is to say: this repository only built on a machine
// that had the orchestrator checked out next to it, at the right path, with its node_modules
// installed. ADR 0038 split them, so the shared kernel is published as `@kontra/core` and imported
// by name like anything else. `@` stays — it is the app's own src, the shadcn/ui convention its
// copied components import by.
/**
 * A PRODUCTION BUILD WITHOUT THE EXPLORE TOKEN IS A BUNDLE THAT 401s, AND IT USED TO BE SILENT.
 *
 * `src/run/query.ts` reads `import.meta.env.VITE_KONTRA_EXPLORE_TOKEN` and falls back to `''`; with
 * no token it sends no `Authorization` header, and `/api/datasets/query` is deliberately fail-closed
 * ("a PRIVILEGED surface: it can read every dataset"). So the whole workbench answers
 * `query: unauthorized` and nothing about the build said why.
 *
 * MEASURED, on the live instance, by doing it: `dist/` here is BIND-MOUNTED READ-ONLY into the
 * running orchestrator (`/root/oss/kontra-console/dist -> /app/web/dist`), so a plain `pnpm build`
 * in this directory does not produce an artifact to deploy later — it REPLACES what is being served,
 * immediately. Two builds run for unrelated reasons took the query workbench down, and the error the
 * operator saw named neither the token nor the build.
 *
 * `make ui` has always passed the token and even refuses without a `.env`. Nothing made the same
 * true of the command anyone would type first. Now it is: a production build fails, names the
 * variable, and says where the value comes from.
 *
 * DEV AND TEST ARE UNAFFECTED. `vite dev` talks to a dev API and the suites never build; only
 * `vite build` can put a broken artifact where something serves it.
 */
function requireExploreToken(command: string, mode: string): void {
  if (command !== 'build' || mode === 'test') return;
  if ((process.env.VITE_KONTRA_EXPLORE_TOKEN ?? '').trim() !== '') return;
  // THE ESCAPE HATCH IS ITS OWN VARIABLE, not a placeholder token, and the difference matters.
  // CI builds this bundle to prove it BUILDS — the artifact is thrown away, so it needs no token.
  // Telling those jobs to pass a junk value would bake a bearer that 401s exactly like an empty one
  // while looking deliberate, which is the failure this guard exists to make impossible. So they say
  // what is actually true instead: nothing serves this.
  if ((process.env.KONTRA_SPA_NO_TOKEN ?? '').trim() !== '') return;
  throw new Error(
    [
      'refusing to build: VITE_KONTRA_EXPLORE_TOKEN is empty.',
      '',
      'The query workbench sends it as a bearer and `/api/datasets/query` fails closed, so this',
      'build would answer `query: unauthorized` for every query — silently, because the bundle',
      'looks fine. On a dev deployment `dist/` is bind-mounted into the running orchestrator, so',
      'the broken bundle would be SERVED the moment it is written.',
      '',
      'Build through the Makefile, which reads the value from the repo .env:',
      '',
      '    make ui                       # from the kontra checkout',
      '',
      'or pass it yourself:',
      '',
      "    VITE_KONTRA_EXPLORE_TOKEN=\"$(grep '^KONTRA_EXPLORE_TOKEN=' ../kontra/.env | cut -d= -f2-)\" pnpm build",
      '',
      'If nothing will ever serve this bundle — a CI build check, a bundle-size probe — say so',
      'rather than inventing a token, because a junk bearer 401s exactly like an empty one:',
      '',
      '    KONTRA_SPA_NO_TOKEN=1 pnpm build',
    ].join('\n')
  );
}

export default defineConfig(({ command, mode }) => {
  requireExploreToken(command, mode);
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    fs: { allow: ['..'] },
    // The backend (Unit 6) serves the run API; proxy it in dev so the SPA can use
    // a same-origin `/api` base.
    //
    // THERE IS DELIBERATELY NO `/api/panels` ENTRY HERE (ADR 0020). The Dashboard's routes live under
    // `/api/panels/*` on the STREAMER's own port, and it would be easy to read that as a bug this
    // proxy should fix — it is not: `panelsClient.ts` builds an absolute base URL
    // (`VITE_KONTRA_PANEL_BASE`, else the page's host on :8090), so those requests never reach this
    // proxy and cannot be routed to 8088 by accident.
    //
    // Adding an entry would make the streamer look same-origin in dev, which means the CORS
    // allow-list and the WS `Origin` check — the two things that actually guard it in production —
    // would never run until they were in front of an operator. Two origins is the decision, so dev
    // pays the same price production does: put the dev origin in the streamer's
    // `KONTRA_PANEL_ORIGIN` (e.g. `http://localhost:8088,http://localhost:5173`) or the ticket POST
    // is blocked and the socket upgrade answers 403.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8088',
        changeOrigin: true,
      },
    },
  },
  /**
   * ── THE BROWSER SUITE HAS A DOM ───────────────────────────────────────────────────────────────
   *
   * It ran in `environment: 'node'` until now, which meant no `useEffect` ever ran and no handler
   * could be fired. That is not a gap in coverage, it is a shape: the two largest surfaces in the
   * console — `WorkflowsPage` at 1,551 lines with 31 pieces of state and 14 effects, `DashboardPage`
   * at 1,240 with 14 and 12 — had zero tests between them, and about sixty pure modules sat beside
   * components so that *something* was assertable. The tested surface was the decision and the
   * untested surface was the wiring, which is where the polling, subscription and resubscribe bugs
   * live. `jsdom` + `@testing-library/react` is what makes the wiring reachable.
   *
   * ── WALL TIME, MEASURED ON THIS BOX (2 vCPU / 3.8 GB, nothing else running) ───────────────────
   *
   *   before   environment 'node',  pool 'forks'      121 files / 2,092 tests    78 s
   *   after    environment 'jsdom', pool 'forks'      127 files / 2,234 tests   545 s   ← 7.0×
   *   after    environment 'jsdom', pool 'vmThreads'  127 files / 2,234 tests    65–72 s ← 0.9×
   *
   * Both "after" rows are the same suite, and the before row is the OLD config re-run against the
   * same warm vite cache — the 95 s this suite is usually quoted at is a cold one. The suite that
   * came out of this has a DOM and is slightly FASTER than the one that did not.
   *
   * THE POOL IS THE WHOLE DIFFERENCE, AND IT IS NOT THE DOM THAT IS SLOW. A jsdom window costs
   * 13–20 ms to construct here, measured directly against the library. What costs ~2.8 s is
   * building one in a FRESH PROCESS: vitest's default `forks` pool starts a child per test file, so
   * jsdom's module graph is imported and JIT-ed 127 times over, and the reported `environment` time
   * went from 44 ms to 343 s. `vmThreads` reuses the worker — jsdom is imported once per worker —
   * and gives each file its own `vm` context, so per-file isolation is unchanged. Measured on one
   * directory of 11 files: forks 68 s, threads 50 s, vmThreads 10.5 s.
   *
   * `isolate: false` IS FASTER STILL AND IS WRONG. It brought the suite to 50 s and failed 95 tests
   * across 6 files: the module registry and the globals are shared between files in a worker, so a
   * `vi.mock` from one survives into the next. Isolation is what the new component tests are made
   * of, and it stays on.
   *
   * ONE FILE USED TO OPT BACK OUT, AND THE SPLIT IS WHAT REMOVED IT. `methodCall.render.test.ts`
   * imported `@core/actorControl` — the orchestrator's module — which reached
   * `backend/src/data/sql.ts`, which `createRequire`s `node:sqlite` at module load. On Node 22 that
   * module is experimental and is NOT in `module.builtinModules` (verified in a REPL), so anything
   * deciding "builtin or file" from that list cannot recognise it: under `forks` the require is
   * Node's own and resolves natively, while `vmThreads` routes it through the VM's module runner,
   * which takes it for a path and fails the whole file with `ENOENT: node:sqlite` before a test
   * runs. Three narrower fixes were tried and none reaches a RUNTIME `createRequire`: `test.alias`,
   * `server.deps.external: [/^node:/]`, and a `vi.mock('node:sqlite')` in the file itself. So it ran
   * in `forks`, behind a `poolMatchGlobs` entry.
   *
   * That entry is gone. The import is `@kontra/core/caller` now — `callerFor` is the pure half of
   * `actorControl.ts` and reaches nothing — so the file runs under `vmThreads` with everything else.
   * VERIFIED by deleting the override and running the file, not by reasoning about it.
   *
   * KEEP THE SHAPE OF THAT STORY IN MIND rather than the entry itself: a browser bundle that
   * transitively imports a server module gets a Node builtin with it, and the failure appears as a
   * pool-level ENOENT that names nothing in this repository. The package boundary is what prevents
   * it now — `@kontra/core` cannot reach DuckDB, and that is a rule its own header states.
   */
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/vitest.setup.ts'],
    pool: 'vmThreads',
  },
  };
});
