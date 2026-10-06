// Addendum: the LiveNow "if it ended now" provisional board EXPANDED on the
// Today page (scenario D world: live.db, FAKE_NOW=2026-06-15T03:15:00Z).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const root = process.cwd();
const OUT = path.join(root, 'scratch/ui-review/shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const TODAY = '/league/fabians-red-card/today';

const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    DB_PATH: 'scratch/ui-review/db/live.db',
    FAKE_NOW: '2026-06-15T03:15:00Z',
    SESSION_SECRET: 'ui-review-secret',
    SCHEDULER_DISABLED: '1',
  },
});

const deadline = Date.now() + 150_000;
for (;;) {
  try {
    const res = await fetch(`${BASE}/login`);
    if (res.ok) break;
  } catch { /* booting */ }
  if (Date.now() > deadline) throw new Error('server never ready');
  await new Promise((r) => setTimeout(r, 1_000));
}

const browser = await chromium.launch();
for (const [vp, suffix] of [
  [{ width: 390, height: 844 }, '390'],
  [{ width: 768, height: 1024 }, '768'],
]) {
  const ctx = await browser.newContext({
    viewport: vp, colorScheme: 'dark', baseURL: BASE, deviceScaleFactor: 2,
  });
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'sofia', password: 'demo-pass' },
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
  const page = await ctx.newPage();
  await page.goto(TODAY, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(1_000);
  await page.locator('[data-testid="live-now-toggle-12"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, `today-live-board-expanded-${suffix}.png`),
    fullPage: true,
  });
  console.log(`✓ today-live-board-expanded-${suffix}`);
  await ctx.close();
}
await browser.close();
try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
await new Promise((r) => setTimeout(r, 2_000));
try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
console.log('done');
