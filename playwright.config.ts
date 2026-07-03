import { defineConfig } from '@playwright/test';

/**
 * Journey e2e suite (pre-tournament). Mobile-dark (390x844) against a dev server
 * on port 3100, deterministic clock (FAKE_NOW 2026-06-10), dedicated SQLite db
 * (.data/e2e.db), live-feed scheduler disabled (hermetic, no real network).
 *
 * The mid-tournament gameplay suite runs separately
 * (playwright.gameplay.config.ts) so the two dev servers never run at once — two
 * `next dev` instances sharing one .next dir is unstable.
 */
const mobileDark = { viewport: { width: 390, height: 844 }, colorScheme: 'dark' as const };

export default defineConfig({
  testDir: 'e2e',
  testMatch: /journey\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  // NO retries even on CI: the serial journey re-registers the same username
  // on a retry against a database that is not reseeded between attempts, so a
  // retry is guaranteed red — it can never self-recover.
  retries: 0,
  // CI runners have 2 slow cores: give tests and assertions headroom there
  // (globalSetup pre-warms route compiles; this is belt-and-braces), and cap
  // the whole suite so a hang fails WITH artifacts instead of being killed by
  // the job-level timeout, which would skip the artifact upload.
  // Assertion headroom raised 15s → 30s after two same-shaped CI flakes in
  // one day (login redirect, reset-link flow): each was a single expect
  // starving on a cold runner while the test's 60s budget sat mostly unused.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  globalTimeout: process.env.CI ? 480_000 : 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'journey',
      use: { ...mobileDark, baseURL: 'http://localhost:3100' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3100',
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DB_PATH: '.data/e2e.db',
      FAKE_NOW: '2026-06-10T12:00:00Z',
      SESSION_SECRET: 'e2e-secret',
      SEED_LEAGUE_NAME: "Fabian's Red Card",
      SCHEDULER_DISABLED: '1',
    },
  },
});
