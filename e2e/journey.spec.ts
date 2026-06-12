import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * The goal-mandated user journey on the 390px dark mobile viewport.
 *
 * One serial describe with a SHARED browser context/page: state (Daisy's
 * account, her pick, the admin's edits) builds up across the three tests.
 * Seed state comes from scripts/seed-e2e.mjs: league 'fabians-red-card'
 * (invite token e2e-invite-token-0001), users admin/e2e-admin-pass and
 * walter/e2e-walter-pass. FAKE_NOW=2026-06-10T12:00:00Z, so every match is
 * still open for picks.
 */

// Mirror of the 'mobile-dark' project options — needed because the shared
// context is created manually (browser.newContext ignores project `use`).
const CONTEXT_OPTIONS = {
  viewport: { width: 390, height: 844 },
  colorScheme: 'dark',
  baseURL: 'http://localhost:3100',
} as const;

test.describe('world cup pool journey (mobile dark)', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let page: Page;
  /** data-testid of the first pick form on Today, captured in test 1. */
  let firstPickFormTestId: string;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext(CONTEXT_OPTIONS);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('new user joins via invite link, sets display name, and submits a pick', async () => {
    await page.goto('/join/e2e-invite-token-0001');
    await expect(page.getByText("Fabian's Red Card").first()).toBeVisible();

    await page.getByTestId('auth-username').fill('daisy');
    await page.getByTestId('auth-displayname').fill('Daisy');
    await page.getByTestId('auth-password').fill('e2e-daisy-pass');
    await page.getByTestId('auth-submit').click();

    await expect(page).toHaveURL(/\/league\/fabians-red-card\/today/);

    const form = page.locator('[data-testid^="pick-form-"]').first();
    await expect(form).toBeVisible();
    firstPickFormTestId = (await form.getAttribute('data-testid')) ?? '';
    expect(firstPickFormTestId).toMatch(/^pick-form-\d+$/);

    await form.getByTestId('pick-home').fill('2');
    await form.getByTestId('pick-away').fill('1');
    // Scorer picks must be a full name from one of the two squads (rule change
    // 2026-06-12) — free text like 'Test Scorer' is now rejected client- and
    // server-side. First board match is #1 MEX–RSA; Ochoa is on the MEX squad.
    // Typing filters the squad dropdown; tapping the suggestion inserts the
    // full name and closes the panel (so it can't overlap the fields below).
    await form.getByTestId('pick-scorer').fill('Ochoa');
    await form
      .getByTestId('scorer-option')
      .filter({ hasText: 'Guillermo Ochoa' })
      .first()
      .click();
    await expect(form.getByTestId('pick-scorer')).toHaveValue('Guillermo Ochoa');
    await form.getByTestId('pick-first-team').selectOption('home');
    await form.getByTestId('pick-save').click();
    await expect(form.getByText(/saved/i).first()).toBeVisible();

    // Editing after a save must clear 'Saved ✓' — the badge may only ever
    // describe the values currently in the form (the server still has 2-1).
    await form.getByTestId('pick-home').fill('3');
    await expect(form.getByText(/saved/i)).toHaveCount(0);
    await form.getByTestId('pick-home').fill('2');
    await form.getByTestId('pick-save').click();
    await expect(form.getByText(/saved/i).first()).toBeVisible();

    // Entry-ownership barrier: requesting another member's entryId is refused
    // (entry 1 is the seeded admin's — rival picks must stay hidden pre-kickoff).
    const foreign = await page.request.get(
      '/api/leagues/fabians-red-card/today?entryId=1',
    );
    expect(foreign.status()).toBe(403);
    expect(((await foreign.json()) as { ok: boolean }).ok).toBe(false);

    await page.reload();
    const persisted = page.getByTestId(firstPickFormTestId);
    await expect(persisted.getByTestId('pick-home')).toHaveValue('2');
    await expect(persisted.getByTestId('pick-away')).toHaveValue('1');
    await expect(persisted.getByTestId('pick-scorer')).toHaveValue('Guillermo Ochoa');
    await expect(persisted.getByTestId('pick-first-team')).toHaveValue('home');
  });

  test('all five screens render', async () => {
    // Table: leaderboard rows (admin + walter + daisy), prize pool, member count
    await page.getByTestId('tab-table').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/table/);
    await expect(page.getByTestId('leaderboard-row').first()).toBeVisible();
    await expect
      .poll(() => page.getByTestId('leaderboard-row').count())
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('member-count')).toBeVisible();
    await expect(page.getByTestId('prize-pool')).toBeVisible();

    // Rules: scoring values from league settings + tiebreakers
    await page.getByTestId('tab-rules').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/rules/);
    await expect(page.locator('body')).toContainText('10');
    await expect(page.locator('body')).toContainText('8');
    await expect(page.locator('body')).toContainText('5');
    await expect(page.getByText(/tiebreak/i).first()).toBeVisible();

    // History: renders (empty state is fine — no finished matches yet)
    await page.getByTestId('tab-history').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/history/);
    await expect(page.getByTestId('tab-history')).toBeVisible();

    // Profile: display name + stats
    await page.getByTestId('tab-profile').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/profile/);
    await expect(page.getByText('Daisy').first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/pick|exact|streak|points/i);

    // Today: pick form still there
    await page.getByTestId('tab-today').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card\/today/);
    await expect(page.getByTestId(firstPickFormTestId)).toBeVisible();
  });

  test('admin settings flow', async () => {
    await context.clearCookies();

    // Login as the seeded admin
    await page.goto('/login');
    await page.getByTestId('auth-username').fill('admin');
    await page.getByTestId('auth-password').fill('e2e-admin-pass');
    await page.getByTestId('auth-submit').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card/);

    // Settings form
    await page.goto('/league/fabians-red-card/admin');
    await page.getByTestId('admin-name').fill('Fabian Cup');
    await page.getByTestId('admin-private').click();
    await page.getByTestId('admin-password').fill('newpass123');
    await page.getByTestId('admin-entries').fill('2');
    await page.getByTestId('admin-buyin').fill('20');

    const payout = page.getByTestId('admin-payout');
    if ((await payout.count()) >= 3) {
      await payout.nth(0).fill('50');
      await payout.nth(1).fill('30');
      await payout.nth(2).fill('20');
    } else {
      await payout.first().fill('50,30,20');
    }

    await page.getByTestId('admin-save').click();
    await expect(page.getByText(/saved|success|updated/i).first()).toBeVisible();

    // Remove walter (accept either a native confirm dialog or an in-page
    // confirm step that reuses the same button)
    const removeWalter = page.getByTestId('member-remove-walter');
    await expect(removeWalter).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await removeWalter.click();
    try {
      await removeWalter.click({ timeout: 2_000 });
    } catch {
      // no in-page confirm step — first click (plus dialog accept) was enough
    }
    await expect(page.getByTestId('member-remove-walter')).toHaveCount(0);

    // Table reflects the smaller league: 2 members left (admin + daisy)
    await page.goto('/league/fabians-red-card/table');
    await expect(page.getByTestId('member-count')).toContainText('2');
  });

  test('admin enters a result; points recompute onto the table and history', async () => {
    // Still signed in as the seeded admin from the previous test. Enter the
    // result that exactly matches daisy's pick from test 1 (2-1, 'Guillermo
    // Ochoa', home first): exact 10 + scorer 8 + first team 2 = 20.
    const matchId = Number(firstPickFormTestId.replace('pick-form-', ''));
    expect(Number.isInteger(matchId)).toBe(true);

    await page.goto('/league/fabians-red-card/admin');
    const resultForm = page.getByTestId(`result-form-${matchId}`);
    await resultForm.getByTestId(`result-home-${matchId}`).fill('2');
    await resultForm.getByTestId(`result-away-${matchId}`).fill('1');
    await resultForm.getByTestId(`result-scorer-${matchId}`).fill('Guillermo Ochoa');
    await resultForm
      .getByTestId(`result-firstteam-${matchId}`)
      .selectOption('home');
    await resultForm.getByTestId(`result-save-${matchId}`).click();
    await expect(resultForm.getByText(/saved/i).first()).toBeVisible();

    // Leaderboard recomputed automatically.
    await page.goto('/league/fabians-red-card/table');
    const daisyRow = page
      .getByTestId('leaderboard-row')
      .filter({ hasText: 'Daisy' });
    await expect(daisyRow).toBeVisible();
    await expect(daisyRow.getByTestId('row-total')).toHaveText('20');
    await expect(daisyRow.getByTestId('row-exact')).toHaveText('1'); // one exact score

    // History, as daisy, shows the result and the full points breakdown.
    await context.clearCookies();
    await page.goto('/login');
    await page.getByTestId('auth-username').fill('daisy');
    await page.getByTestId('auth-password').fill('e2e-daisy-pass');
    await page.getByTestId('auth-submit').click();
    await expect(page).toHaveURL(/\/league\/fabians-red-card/);

    await page.goto('/league/fabians-red-card/history');
    const historyItem = page.getByTestId(`history-match-${matchId}`);
    await expect(historyItem).toBeVisible();
    await expect(historyItem).toContainText('2–1');
    await expect(historyItem).toContainText('Guillermo Ochoa');
    await expect(historyItem).toContainText('+20 pts');
    await expect(historyItem).toContainText('Exact +10');
    await expect(historyItem).toContainText('Scorer +8');
    await expect(historyItem).toContainText('First team +2');
  });
});
