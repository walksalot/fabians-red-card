import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Mid-tournament gameplay suite — runs against the second e2e server
 * (port 3200, .data/e2e2.db, FAKE_NOW=2026-06-12T00:00:00Z):
 *   match 1 kicked off (locked, no result yet), match 2 open for picks.
 * World built by scripts/seed-e2e2.mjs; see its header for the cast.
 *
 * Note on invalid score input: the pick form uses native number constraints
 * (required, min=0, max=20, step=1), so the browser itself blocks 25 / 2.5 /
 * empty submissions before our handler runs — that native gate IS the client
 * error path. Server-side range rejection is covered by tests/unit/picks.test.ts.
 */

const BASE = 'http://localhost:3200';
const CONTEXT_OPTIONS = {
  viewport: { width: 390, height: 844 },
  colorScheme: 'dark' as const,
  baseURL: BASE,
};

test.describe.configure({ mode: 'serial' });

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await expect(page).toHaveURL(/\/league\/fabians-red-card\/today/);
}

test.describe('mid-tournament gameplay (mobile dark)', () => {
  let context: BrowserContext;
  let page: Page;
  let browserRef: Browser;

  test.beforeAll(async ({ browser }) => {
    browserRef = browser;
    context = await browser.newContext(CONTEXT_OPTIONS);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('kicked-off match is locked in the browser; upcoming match accepts a pick', async () => {
    await login(page, 'paula', 'e2e-paula-pass');

    const locked = page.getByTestId('pick-form-1');
    await expect(locked).toBeVisible();
    await expect(locked.getByText('Picks are locked for this match.')).toBeVisible();
    await expect(locked.getByText('In progress')).toBeVisible();
    await expect(locked.getByTestId('pick-save')).toHaveCount(0);

    const open = page.getByTestId('pick-form-2');
    await open.getByTestId('pick-home').fill('1');
    await open.getByTestId('pick-away').fill('1');
    await open.getByTestId('pick-scorer').fill('Heung-min Son');
    await open.getByTestId('pick-first-team').selectOption('away');
    await open.getByTestId('pick-save').click();
    await expect(open.getByText(/saved/i).first()).toBeVisible();
  });

  test('booster arms on the upcoming match and is unavailable on the kicked-off one', async () => {
    const open = page.getByTestId('pick-form-2');
    await open.getByTestId('booster-toggle').click();
    await expect(open.getByTestId('booster-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(open.getByTestId('booster-toggle')).toContainText(/booster ×\d+ active/i);

    // the kicked-off match can never take the booster
    await expect(page.getByTestId('pick-form-1').getByTestId('booster-toggle')).toBeDisabled();
  });

  test('admin enters a result in the browser and the leaderboard reorders with live points', async () => {
    const adminContext = await browserRef.newContext(CONTEXT_OPTIONS);
    const admin = await adminContext.newPage();
    await login(admin, 'admin', 'e2e-admin-pass');
    await admin.goto('/league/fabians-red-card/admin');

    await admin.getByTestId('result-home-1').fill('2');
    await admin.getByTestId('result-away-1').fill('1');
    await admin.getByTestId('result-scorer-1').fill('Raul Jimenez');
    await admin.getByTestId('result-firstteam-1').selectOption('home');
    await admin.getByTestId('result-save-1').click();
    await expect(admin.getByTestId('result-save-1')).toBeEnabled();
    await adminContext.close();

    // paula: exact (10) + scorer (8) + first team (2) = 20; victor: outcome (2) + first team (2) = 4
    await page.goto('/league/fabians-red-card/table');
    const rows = page.getByTestId('leaderboard-row');
    await expect(rows.first()).toContainText('Paula');
    await expect(rows.first()).toContainText('20');
    await expect(rows.nth(1)).toContainText('Victor');
    await expect(rows.nth(1)).toContainText('4');

    // history shows the result and the points paula earned
    await page.getByTestId('tab-history').click();
    await expect(page.getByText(/2\s*[–-]\s*1/).first()).toBeVisible();
    await expect(page.getByText(/20/).first()).toBeVisible();

    // profile reflects the exact-score hit
    await page.getByTestId('tab-profile').click();
    await expect(page.getByText(/exact/i).first()).toBeVisible();
  });

  test('a registered user joins the private league with the join password', async () => {
    const pennyContext = await browserRef.newContext(CONTEXT_OPTIONS);
    const penny = await pennyContext.newPage();

    // error visibility: taken username is rejected with a readable message
    await penny.goto('/register');
    await penny.getByTestId('auth-username').fill('paula');
    await penny.getByTestId('auth-displayname').fill('Imposter');
    await penny.getByTestId('auth-password').fill('whatever123');
    await penny.getByTestId('auth-submit').click();
    await expect(penny.getByText(/taken|exists|already/i).first()).toBeVisible();

    await penny.getByTestId('auth-username').fill('penny2');
    await penny.getByTestId('auth-displayname').fill('Penny Two');
    await penny.getByTestId('auth-password').fill('e2e-penny2-pass');
    await penny.getByTestId('auth-submit').click();
    await expect(penny).toHaveURL(/\/$|login|leagues/);

    // the league page offers the password door; wrong password shows an error
    await penny.goto('/league/fabians-red-card/today');
    await expect(penny.getByTestId('join-password')).toBeVisible();
    await penny.getByTestId('join-password').fill('wrongpass');
    await penny.getByTestId('join-submit').click();
    await expect(penny.getByText(/wrong|incorrect|invalid/i).first()).toBeVisible();

    await penny.getByTestId('join-password').fill('lockerroom');
    await penny.getByTestId('join-submit').click();
    await expect(penny.getByTestId('pick-form-2')).toBeVisible();
    await pennyContext.close();
  });
});
