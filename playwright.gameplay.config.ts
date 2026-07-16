import { defineConfig } from '@playwright/test';

/**
 * Mid-tournament gameplay e2e suite. Mobile-dark (390x844) against a local server
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
  // NO retries even on CI — mirrors the journey config: retried serial groups
  // replay writes against a database that is not reseeded between attempts.
  retries: 0,
  // CI headroom + suite cap: see playwright.config.ts for the reasoning.
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  globalTimeout: process.env.CI ? 720_000 : 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'gameplay',
      use: { ...mobileDark, baseURL: 'http://localhost:3200' },
    },
  ],
  webServer: {
    // Seed both fixture databases before boot so local runs never depend on
    // residue from another suite. Next's dev router intermittently returns its
    // 404 page for valid login POSTs, so gameplay runs against a production
    // build locally as well as in CI.
    command: process.env.CI
      ? 'node scripts/seed-e2e.mjs && node scripts/seed-e2e2.mjs && npm run start -- --port 3200'
      : 'node scripts/seed-e2e.mjs && node scripts/seed-e2e2.mjs && npm run build && npm run start -- --port 3200',
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
