// Captures every screen of the running app at a phone viewport (390x844, dark)
// for UI review. Logs in as a demo player for the member screens and as the
// admin for the admin screen. Saves PNGs to OUT_DIR (default .ui-shots).
//
// Usage: BASE_URL=http://localhost:3300 OUT_DIR=.ui-shots/iter-1 node scripts/screenshots.mjs
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3300';
const OUT = process.env.OUT_DIR ?? '.ui-shots';
const SLUG = 'fabians-red-card';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shoot(page, name, urlPath, { full = true, settle = 800 } = {}) {
  const res = await page.goto(urlPath, { waitUntil: 'networkidle' }).catch(() => null);
  await page.waitForTimeout(settle);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  const status = res ? res.status() : 'ERR';
  console.log(`  ${name.padEnd(16)} ${urlPath.padEnd(38)} [${status}] -> ${file}`);
}

async function loginVia(ctx, username, password) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username, password },
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`login ${username} failed: ${res.status()}`);
}

const opts = { viewport: { width: 390, height: 844 }, colorScheme: 'dark', baseURL: BASE };

// --- logged-out screens ---
{
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await shoot(page, '00-login', '/login');
  await shoot(page, '01-register', '/register');
  await shoot(page, '02-join-invite', '/join/demo-invite-2026');
  await ctx.close();
}

// --- player screens (Sofia, the leader) ---
{
  const ctx = await browser.newContext(opts);
  await loginVia(ctx, 'sofia', 'demo-pass');
  const page = await ctx.newPage();
  await shoot(page, '03-today', `/league/${SLUG}/today`);
  await shoot(page, '04-table', `/league/${SLUG}/table`);
  await shoot(page, '05-rules', `/league/${SLUG}/rules`);
  await shoot(page, '06-history', `/league/${SLUG}/history`);
  await shoot(page, '07-profile', `/league/${SLUG}/profile`);
  await ctx.close();
}

// --- admin screen ---
{
  const ctx = await browser.newContext(opts);
  await loginVia(ctx, 'admin', 'demo-admin');
  const page = await ctx.newPage();
  await shoot(page, '08-admin', `/league/${SLUG}/admin`);
  await ctx.close();
}

await browser.close();
console.log(`Done — screenshots in ${OUT}`);
