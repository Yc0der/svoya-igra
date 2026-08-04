import { rmSync } from 'node:fs';

// The server persists room state to a relative-path snapshot file
// (server/src/index.ts: SNAPSHOT_PATH = './room-snapshot.json') and reloads
// it on boot. Because playwright.config.ts's webServer.command spawns a
// fresh server process for every `pnpm run test:e2e` invocation, a
// snapshot left behind by a previous run (e.g. a participant named "Ваня"
// already present) makes the next run's join() fail with "name-taken",
// so the suite is flaky/non-repeatable. This script runs before build+start
// (see webServer.command) so each e2e run boots against an empty room.
//
// Note: a Playwright `globalSetup` hook is NOT a substitute for this —
// Playwright starts webServer plugins before running globalSetup, so by
// the time globalSetup would run, the server has already loaded the stale
// snapshot.
rmSync('./room-snapshot.json', { force: true });
