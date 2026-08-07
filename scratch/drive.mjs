// Throwaway walkthrough: drives a full 4-player game at phone widths and
// screenshots every screen. Delete when the feature is verified.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SCRATCH =
  '/tmp/claude-0/-home-user-fabians-red-card/476991f1-de30-5fa0-b39f-64afae68c8e3/scratchpad';
const OUT = `${SCRATCH}/shots`;
const PHOTOS = `${SCRATCH}/photos`;
const BASE = 'http://127.0.0.1:4174/music/index.html?debug=1';

mkdirSync(OUT, { recursive: true });

const problems = [];
const note = (m) => {
  problems.push(m);
  console.log('  !! ' + m);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') note(`console error: ${m.text()}`);
});
page.on('pageerror', (e) => note(`page error: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) note(`HTTP ${r.status()} ${r.url()}`);
});
page.on('requestfailed', (r) => {
  const url = r.url();
  if (url.includes('itunes.apple.com')) return; // no network in this sandbox
  note(`request failed: ${url} ${r.failure()?.errorText}`);
});

const FULL = new Set(['setup-needed', 'setup-ready', 'reveal', 'scoreboard', 'rules']);

async function overflowCheck(tag) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
  }));
  if (m.sw > m.cw) note(`horizontal overflow @ ${tag}: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  if (m.bw > m.cw) note(`body overflow @ ${tag}: ${m.bw} > ${m.cw}`);
}

async function shot(name) {
  for (const [w, h] of [
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(260);
    await overflowCheck(`${name}@${w}`);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: FULL.has(name) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(160);
  console.log(`  shot ${name}`);
}

const peek = () =>
  page.evaluate(() => {
    const t = window.__timeline;
    const s = t && t.state;
    if (!s) return { screen: t ? t.view.screen : null, phase: null };
    const active = s.players[s.activeIndex];
    const timeline = s.mode === 'coop' ? s.sharedTimeline : active.timeline;
    return {
      screen: t.view.screen,
      phase: s.phase,
      turn: s.turn,
      activeId: active.id,
      activeName: active.name,
      activeColor: active.color,
      hasPhoto: !!active.photo,
      years: timeline.map((c) => c.year),
      cardYear: s.card ? s.card.year : null,
      counts: s.players.map((p) => p.timeline.length),
      over: s.phase === 'game-over',
    };
  });

function correctGaps(years, year) {
  const out = [];
  for (let i = 0; i <= years.length; i += 1) {
    const left = i === 0 || year >= years[i - 1];
    const right = i === years.length || year <= years[i];
    if (left && right) out.push(i);
  }
  return out;
}

/* ------------------------------------------------------------------ setup */
console.log('== setup');
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.click('#btn-new-game');
await page.waitForSelector('#setup .player-row');

const NAMES = ['Ann', 'Bo', 'Cy', 'Grandma'];
for (let i = 0; i < NAMES.length; i += 1) {
  await page.fill(`#player-name-${i}`, NAMES[i]);
}
// Five cards to win, so the walkthrough reaches a real win screen rather than
// an "End game" consolation one.
await page.click('[data-action="target-dec"]');
await page.waitForTimeout(120);

const startBefore = await page.isDisabled('#btn-start-game');
console.log(`  start disabled before photos: ${startBefore}`);
if (!startBefore) note('Start was enabled before anyone had a photo');
console.log(`  reason: ${await page.textContent('#setup-photo-reason')}`);
await shot('setup-needed');

const FILES = ['photo-ann.png', 'photo-bo.png', 'photo-cy.png'];
for (let i = 0; i < FILES.length; i += 1) {
  await page
    .locator('#player-list > li')
    .nth(i)
    .locator('input[data-role="player-photo"]')
    .setInputFiles(`${PHOTOS}/${FILES[i]}`);
  await page.waitForSelector(`#player-list > li:nth-child(${i + 1})[data-photo-state="photo"]`);
}
const startMid = await page.isDisabled('#btn-start-game');
console.log(`  start still disabled with one player left: ${startMid}`);
if (!startMid) note('Start was enabled while a player still had no photo');
console.log(`  reason: ${await page.textContent('#setup-photo-reason')}`);

// The escape hatch.
await page.locator('#player-list > li').nth(3).locator('[data-action="skip-photo"]').click();
await page.waitForSelector('#player-list > li:nth-child(4)[data-photo-state="skipped"]');
const startAfter = await page.isDisabled('#btn-start-game');
console.log(`  start enabled after the skip: ${!startAfter}`);
if (startAfter) note('Start stayed disabled after every player was resolved');

const photoBytes = await page.evaluate(() =>
  window.__timeline.view.setup.players.map((p) => (p.photo ? p.photo.length : 0)),
);
console.log(`  stored photo data URL lengths: ${photoBytes.join(', ')}`);
await shot('setup-ready');

/* ------------------------------------------------------------------- play */
console.log('== game');
await page.click('#btn-start-game');
await page.waitForSelector('body[data-screen="pass"]');
await shot('pass');

let challengeShotDone = false;
let revealShotDone = false;
let playShotDone = false;
let scoreShotDone = false;

for (let guard = 0; guard < 120; guard += 1) {
  const s = await peek();
  if (s.over) break;

  if (s.screen === 'pass') {
    await page.click('#btn-pass-continue');
    await page.waitForSelector('body[data-screen="play"]');
    continue;
  }

  if (s.screen === 'play') {
    // Tapping a gap is what draws the card (buying stays open until then).
    await page.click('#timeline-strip .gap');
    const drawn = await peek();

    if (!playShotDone) {
      await shot('play');
      playShotDone = true;
    }

    // The scoreboard lives behind the play-screen menu, and it is worth seeing
    // once a couple of people have cards.
    if (!scoreShotDone && drawn.turn >= 3) {
      await page.click('#btn-menu');
      await page.waitForSelector('#menu-sheet[data-open="true"]');
      await page.click('#btn-menu-scoreboard');
      await page.waitForSelector('body[data-screen="scoreboard"]');
      await page.waitForTimeout(200);
      await shot('scoreboard');
      await page.click('#btn-scoreboard-back');
      await page.waitForSelector('body[data-screen="play"]');
      scoreShotDone = true;
    }

    if (!challengeShotDone && drawn.turn >= 2) {
      await page.click('#btn-challenge');
      await page.waitForSelector('#challenge-sheet[data-open="true"]');
      await page.waitForTimeout(200);
      await shot('challenge');
      const option = page.locator('#challenge-players .challenge-option:not([disabled])').first();
      if (await option.count()) {
        await option.click();
        await page.waitForSelector('#challenge-step-gap:not([hidden])');
        await page.waitForTimeout(150);
        await shot('challenge-gap');
        await page.click('#challenge-timeline .gap');
        await page.click('#btn-challenge-confirm');
        await page.waitForSelector('#challenge-sheet[data-open="false"]');
      } else {
        await page.click('#btn-challenge-close');
      }
      challengeShotDone = true;
    }

    // Ann always places right; everybody else places wrong, so there is a
    // single winner to look at rather than a four-way tie.
    const good = correctGaps(drawn.years, drawn.cardYear);
    let target = good[0];
    if (drawn.activeId !== 'p1') {
      const all = [...Array(drawn.years.length + 1).keys()];
      const bad = all.filter((i) => !good.includes(i));
      if (bad.length) target = bad[0];
    }
    await page.click(`#timeline-strip .gap[data-gap-index="${target}"]`);
    await page.click('#btn-place');
    await page.waitForSelector('body[data-screen="reveal"]');
    continue;
  }

  if (s.screen === 'reveal') {
    if (!revealShotDone) {
      await page.waitForTimeout(900); // let the flip finish
      await shot('reveal');
      revealShotDone = true;
    }
    await page.click('#btn-next-player');
    await page.waitForTimeout(120);
    continue;
  }

  if (s.screen === 'win') break;
  await page.waitForTimeout(100);
}

/* ------------------------------------------------------- scoreboard + win */
const before = await peek();
console.log(`  state after the loop: ${JSON.stringify(before)}`);

if (!before.over) note('the game never finished inside the guard');

await page.waitForSelector('body[data-screen="win"]');
await shot('win');

await browser.close();
console.log(problems.length ? `\nPROBLEMS (${problems.length})` : '\nNo problems detected');
for (const p of problems) console.log(' - ' + p);
