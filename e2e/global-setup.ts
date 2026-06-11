import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Playwright global setup: rebuild the deterministic e2e database before the
 * web server boots. The actual seeding lives in scripts/seed-e2e.mjs (plain
 * Node ESM, shared with manual runs).
 */
export default function globalSetup(): void {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync('node', ['scripts/seed-e2e.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DB_PATH: '.data/e2e.db' },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`scripts/seed-e2e.mjs exited with code ${result.status ?? 'unknown'}`);
  }
}
