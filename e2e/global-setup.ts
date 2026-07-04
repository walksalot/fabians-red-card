import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Playwright global setup: rebuild BOTH deterministic e2e databases before the
 * tests run — .data/e2e.db (journey suite, pre-tournament) and .data/e2e2.db
 * (gameplay suite, mid-tournament). Seeding lives in plain Node ESM scripts
 * shared with manual runs.
 *
 * The webServer is already listening when this runs (Playwright starts it
 * first), so after seeding we warm the route compiler: `next dev` compiles a
 * route on its FIRST request, inside the first test's timeout budget. On a
 * fast dev machine that's invisible; on a 2-core CI runner the cold compile
 * of /join/[token] alone can eat the whole expect timeout and fail the run.
 * Warming here moves every cold compile outside any test's budget.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const root = path.resolve(__dirname, '..');
  for (const script of ['scripts/seed-e2e.mjs', 'scripts/seed-e2e2.mjs']) {
    const result = spawnSync('node', [script], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${script} exited with code ${result.status ?? 'unknown'}`);
    }
  }

  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;
  // Any token compiles the /join/[token] route — validity is irrelevant here,
  // and auth-gated pages (admin especially — the app's heaviest page, seen
  // blowing the reset-link test's expect budget on a cold 2-core CI runner)
  // still compile on an unauthenticated request. Sequential on purpose:
  // parallel compiles thrash a 2-core runner.
  const league = '/league/fabians-red-card';
  for (const route of [
    '/login',
    '/join/warmup-only',
    '/',
    `${league}/today`,
    `${league}/bracket`,
    `${league}/table`,
    `${league}/history`,
    `${league}/profile`,
    `${league}/rules`,
    `${league}/admin`,
    // API route modules compile on first request too — and a POST-only route
    // still compiles from a GET (it 405s AFTER compiling). The reset-link
    // route's first-ever hit lands mid-suite and flaked 404 three times on
    // loaded CI runners (dev server race on cold dynamic API routes).
    '/api/leagues/fabians-red-card/members/1/reset-link',
  ]) {
    try {
      await fetch(`${baseURL}${route}`);
    } catch {
      // warm-up is best-effort; a miss just means that route compiles in-test
    }
  }
}
