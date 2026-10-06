// Screenshot library runner: boots the dev server once per scenario (each with
// its own throwaway DB + pinned FAKE_NOW), drives Playwright at phone size
// (390x844, dark, dsf2) and captures full-page PNGs into scratch/ui-review/shots.
// Today-board states are also captured at 768px wide.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const root = process.cwd(); // repo root
const OUT = path.join(root, 'scratch/ui-review/shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const SLUG = 'fabians-red-card';
const TODAY = `/league/${SLUG}/today`;

const phone = { viewport: { width: 390, height: 844 }, colorScheme: 'dark', baseURL: BASE, deviceScaleFactor: 2 };
const tablet = { viewport: { width: 768, height: 1024 }, colorScheme: 'dark', baseURL: BASE, deviceScaleFactor: 2 };

function startServer({ db, fakeNow }) {
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DB_PATH: db,
      FAKE_NOW: fakeNow,
      SESSION_SECRET: 'ui-review-secret',
      SCHEDULER_DISABLED: '1',
    },
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitReady(timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('dev server never became ready');
}

async function stopServer(child) {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 2_500));
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 1_000));
}

async function login(ctx, username, password) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username, password },
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`login ${username} failed: ${res.status()}`);
}

async function shoot(page, name, urlPath, { full = true, settle = 1200 } = {}) {
  await page.goto(urlPath, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log(`    ✓ ${name}`);
}

async function snap(page, name, { full = true } = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log(`    ✓ ${name}`);
}

const scenarios = [
  {
    name: 'A upcoming',
    db: 'scratch/ui-review/db/upcoming.db',
    fakeNow: '2026-06-11T16:00:00Z',
    async run(browser) {
      const ctx = await browser.newContext(phone);
      await login(ctx, 'sofia', 'demo-pass');
      const page = await ctx.newPage();
      await shoot(page, 'today-upcoming-390', TODAY);

      // scorer dropdown: expand the first saved pick, focus the scorer field
      await page.locator('form button').filter({ hasText: 'Edit' }).first().click();
      await page.waitForTimeout(400);
      await page.locator('[data-testid="pick-scorer"]').first().click();
      await page.waitForTimeout(1_200); // smooth scrollIntoView + panel
      await snap(page, 'today-scorer-dropdown-open-390', { full: false });
      await snap(page, 'today-scorer-dropdown-open-full-390');

      await shoot(page, 'today-future-day-390', `${TODAY}?day=2026-06-12`);

      // all-days picker sheet
      await page.goto(TODAY, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.waitForTimeout(800);
      await page.locator('[data-testid="day-picker"]').click();
      await page.waitForTimeout(700);
      await snap(page, 'today-day-picker-open-390', { full: false });
      await ctx.close();

      const ctx2 = await browser.newContext(tablet);
      await login(ctx2, 'sofia', 'demo-pass');
      const page2 = await ctx2.newPage();
      await shoot(page2, 'today-upcoming-768', TODAY);
      await ctx2.close();
    },
  },
  {
    name: 'B mixed (the commissioning screenshot scenario)',
    db: 'scratch/ui-review/db/mixed.db',
    fakeNow: '2026-06-12T22:00:00Z',
    async run(browser) {
      for (const [user, name] of [
        ['sofia', 'today-mixed-miss-390'],
        ['marcus', 'today-mixed-hit-exact-scorer-390'],
        ['chloe', 'today-mixed-scorer-hit-390'],
      ]) {
        const ctx = await browser.newContext(phone);
        await login(ctx, user, 'demo-pass');
        const page = await ctx.newPage();
        await shoot(page, name, TODAY);
        await ctx.close();
      }
      const ctx = await browser.newContext(tablet);
      await login(ctx, 'sofia', 'demo-pass');
      const page = await ctx.newPage();
      await shoot(page, 'today-mixed-768', TODAY);
      await ctx.close();
    },
  },
  {
    name: 'C all finished',
    db: 'scratch/ui-review/db/finished.db',
    fakeNow: '2026-06-12T06:00:00Z',
    async run(browser) {
      const ctx = await browser.newContext(phone);
      await login(ctx, 'sofia', 'demo-pass');
      const page = await ctx.newPage();
      await shoot(page, 'today-finished-390', TODAY);
      await ctx.close();
      const ctx2 = await browser.newContext(tablet);
      await login(ctx2, 'sofia', 'demo-pass');
      const page2 = await ctx2.newPage();
      await shoot(page2, 'today-finished-768', TODAY);
      await ctx2.close();
    },
  },
  {
    name: 'D live + member pages + admin + logged-out',
    db: 'scratch/ui-review/db/live.db',
    fakeNow: '2026-06-15T03:15:00Z',
    async run(browser) {
      // logged-out
      {
        const ctx = await browser.newContext(phone);
        const page = await ctx.newPage();
        await shoot(page, 'login-390', '/login');
        await shoot(page, 'register-390', '/register');
        await shoot(page, 'join-invite-390', '/join/demo-invite-2026');
        await ctx.close();
      }
      // member (sofia)
      {
        const ctx = await browser.newContext(phone);
        await login(ctx, 'sofia', 'demo-pass');
        const page = await ctx.newPage();
        await shoot(page, 'today-live-390', TODAY);
        await shoot(page, 'table-collapsed-390', `/league/${SLUG}/table`);
        await page.locator('[data-testid="leaderboard-row"]').first().click();
        await page.waitForTimeout(900);
        await snap(page, 'table-expanded-390');
        await page
          .locator('[data-testid="leaderboard-row"]')
          .last()
          .screenshot({ path: path.join(OUT, 'table-lastplace-redcard-390.png') });
        console.log('    ✓ table-lastplace-redcard-390');
        await shoot(page, 'rules-390', `/league/${SLUG}/rules`);
        await shoot(page, 'history-390', `/league/${SLUG}/history`);
        await shoot(page, 'profile-390', `/league/${SLUG}/profile`);
        await ctx.close();
      }
      // member at tablet width
      {
        const ctx = await browser.newContext(tablet);
        await login(ctx, 'sofia', 'demo-pass');
        const page = await ctx.newPage();
        await shoot(page, 'today-live-768', TODAY);
        await ctx.close();
      }
      // admin
      {
        const ctx = await browser.newContext(phone);
        await login(ctx, 'admin', 'demo-admin');
        const page = await ctx.newPage();
        await shoot(page, 'admin-full-390', `/league/${SLUG}/admin`);
        for (const [id, name] of [
          ['invite', 'admin-invite-390'],
          ['settings', 'admin-settings-390'],
          ['members', 'admin-members-390'],
          ['results', 'admin-results-entry-390'],
          ['fixtures', 'admin-knockout-teams-390'],
          ['underdog', 'admin-underdog-picker-390'],
        ]) {
          const loc = page.locator(`#${id}`);
          if ((await loc.count()) > 0) {
            await loc.screenshot({ path: path.join(OUT, `${name}.png`) });
            console.log(`    ✓ ${name}`);
          } else {
            console.log(`    ! section #${id} not found`);
          }
        }
        await ctx.close();
      }
    },
  },
  {
    name: 'E tie',
    db: 'scratch/ui-review/db/tie.db',
    fakeNow: '2026-06-15T03:15:00Z',
    async run(browser) {
      const ctx = await browser.newContext(phone);
      await login(ctx, 'sofia', 'demo-pass');
      const page = await ctx.newPage();
      await shoot(page, 'table-tie-390', `/league/${SLUG}/table`);
      await page.locator('[data-testid="leaderboard-row"]').nth(1).click();
      await page.waitForTimeout(900);
      await snap(page, 'table-tie-expanded-390');
      await ctx.close();
    },
  },
];

const only = process.argv[2]; // optional scenario letter filter, e.g. "D"
const browser = await chromium.launch();
for (const s of scenarios) {
  if (only && !s.name.startsWith(only)) continue;
  console.log(`\n=== ${s.name} (db=${s.db}, FAKE_NOW=${s.fakeNow}) ===`);
  const child = startServer(s);
  try {
    await waitReady();
    await s.run(browser);
  } finally {
    await stopServer(child);
  }
}
await browser.close();
console.log('\nAll scenarios captured.');
