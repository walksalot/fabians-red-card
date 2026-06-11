// Production acceptance checks against the LIVE deployment. Non-destructive by
// design: creates one disposable test user via the real invite link, exercises
// the full player flow, round-trips a result on match 104 (the July final — no
// picks exist), then cleans everything up so the league is pristine for launch.
//
// PHASE=1  create test user via UI, submit+verify pick, arm booster, render all screens
// PHASE=2  (after a container restart) verify data persisted, result round-trip,
//          calendar feed, cleanup test user, final member count == 1
//
// Env: BASE_URL, ADMIN_PASSWORD, INVITE_TOKEN, PHASE
// State between phases: /tmp/wc-prod-state.json
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const INVITE_TOKEN = process.env.INVITE_TOKEN;
const PHASE = process.env.PHASE ?? '1';
const STATE = '/tmp/wc-prod-state.json';
const SLUG = 'fabians-red-card';
if (!BASE || !ADMIN_PASSWORD || !INVITE_TOKEN) {
  console.error('need BASE_URL, ADMIN_PASSWORD, INVITE_TOKEN');
  process.exit(2);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') ?? '' };
}

function sessionOf(setCookie) {
  const m = /wc_session=[^;]+/.exec(setCookie);
  return m ? m[0] : null;
}

const mobile = { viewport: { width: 390, height: 844 }, colorScheme: 'dark' };

if (PHASE === '1') {
  const username = `testfriend${Date.now() % 100000}`;
  const password = 'verify-pass-2026';

  // 1. public pages up
  const login = await fetch(`${BASE}/login`);
  check('login page serves 200 over HTTPS', login.status === 200);
  const joinPage = await fetch(`${BASE}/join/${INVITE_TOKEN}`);
  const joinHtml = await joinPage.text();
  check('invite link page renders league + signup form',
    joinPage.status === 200 && joinHtml.includes('auth-username'));

  // 2. full player journey in a real browser
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(`/join/${INVITE_TOKEN}`);
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-displayname').fill('Verify Bot');
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL(/\/league\/fabians-red-card\/today/, { timeout: 20000 });
  check('new user joins via invite link and lands on Today', true);

  const form = page.locator('[data-testid^="pick-form-"]').filter({ has: page.getByTestId('pick-save') }).first();
  await form.waitFor({ timeout: 15000 });
  const formId = await form.getAttribute('data-testid');
  const matchId = Number(formId.replace('pick-form-', ''));
  await form.getByTestId('pick-home').fill('2');
  await form.getByTestId('pick-away').fill('1');
  await form.getByTestId('pick-scorer').fill('Prod Verify');
  await form.getByTestId('pick-first-team').selectOption('home');
  await form.getByTestId('pick-save').click();
  await page.getByText(/saved/i).first().waitFor({ timeout: 15000 });
  await page.reload();
  const persisted = page.getByTestId(formId);
  const homeVal = await persisted.getByTestId('pick-home').inputValue();
  check('pick submits and persists after reload', homeVal === '2', `match ${matchId}`);

  const booster = persisted.getByTestId('booster-toggle');
  await booster.click();
  let boosterOk = false;
  for (let i = 0; i < 20; i++) {
    if ((await booster.getAttribute('aria-pressed')) === 'true') { boosterOk = true; break; }
    await page.waitForTimeout(500);
  }
  check('booster arms on an upcoming match', boosterOk);

  for (const tab of ['table', 'rules', 'history', 'profile']) {
    await page.getByTestId(`tab-${tab}`).click();
    await page.waitForURL(new RegExp(`/${tab}`), { timeout: 15000 });
  }
  check('all five screens render on production', true);
  await page.screenshot({ path: '.ui-shots/prod-today.png', fullPage: false }).catch(() => {});
  await browser.close();

  fs.writeFileSync(STATE, JSON.stringify({ username, password, matchId }));
} else {
  const { username, password, matchId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));

  // 3. data survives a container restart (volume persistence)
  const friend = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  const friendCookie = sessionOf(friend.setCookie);
  check('test user can log in after restart (volume persists accounts)', friend.status === 200 && !!friendCookie);
  const me = await api('/api/me', { cookie: friendCookie });
  const friendUserId = me.json?.data?.user?.id;
  check('session + league membership intact after restart', me.status === 200 && !!friendUserId);

  // their pick still exists: today board shows it via the entry — use leaderboard lastPick instead:
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...mobile, baseURL: BASE });
  await ctx.addCookies([{ name: 'wc_session', value: friendCookie.split('=')[1], url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`/league/${SLUG}/today`);
  const val = await page.getByTestId(`pick-form-${matchId}`).getByTestId('pick-home').inputValue();
  check('pick survives a container restart (volume persists picks)', val === '2');
  await browser.close();

  // 4. admin: result entry + edit/revert round-trip on the July final (no picks exist)
  const admin = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
  const adminCookie = sessionOf(admin.setCookie);
  check('admin login works with handoff credentials', admin.status === 200 && !!adminCookie);

  const enter = await api('/api/results', {
    method: 'POST', cookie: adminCookie,
    body: { matchId: 104, homeScore: 2, awayScore: 1, firstScorer: 'Round Trip', firstScoringTeam: 'home' },
  });
  check('admin can enter a result (no API key required)', enter.status === 200 && enter.json?.ok === true);
  const edit = await api('/api/results', {
    method: 'POST', cookie: adminCookie,
    body: { matchId: 104, homeScore: 3, awayScore: 1, firstScorer: 'Round Trip', firstScoringTeam: 'home' },
  });
  check('admin can edit a result', edit.status === 200 && edit.json?.data?.match?.homeScore === 3 || edit.json?.ok === true);
  const clear = await api('/api/results/clear', { method: 'POST', cookie: adminCookie, body: { matchId: 104 } });
  check('admin can clear the result (league left untouched)', clear.status === 200 && clear.json?.ok === true);

  // 5. calendar feed
  const cal = await fetch(`${BASE}/api/calendar`);
  const ics = await cal.text();
  const events = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  check('calendar feed serves 104 match events', cal.status === 200 && events === 104, `${events} VEVENTs`);

  // 6. cleanup: remove the test user; league back to admin-only
  const remove = await api(`/api/leagues/${SLUG}/members/${friendUserId}`, { method: 'DELETE', cookie: adminCookie });
  check('admin can remove a member', remove.status === 200 && remove.json?.ok === true);
  const board = await api(`/api/leagues/${SLUG}/leaderboard`, { cookie: adminCookie });
  check('league is clean for launch (1 member: admin)', board.json?.data?.memberCount === 1, `memberCount=${board.json?.data?.memberCount}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (phase ${PHASE})`);
process.exit(failed.length ? 1 : 0);
