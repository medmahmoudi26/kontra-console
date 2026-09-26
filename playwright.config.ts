/**
 * Playwright for the console — the browser bar for anything geometric or interactive.
 *
 * WHY THIS EXISTS SEPARATELY FROM VITEST. `pnpm typecheck` and the vitest suites pass on a view that
 * throws on mount and on a component that mounts at 0×0 and shows nothing — jsdom has no layout
 * engine, so every `clientHeight` is `0`. None of those is evidence that a human can see anything,
 * and CONTRACT.md's Verification section makes a browser run the bar for a UI slice.
 *
 * The glob is deliberately disjoint from vitest's (`src/**\/*.test.ts` there, `e2e/**\/*.spec.ts`
 * here) so neither runner collects the other's files — a spec collected by vitest fails on the first
 * `page` reference and reads like a broken test rather than a misconfigured runner.
 *
 * ONE PROJECT NOW, AND IT USED TO BE TWO. The Dashboard was driven against two independent
 * streamers — a hand-written RFC 6455 stub and a booted `PanelServer` with the SSH/tmux seam faked —
 * so that a pass meant the browser could read what the WIRE specified, not merely what one
 * implementation emitted. Both went with the Monitor, and with them `e2e/fixtures.ts`,
 * `e2e/streamer.ts`, `e2e/stubStreamer.mjs`, `e2e/fakeFleet.ts`, `e2e/control.ts` and
 * `e2e/stubProcess.ts`. What is left stubs the ORCHESTRATOR with `page.route` and opens no socket.
 *
 * NOTHING IN A RUN IS FIXED OR SHARED. `e2e/run.mjs` allocates this run's port and exports it before
 * Playwright starts (see its header for why a config cannot do that), and everything derived from it
 * follows: the dev server's optimised-deps cache and Playwright's `outputDir`. Both were measured
 * collisions between two concurrent runs — a human's and an agent's — and each presented as a flaky
 * spec rather than as contention.
 *
 * Chromium comes from this machine's Playwright cache. `@playwright/test` stays pinned at 1.61 —
 * amendment 12 — because its Chromium revision (1228) is already there: the suite downloads nothing.
 */

import { defineConfig, devices } from '@playwright/test';
import { HOST, WEB_BASE, WEB_PORT } from './e2e/env';

/**
 * `test:e2e:serve` sets this instead of pointing at a second config file.
 *
 * A separate `playwright.serve.config.ts` was the obvious shape and it was a trap: `tsconfig.json`'s
 * `include` lists `playwright.config.ts` by name, so a second config is NOT typechecked, and a symbol
 * renamed in `e2e/env.ts` rots there invisibly until someone runs it and the config fails to LOAD.
 * One config, inside the gate, switched by an env var.
 */
const serving = !!process.env.KONTRA_E2E_SERVE;

/**
 * The SPA in dev mode, pointed at whichever streamer holds this run's port.
 *
 * `--host 127.0.0.1` is load-bearing. Vite's default binds whatever `localhost` resolves to, which on
 * this machine is `::1` FIRST; Playwright then polls `http://127.0.0.1:…`, never sees it, and starts a
 * second dev server that dies with EADDRINUSE — a confusing way to discover an IPv6 default.
 */
export const viteServer = {
  command:
    `pnpm vite --config e2e/vite.e2e.config.ts --port ${WEB_PORT} --strictPort --host ${HOST}`,
  url: WEB_BASE,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: {
    // Its own optimised-deps cache, so two concurrent runs cannot break each other's module graph.
    KONTRA_E2E_VITE_CACHE: serving ? 'serve' : String(WEB_PORT),
  },
};

export default defineConfig({
  testDir: './e2e',
  // `serve.hold.ts` is deliberately not a `.spec.ts`: a test that never returns must not be
  // collectable by an ordinary run.
  testMatch: serving ? '**/serve.hold.ts' : '**/*.spec.ts',
  // Sized for a LOADED box, not an idle one. Two concurrent runs (a human's and an agent's) slow a run
  // by ~4×: two Chromiums, two dev servers, two streamers, plus a per-run vite dependency cache that
  // pays its optimisation on first load. At a 10 s assertion budget that showed up as three different
  // specs "failing" on locators that were simply late — the same false accusation a shared port used to
  // make. An assertion resolves as soon as its condition holds, so a bigger budget costs an idle run
  // nothing and only makes a genuine failure slower to report. Serving has no timeout: it holds until
  // Ctrl-C.
  timeout: serving ? 0 : 90_000,
  expect: { timeout: 25_000 },
  // One worker: the specs stub one orchestrator between them and the dev server is shared.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  // PER RUN, not a shared directory. Playwright clears `outputDir` when a run starts and writes traces
  // into it as it goes, so two concurrent runs delete each other's artifacts mid-flight — measured:
  // `ENOENT: unlink .playwright-artifacts-0/….zip` failed an otherwise passing spec in one run, and the
  // other run's failure evidence was already gone when I went to read it.
  outputDir: serving ? 'test-results' : `test-results/run-${WEB_PORT}`,
  use: {
    baseURL: WEB_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: serving ? 'serve' : 'console' }],
  webServer: [viteServer],
});
