// Throwaway: the awkward corners - eight seats (all eight colours), a long
// name, advanced mode's confirm panel next to the new "whose card" row, and
// co-op (one shared timeline, no single winner to photograph).
import { chromium } from '@playwright/test';

const SCRATCH =
  '/tmp/claude-0/-home-user-fabians-red-card/476991f1-de30-5fa0-b39f-64afae68c8e3/scratchpad';
const OUT = `${SCRATCH}/shots`;
const PHOTOS = `${SCRATCH}/photos`;
const BASE = 'http://127.0.0.1:4174/music/index.html?debug=1';

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
  if (m.type() === 'error' && !m.text().includes('404')) note(`console error: ${m.text()}`);
});
page.on('pageerror', (e) => note(`page error: ${e.message}`));

async function overflow(tag) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  if (m.sw > m.cw) note(`overflow @ ${tag}: ${m.sw} > ${m.cw}`);
}

async function shot(name, full = false) {
  for (const [w, h] of [
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(240);
    await overflow(`${name}@${w}`);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: full });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(140);
  console.log(`  shot ${name}`);
}

async function fresh(mode) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('#btn-new-game');
  await page.waitForSelector('#setup .player-row');
  if (mode) await page.click(`label[for="mode-${mode}"]`);
}

/* ------------------------------------------------- eight seats, long names */
console.log('== eight players');
await fresh(null);
for (let i = 4; i < 8; i += 1) await page.click('#btn-add-player');
await page.waitForSelector('#player-list > li:nth-child(8)');
const LONG = [
  'Bartholomew III',
  'Zo',
  'Anastasia Maria',
  'Kris',
  'Grandma Josephine',
  'Ed',
  'Wilhelmina',
  'Bo',
];
for (let i = 0; i < 8; i += 1) await page.fill(`#player-name-${i}`, LONG[i]);
const FILES = ['photo-ann.png', 'photo-bo.png', 'photo-cy.png', 'photo-dee.png'];
for (let i = 0; i < 8; i += 1) {
  if (i % 2 === 0) {
    await page
      .locator('#player-list > li')
      .nth(i)
      .locator('input[data-role="player-photo"]')
      .setInputFiles(`${PHOTOS}/${FILES[(i / 2) % 4]}`);
    await page.waitForSelector(`#player-list > li:nth-child(${i + 1})[data-photo-state="photo"]`);
  } else {
    await page.locator('#player-list > li').nth(i).locator('[data-action="skip-photo"]').click();
    await page.waitForSelector(`#player-list > li:nth-child(${i + 1})[data-photo-state="skipped"]`);
  }
}
await shot('setup-eight', true);

await page.click('#btn-start-game');
await page.waitForSelector('body[data-screen="pass"]');
await shot('pass-long-name');
await page.click('#btn-pass-continue');
await page.waitForSelector('body[data-screen="play"]');
await shot('play-long-name');
await page.click('#btn-menu');
await page.click('#btn-menu-scoreboard');
await page.waitForSelector('body[data-screen="scoreboard"]');
await page.waitForTimeout(250);
await shot('scoreboard-eight', true);

const colours = await page.evaluate(() =>
  [...document.querySelectorAll('.score-row')].map((r) => ({
    name: r.querySelector('.score-row__name').textContent,
    seat: r.style.getPropertyValue('--seat'),
    photo: r.querySelector('.avatar').dataset.photo,
  })),
);
console.log('  ' + JSON.stringify(colours));
if (new Set(colours.map((c) => c.seat)).size !== 8) note('eight seats did not get eight colours');

await page.click('#btn-scoreboard-back');
await page.waitForSelector('body[data-screen="play"]');
await page.click('#btn-challenge');
await page.waitForSelector('#challenge-sheet[data-open="true"]');
await page.waitForTimeout(220);
await shot('challenge-eight');
await page.click('#btn-challenge-close');

/* --------------------------------------------------------- advanced mode */
console.log('== advanced mode reveal');
await fresh('advanced');
for (let i = 0; i < 4; i += 1) await page.fill(`#player-name-${i}`, ['Ann', 'Bo', 'Cy', 'Dee'][i]);
await page
  .locator('#player-list > li')
  .nth(0)
  .locator('input[data-role="player-photo"]')
  .setInputFiles(`${PHOTOS}/photo-ann.png`);
await page.waitForSelector('#player-list > li:nth-child(1)[data-photo-state="photo"]');
for (let i = 1; i < 4; i += 1) {
  await page.locator('#player-list > li').nth(i).locator('[data-action="skip-photo"]').click();
}
await page.waitForSelector('#player-list > li:nth-child(4)[data-photo-state="skipped"]');
await page.click('#btn-start-game');
await page.waitForSelector('body[data-screen="pass"]');
await page.click('#btn-pass-continue');
await page.click('#timeline-strip .gap');
await page.click('#btn-claim-identify');
await page.click('#btn-place');
await page.waitForSelector('body[data-screen="reveal"]');
await page.waitForTimeout(900);
await page.click('#btn-confirm-title');
await page.waitForTimeout(150);
await shot('reveal-advanced', true);

/* ------------------------------------------------------------------ co-op */
console.log('== co-op');
await fresh('coop');
for (let i = 0; i < 4; i += 1) await page.fill(`#player-name-${i}`, ['Ann', 'Bo', 'Cy', 'Dee'][i]);
await page
  .locator('#player-list > li')
  .nth(1)
  .locator('input[data-role="player-photo"]')
  .setInputFiles(`${PHOTOS}/photo-bo.png`);
await page.waitForSelector('#player-list > li:nth-child(2)[data-photo-state="photo"]');
for (const i of [0, 2, 3]) {
  await page.locator('#player-list > li').nth(i).locator('[data-action="skip-photo"]').click();
}
await page.click('#btn-start-game');
await page.waitForSelector('body[data-screen="pass"]');
await page.click('#btn-pass-continue');
await page.click('#timeline-strip .gap');
await page.click('#btn-place');
await page.waitForSelector('body[data-screen="reveal"]');
await page.waitForTimeout(900);
await shot('reveal-coop', true);
await page.click('#btn-next-player');
await page.waitForSelector('body[data-screen="pass"]');
await page.click('#btn-pass-continue');
await page.click('#btn-menu');
await page.click('#btn-menu-scoreboard');
await page.waitForSelector('body[data-screen="scoreboard"]');
await page.waitForTimeout(220);
await shot('scoreboard-coop', true);
await page.click('#btn-scoreboard-back');
await page.click('#btn-menu');
await page.click('#btn-end-game');
await page.waitForSelector('body[data-screen="win"]');
await page.waitForTimeout(300);
const winAvatarHidden = await page.evaluate(
  () => document.getElementById('win-avatar').hidden,
);
console.log(`  co-op win hides the single-winner photo: ${winAvatarHidden}`);
if (!winAvatarHidden) note('co-op showed a single winner photo');
await shot('win-coop');

await browser.close();
console.log(problems.length ? `\nPROBLEMS (${problems.length})` : '\nNo problems detected');
for (const p of problems) console.log(' - ' + p);
