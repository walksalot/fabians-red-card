import { defineConfig } from '@playwright/test';

/**
 * Music Timeline e2e suite (public/music/, the pass-the-phone party game).
 * Phone-portrait (393x852) against the game's own zero-dependency static
 * server (scripts/music-server.mjs) on port 4310 — no database, no Next
 * build. Tests are hermetic: each gets a fresh browser context, so game
 * state (localStorage) never leaks between them.
 *
 * Runs as its own CI step after the journey and gameplay suites (separate
 * configs, ports 3100/3200) so the local servers never run concurrently.
 * NOTE: music-server.mjs steps to the NEXT port when its own is busy while
 * Playwright keeps polling 4310 — kill any leftover music server before a
 * local run so the readiness check watches the right process.
 */
const phonePortrait = { viewport: { width: 393, height: 852 } };

export default defineConfig({
  testDir: 'e2e',
  testMatch: /music\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  // NO retries even on CI — mirrors the other suites' stance: these tests are
  // hermetic (fresh context per test), so a retry would only hide real flake.
  retries: 0,
  // CI headroom on 2 slow cores, as in playwright.config.ts. Local budget is
  // wider than the league suites' 30s because the full-game walkthrough taps
  // through seven turns and the auto-advance test deliberately waits ~15s.
  timeout: process.env.CI ? 90_000 : 45_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  // Suite cap: five static-page tests fit comfortably in 5 minutes, and the
  // three suites' caps together (12 + 12 + 5) must stay under the CI job's
  // timeout-minutes (30) so Playwright's cap — which preserves failure
  // traces — always fires before the job-level kill.
  globalTimeout: process.env.CI ? 300_000 : 0,
  reporter: 'list',
  projects: [
    {
      name: 'music',
      use: { ...phonePortrait, baseURL: 'http://127.0.0.1:4310' },
    },
  ],
  webServer: {
    // The static server needs no seeding and no build — identical command on
    // CI and locally. Readiness polls the game shell itself.
    command: 'node scripts/music-server.mjs --port 4310',
    url: 'http://127.0.0.1:4310/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
