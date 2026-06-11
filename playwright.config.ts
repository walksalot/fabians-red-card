import { defineConfig } from '@playwright/test';

/**
 * E2E suite: single mobile-dark project (390x844, dark scheme) against a dev
 * server on port 3100 with a deterministic clock (FAKE_NOW) and a dedicated
 * seeded SQLite database (.data/e2e.db, built by e2e/global-setup.ts).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'mobile-dark',
      use: {
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
        baseURL: 'http://localhost:3100',
      },
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
    },
  },
});
