import { defineConfig } from '@playwright/test';

/**
 * Mid-tournament gameplay e2e suite. Mobile-dark (390x844) against a dev server
 * on port 3200, deterministic clock (FAKE_NOW 2026-06-12 — match 1 has kicked
 * off and is locked, match 2 is open), dedicated SQLite db (.data/e2e2.db),
 * live-feed scheduler disabled. Runs after the journey suite (separate config)
 * so the two dev servers never run concurrently.
 */
const mobileDark = { viewport: { width: 390, height: 844 }, colorScheme: 'dark' as const };

export default defineConfig({
  testDir: 'e2e',
  testMatch: /gameplay\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'gameplay',
      use: { ...mobileDark, baseURL: 'http://localhost:3200' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3200',
    port: 3200,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DB_PATH: '.data/e2e2.db',
      FAKE_NOW: '2026-06-12T00:00:00Z',
      SESSION_SECRET: 'e2e-secret',
      SEED_LEAGUE_NAME: "Fabian's Red Card",
      SCHEDULER_DISABLED: '1',
    },
  },
});
