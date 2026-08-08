import { expect, test, type Page } from '@playwright/test';

/**
 * Music Timeline (public/music/) e2e suite — the pass-the-phone party game,
 * served by scripts/music-server.mjs on port 4310 (playwright.music.config.ts
 * boots it). No database, no login: every test starts a real game through the
 * visible UI on a fresh browser context (= fresh localStorage), so tests are
 * hermetic and order-independent.
 *
 * Two deliberate seams keep the walkthroughs deterministic without ever
 * bypassing the UI:
 *   ?seed=N     pins the deck shuffle (ui.js startGame reads it)
 *   ?debug=1    exposes window.__timeline (ui.js init) — READ-ONLY here, used
 *               to assert engine phase and to compute a correct gap for the
 *               drawn card. All interaction is locator clicks/taps.
 */

type SeamCard = { year: number };
type SeamPlayer = { id: string; name: string; timeline: SeamCard[] };
type SeamState = {
  phase: string;
  turn: number;
  activeIndex: number;
  card: SeamCard | null;
  players: SeamPlayer[];
};

declare global {
  interface Window {
    /** Debug seam exposed by public/music/ui.js under ?debug=1. */
    __timeline?: { state: SeamState | null };
  }
}

/** The saved-game slot (storage.js NAMESPACE/VERSION/KEYS). */
const GAME_KEY = 'music-timeline:v1:game';

/** ui.js drops taps on Next player for ~700ms after the reveal renders. */
const REVEAL_TAP_GUARD_MS = 700;

async function expectScreen(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-screen', name);
}

function seamPhase(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__timeline?.state?.phase ?? null);
}

/**
 * Home → New game → two seats (photos skipped) → first-to-5 → Shuffle & start.
 * Lands on the pass (handoff) screen for turn 1. Names stay the defaults
 * ("Player 1", "Player 2") so assertions are deterministic.
 */
async function startTwoPlayerGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/index.html?debug=1&seed=${seed}`);
  await expectScreen(page, 'home');
  await page.locator('#btn-new-game').click();
  await expectScreen(page, 'setup');

  // A fresh profile ships four player rows; trim to two.
  const rows = page.locator('#player-list .player-row');
  await expect(rows).toHaveCount(4);
  for (const want of [3, 2]) {
    await rows.last().locator('[data-action="remove-player"]').click();
    await expect(rows).toHaveCount(want);
  }

  // Every seat needs a photo or an explicit "Skip photo" before Start enables.
  for (let i = 0; i < 2; i += 1) {
    const skip = rows.nth(i).locator('[data-action="skip-photo"]');
    await skip.click();
    await expect(skip).toHaveAttribute('aria-pressed', 'true');
  }

  // First-to-5 keeps the walkthrough short (target choices are 5/10/15).
  await page.locator('[data-action="target-dec"]').click();
  await expect(page.locator('#target-cards-value')).toHaveText('5');

  const start = page.locator('#btn-start-game');
  await expect(start).toBeEnabled();
  await start.click();
  await expectScreen(page, 'pass');
}

/**
 * The fast-flow handoff: ONE tap on the pass screen enters play AND draws the
 * card (ui.js 'pass-continue' → toggleAudio → ensureCard), so the engine phase
 * must leave 'turn-start' without any tap on the play screen — that is the
 * behavior under test, asserted through the read-only seam. The audio preview
 * itself may fail to load in a headless runner; the draw is synchronous and
 * does not depend on it.
 */
async function passTap(page: Page): Promise<void> {
  await expectScreen(page, 'pass');
  await page.locator('#btn-pass-continue').click();
  await expectScreen(page, 'play');
  await expect.poll(() => seamPhase(page)).toBe('listening');
}

/**
 * A gap index the engine accepts for the drawn card, computed from the seam
 * exactly the way engine.js insertionIndexFor does (equal years are legal on
 * both sides, so "after every earlier-or-equal card" is always correct).
 */
async function correctGapIndex(page: Page): Promise<number> {
  const gap = await page.evaluate(() => {
    const s = window.__timeline?.state;
    if (!s || !s.card) return null;
    const timeline = s.players[s.activeIndex].timeline;
    const year = s.card.year;
    let i = 0;
    while (i < timeline.length && timeline[i].year <= year) i += 1;
    return i;
  });
  if (gap === null) throw new Error('seam has no drawn card to place');
  return gap;
}

/** Tap the correct gap, then Place here; lands on the reveal. Returns the placed card's year. */
async function placeCorrectly(page: Page): Promise<number> {
  const gap = await correctGapIndex(page);
  const year = await page.evaluate(
    () => window.__timeline?.state?.card?.year ?? null,
  );
  await page.locator(`#timeline-strip .gap[data-gap-index="${gap}"]`).click();
  const place = page.locator('#btn-place');
  await expect(place).toBeEnabled();
  await place.click();
  await expectScreen(page, 'reveal');
  if (year === null) throw new Error('seam lost the card before placement');
  return year;
}

/** Wait out the reveal's double-tap guard, then tap Next player. */
async function nextFromReveal(page: Page): Promise<void> {
  await expect(page.locator('#btn-next-player')).toBeVisible();
  await page.waitForTimeout(REVEAL_TAP_GUARD_MS + 150);
  await page.locator('#btn-next-player').click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-screen',
    /^(pass|win)$/,
  );
}

test('classic 2-player game plays through to the win screen with zero page errors', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await startTwoPlayerGame(page, 4242);

  // Both seats start with one dealt card and place correctly every turn, so
  // Player 1 (first seat) reaches first-to-5 on their 4th turn — overall turn
  // 7. The loop cap only guards against a regression looping forever.
  let turnsPlayed = 0;
  for (let i = 0; i < 12; i += 1) {
    await passTap(page);
    const year = await placeCorrectly(page);
    turnsPlayed += 1;
    // The reveal must show the engine's card and call the placement right.
    await expect(page.locator('#reveal-year')).toHaveText(String(year));
    await expect(page.locator('#verdict-banner')).toHaveAttribute(
      'data-verdict',
      'correct',
    );
    await nextFromReveal(page);
    const screen = await page.locator('body').getAttribute('data-screen');
    if (screen === 'win') break;
  }

  await expectScreen(page, 'win');
  expect(turnsPlayed).toBe(7);
  await expect(page.locator('#win-eyebrow')).toHaveText(/winner/i);
  await expect(page.locator('#win-player-name')).toHaveText('Player 1');
  await expect(page.locator('#btn-play-again')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('double-tapping Place here does not skip the reveal', async ({ page }) => {
  await startTwoPlayerGame(page, 11);
  await passTap(page);

  const gap = await correctGapIndex(page);
  await page.locator(`#timeline-strip .gap[data-gap-index="${gap}"]`).click();
  const place = page.locator('#btn-place');
  await expect(place).toBeEnabled();
  await place.scrollIntoViewIfNeeded();
  const box = await place.boundingBox();
  if (!box) throw new Error('Place here has no bounding box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // A real double-tap: two taps at Place-here's exact coordinates ~150ms
  // apart. The first commits and reveals; Next player renders at those same
  // coordinates, so the second tap lands on it and must be dropped by the
  // reveal's tap guard instead of skipping the turn.
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  const secondTapLandsOn = await page.evaluate(
    ([cx, cy]) => {
      const node = document.elementFromPoint(cx, cy);
      const button = node === null ? null : node.closest('button');
      return button === null ? null : button.id;
    },
    [x, y] as const,
  );
  // Pin the hazard itself: Next player really does sit under the finger.
  expect(secondTapLandsOn).toBe('btn-next-player');
  await page.mouse.click(x, y);

  await expectScreen(page, 'reveal');
  await expect(page.locator('#btn-next-player')).toBeVisible();
  await expect(page.locator('#verdict-banner')).toBeVisible();
  expect(await seamPhase(page)).toBe('revealed');

  // The guard is a debounce, not a dead button: once it expires the same
  // button advances the game normally.
  await nextFromReveal(page);
});

test.describe('phone landscape (667x375)', () => {
  test.use({ viewport: { width: 667, height: 375 } });

  test('the vinyl play control is reachable and clickable', async ({
    page,
  }) => {
    await startTwoPlayerGame(page, 21);
    await passTap(page);

    const disc = page.locator('#btn-play-song');
    await expect(disc).toBeVisible();
    await disc.scrollIntoViewIfNeeded();
    const box = await disc.boundingBox();
    if (!box) throw new Error('play control has no bounding box');
    const hit = await page.evaluate(
      ([cx, cy]) => {
        const node = document.elementFromPoint(cx, cy);
        return node !== null && node.closest('#btn-play-song') !== null;
      },
      [box.x + box.width / 2, box.y + box.height / 2] as const,
    );
    // Nothing may sit on top of the control at its center once scrolled into
    // view — a fixed bar covering it is exactly the landscape bug this guards.
    expect(hit).toBe(true);

    // The definitive reachability check: a locator click requires the button
    // to be visible, stable, and to actually receive the pointer event.
    await disc.click();
    await expectScreen(page, 'play');
  });
});

test('a stale second tab cannot overwrite the newer tab', async ({
  context,
  page,
}) => {
  await startTwoPlayerGame(page, 33);

  // Tab A plays a full first turn, so the save slot holds real progress.
  await passTap(page);
  await placeCorrectly(page);
  await nextFromReveal(page);
  await expectScreen(page, 'pass'); // turn 2's handoff

  // Tab B (same context = same localStorage) resumes the same game and acts:
  // its draw writes the save slot, moving the write counter ahead of tab A's.
  const tabB = await context.newPage();
  await tabB.goto('/index.html?debug=1&seed=33');
  await expectScreen(tabB, 'home');
  await expect(tabB.locator('#btn-resume-game')).toBeVisible();
  await tabB.locator('#btn-resume-game').click();
  await expectScreen(tabB, 'pass');
  await passTap(tabB);

  const storedAfterB = await tabB.evaluate(
    (key) => localStorage.getItem(key),
    GAME_KEY,
  );
  expect(storedAfterB).not.toBeNull();

  // Tab A is now provably stale. Tap where its pass button sits: either the
  // cross-tab storage event already locked the tab (the overlay swallows the
  // tap) or the tap's own persist() sees the newer write counter and locks it
  // — both paths must end with the blocked overlay and NO write.
  const passBtn = page.locator('#btn-pass-continue');
  const box = await passBtn.boundingBox();
  if (!box) throw new Error('pass button has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator('#stale-overlay')).toBeVisible();
  await expect(page.locator('#btn-stale-reload')).toBeVisible();

  // The stored turn survives verbatim: byte-for-byte the payload tab B wrote.
  await page.waitForTimeout(400);
  const storedAfterTap = await tabB.evaluate(
    (key) => localStorage.getItem(key),
    GAME_KEY,
  );
  expect(storedAfterTap).toBe(storedAfterB);
  // ...and tab B is still mid-draw, untouched.
  expect(await seamPhase(tabB)).toBe('listening');
  await tabB.close();
});

test('fast flow auto-advances the reveal to the next handoff without a tap', async ({
  page,
}) => {
  await startTwoPlayerGame(page, 55);
  await passTap(page);
  await placeCorrectly(page);

  // The reveal arms the self-advance immediately (data-autonext also drives
  // the button's countdown drain in CSS)...
  await expect(page.locator('#btn-next-player')).toHaveAttribute(
    'data-autonext',
    'true',
  );
  // ...and AUTONEXT_MS later (15s in ui.js) the game must move itself to the
  // next player's pass screen with no further interaction.
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'pass', {
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__timeline?.state?.turn ?? null))
    .toBe(2);
  await expect(page.locator('#pass-player-name')).toHaveText('Player 2');
});
