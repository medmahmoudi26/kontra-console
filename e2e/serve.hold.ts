/**
 * `pnpm test:e2e:serve` — the console, held open for a human to look at.
 *
 * Playwright starts the SPA's dev server and this file holds it until Ctrl-C. It is a `test` only
 * because that is what already knows how to start the dev server; nothing here asserts anything.
 *
 * IT USED TO BOOT A STREAMER TOO — the real `PanelServer` behind a faked SSH/tmux seam, so a human
 * could watch the Dashboard's wall fill with synthetic screens. That went with the Monitor. What is
 * left points at whatever control plane the SPA is configured for.
 *
 * It is NOT collected by an ordinary run: the config's `testMatch` is `**\/*.spec.ts` unless
 * `KONTRA_E2E_SERVE=1` is set, which is what `pnpm test:e2e:serve` does.
 */

import { test } from '@playwright/test';
import { WEB_BASE } from './env';

test('holds the console open until Ctrl-C', async () => {
  test.setTimeout(0);
  // eslint-disable-next-line no-console
  console.log(`\n  console:  ${WEB_BASE}\n\n  Ctrl-C to stop.\n`);
  await new Promise(() => {});
});
