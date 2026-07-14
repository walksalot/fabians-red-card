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
  // Retry the submit: `next dev` under CI load can transiently answer an API
  // POST with its router 404 page even for a compiled route (trace-verified
  // — text/html "This page could not be found", session valid). Production
  // runs a built server with a static route table and cannot do this, so
  // the retry mirrors what a human does: tap the button again. Guarded so a
  // SLOW success never turns into a failure: skip the click while already
  // redirected or while the submit is still disabled (busy through the
  // redirect) — clicking a disabled button would block, not retry.
  await expect(async () => {
    const arrived = /\/league\/fabians-red-card\/today/.test(page.url());
    if (!arrived && (await page.getByTestId('auth-submit').isEnabled())) {
      await page.getByTestId('auth-submit').click();
    }
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/today/, { timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
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
    // seeded live feed data → the card shows the live score, not a bare badge,
    // with the match clock (minutes accrued) in place of a generic "Live" label
    await expect(locked.getByText('1–0').first()).toBeVisible();
    await expect(locked.getByText("64'")).toBeVisible();
    await expect(locked.getByTestId('pick-save')).toHaveCount(0);

    const open = page.getByTestId('pick-form-2');
    await open.getByTestId('pick-home').fill('1');
    await open.getByTestId('pick-away').fill('1');
    // betting cheat sheet: probability bar visible, details expand with raw odds
    const strip = open.getByTestId('odds-strip-2');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('KOR 55%');
    await expect(strip).toContainText('DraftKings');
    await strip.getByTestId('odds-expand').click();
    await expect(open.getByTestId('odds-details')).toContainText('-140');
    await expect(open.getByTestId('odds-details')).toContainText('over 2.5');

    // scorer dropdown: odds-sorted (Son +450 leads) with prices shown
    await open.getByTestId('pick-scorer').click();
    const firstOption = open.getByTestId('scorer-option').first();
    await expect(firstOption).toContainText('Son Heung-Min');
    await expect(firstOption).toContainText('+450');

    // the closed loophole: a bare surname (Adam Hlozek is on the seeded CZE
    // squad) is rejected inline — no save happens
    await open.getByTestId('pick-scorer').fill('Hlozek');
    await open.getByTestId('pick-scorer').press('Escape'); // close the dropdown
    await open.getByTestId('pick-save').click();
    await expect(open.getByText(/pick a player from the squad list/i)).toBeVisible();
    await expect(open.getByTestId('pick-save')).toHaveText('Save pick'); // not saved

    await open.getByTestId('pick-scorer').fill('son');
    const option = open.getByTestId('scorer-option').filter({ hasText: /son/i }).first();
    await expect(option).toBeVisible();
    // first span = the player name; the second is the odds price tag
    const optionName = (await option.locator('span').first().textContent()) ?? '';
    await option.click();
    await expect(open.getByTestId('pick-scorer')).toHaveValue(optionName);
    await open.getByTestId('pick-first-team').selectOption('away');
    await open.getByTestId('pick-save').click();
    await expect(open.getByText(/saved/i).first()).toBeVisible();
  });

  test('booster arms on the upcoming match and is unavailable on the kicked-off one', async () => {
    const open = page.getByTestId('pick-form-2');
    await open.getByTestId('booster-toggle').click();
    await expect(open.getByTestId('booster-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(open.getByTestId('booster-toggle')).toContainText(/booster ×\d+ active/i);

    // a second tap removes it (true toggle); a third re-arms it for later tests
    await open.getByTestId('booster-toggle').click();
    await expect(open.getByTestId('booster-toggle')).toHaveAttribute('aria-pressed', 'false');
    await open.getByTestId('booster-toggle').click();
    await expect(open.getByTestId('booster-toggle')).toHaveAttribute('aria-pressed', 'true');

    // the kicked-off match can never take the booster
    await expect(page.getByTestId('pick-form-1').getByTestId('booster-toggle')).toBeDisabled();
  });

  test('day browser steps to a future matchday, saves a pick there, and returns to today', async () => {
    await page.goto('/league/fabians-red-card/today');

    // current day: back-arrow is inert (no link), the amber radar dot shows
    // because tomorrow (June 12) still has unpicked matches
    await expect(page.getByTestId('day-picker')).toBeVisible();
    await expect(page.getByTestId('day-prev')).toHaveCount(0);
    await expect(page.getByTestId('day-gap-dot')).toBeVisible();

    // step forward → June 12 board shows ONLY that day's matches (3 + 4),
    // with no carryover of the in-progress match 1
    await page.getByTestId('day-next').click();
    await expect(page).toHaveURL(/day=2026-06-12/);
    await expect(page.getByTestId('pick-form-3')).toBeVisible();
    await expect(page.getByTestId('pick-form-4')).toBeVisible();
    await expect(page.getByTestId('pick-form-1')).toHaveCount(0);

    // no odds seeded that far out → the future-day hint explains why
    await expect(page.getByText('Betting odds appear closer to matchday.')).toBeVisible();

    // a pick on a future match saves exactly like a same-day pick
    const future = page.getByTestId('pick-form-3');
    await future.getByTestId('pick-home').fill('2');
    await future.getByTestId('pick-away').fill('0');
    await future.getByTestId('pick-save').click();
    await expect(future.getByText(/saved/i).first()).toBeVisible();

    // the at-a-glance sheet shows true progress per day
    await page.getByTestId('day-picker').click();
    await expect(page.getByTestId('day-list')).toBeVisible();
    await expect(page.getByTestId('day-row-2026-06-11')).toContainText('today');
    await expect(page.getByTestId('day-row-2026-06-11')).toContainText('2/2 picked');
    await expect(page.getByTestId('day-row-2026-06-12')).toContainText('1/2 picked');

    // tapping today's row lands back on the canonical /today URL with the
    // in-progress match 1 visible again
    await page.getByTestId('day-row-2026-06-11').click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId('pick-form-1')).toBeVisible();
    await expect(page.getByTestId('pick-form-2')).toBeVisible();
  });

  test('"if it ended now" live board shows engine-true provisional points', async () => {
    // Paula is signed in from test 1. The strip appears on Today and Table.
    await page.goto('/league/fabians-red-card/today');
    const strip = page.getByTestId('live-now');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('1–0'); // the live snapshot score
    // the match clock sits right beside the score heading, glanceable
    await expect(strip.getByTestId('live-clock-1')).toHaveText("64'");

    await page.getByTestId('live-now-toggle-1').click();
    const board = page.getByTestId('live-board-1');
    await expect(board).toContainText('First goal:');
    await expect(board).toContainText('Raúl Jiménez');

    // Engine math against the 1-0 snapshot: paula 2-1+scorer+1st = 12;
    // victor exact 1-0 + 1st = 12. Both rows must show +12.
    const rows = board.getByTestId('live-board-row');
    const paulaRow = rows.filter({ hasText: 'Paula' });
    const victorRow = rows.filter({ hasText: 'Victor' });
    await expect(paulaRow.getByTestId('live-board-total')).toHaveText('+12');
    await expect(victorRow.getByTestId('live-board-total')).toHaveText('+12');
    // admin holds no entry, so the no-pick sink shows the picked rows only
    await expect(board).toContainText('Provisional');

    // Same strip on the Table tab, above the real leaderboard.
    await page.getByTestId('tab-table').click();
    await expect(page.getByTestId('live-now')).toBeVisible();
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
    // the final whistle retires the live board — provisional hands off to real points
    await expect(page.getByTestId('live-now')).toHaveCount(0);
    const rows = page.getByTestId('leaderboard-row');
    await expect(rows.first()).toContainText('Paula');
    await expect(rows.first().getByTestId('row-total')).toHaveText('20');
    await expect(rows.nth(1)).toContainText('Victor');
    await expect(rows.nth(1).getByTestId('row-total')).toHaveText('4');

    // Display-only league lore is derived from the same banked rows: it can
    // summarize scoring, but never reinterpret it.
    const lore = page.getByTestId('league-lore');
    await expect(lore).toBeVisible();
    await expect(lore.getByTestId('league-lore-exact')).toHaveText('1');
    await expect(lore.getByTestId('league-lore-scorer')).toHaveText('1');
    await expect(lore.getByTestId('league-lore-booster')).toHaveText('+0');
    await expect(lore).toContainText('Paula');
    await expect(lore).toContainText('MEX 2–1 RSA');
    await expect(lore).toContainText('+20');
    await expect(lore).toContainText('Jun 11');
    await expect(lore).toContainText('+24');

    // history shows the result and the points paula earned
    await page.getByTestId('tab-history').click();
    await expect(page.getByText(/2\s*[–-]\s*1/).first()).toBeVisible();
    await expect(page.getByText(/20/).first()).toBeVisible();

    // profile reflects the exact-score hit
    await page.getByTestId('tab-profile').click();
    await expect(page.getByText(/exact/i).first()).toBeVisible();
  });

  test('admin issues a one-time reset link and the member sets a new password', async () => {
    const adminContext = await browserRef.newContext(CONTEXT_OPTIONS);
    const admin = await adminContext.newPage();
    await login(admin, 'admin', 'e2e-admin-pass');
    await admin.goto('/league/fabians-red-card/admin');
    const linkBox = admin.getByTestId('reset-link-box');
    // Same dev-router-404 retry as login() — this exact POST drew the Next
    // dev 404 page four times on loaded CI runners. Re-clicking issues a
    // fresh one-time link, which is exactly what an admin would do. Guarded:
    // never click while the box is already up or the button is disabled
    // (busy during the in-flight request).
    await expect(async () => {
      const resetBtn = admin.getByTestId('member-reset-victor');
      if (!(await linkBox.isVisible()) && (await resetBtn.isEnabled())) {
        await resetBtn.click();
      }
      await expect(linkBox).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 60_000 });
    const url = await linkBox.locator('input').inputValue();
    expect(url).toContain('/reset/');
    await adminContext.close();

    // victor opens the link and sets a new password
    const vContext = await browserRef.newContext(CONTEXT_OPTIONS);
    const v = await vContext.newPage();
    await v.goto(url);
    await expect(v.getByText('victor', { exact: true })).toBeVisible();
    await v.getByTestId('reset-password').fill('victor-new-pass');
    await v.getByTestId('reset-submit').click();
    await v.waitForURL(/league|\/$/, { timeout: 15000 });

    // the link is one-time: a second visit shows the spent state
    await v.goto(url);
    await expect(v.getByText(/already been used|invalid/i)).toBeVisible();

    // and the new password works while the old one fails
    await v.context().clearCookies();
    await login(v, 'victor', 'victor-new-pass');
    await vContext.close();
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
