import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Playwright global setup: rebuild BOTH deterministic e2e databases before the
 * web servers boot — .data/e2e.db (journey suite, pre-tournament) and
 * .data/e2e2.db (gameplay suite, mid-tournament). Seeding lives in plain Node
 * ESM scripts shared with manual runs.
 */
export default function globalSetup(): void {
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
}
