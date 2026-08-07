// Throwaway: proves a photo survives a reload + resume, that clearing the game
// leaves no orphaned photo data, and that the roster comes back next session.
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

const keys = () =>
  page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k).length;
    }
    return out;
  });

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });

console.log('== set up a game with photos');
await page.click('#btn-new-game');
await page.waitForSelector('#setup .player-row');
const NAMES = ['Ann', 'Bo', 'Cy', 'Grandma'];
for (let i = 0; i < NAMES.length; i += 1) await page.fill(`#player-name-${i}`, NAMES[i]);
const FILES = ['photo-ann.png', 'photo-bo.png', 'photo-cy.png'];
for (let i = 0; i < FILES.length; i += 1) {
  await page
    .locator('#player-list > li')
    .nth(i)
    .locator('input[data-role="player-photo"]')
    .setInputFiles(`${PHOTOS}/${FILES[i]}`);
  await page.waitForSelector(`#player-list > li:nth-child(${i + 1})[data-photo-state="photo"]`);
}
await page.locator('#player-list > li').nth(3).locator('[data-action="skip-photo"]').click();
await page.waitForSelector('#player-list > li:nth-child(4)[data-photo-state="skipped"]');

// A narrow-width look at the finished roster.
await page.setViewportSize({ width: 320, height: 568 });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/setup-tight-320.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);

await page.click('#btn-start-game');
await page.waitForSelector('body[data-screen="pass"]');
await page.click('#btn-pass-continue');
await page.waitForSelector('body[data-screen="play"]');
await page.click('#timeline-strip .gap');
await page.click('#btn-place');
await page.waitForSelector('body[data-screen="reveal"]');
await page.click('#btn-next-player');
await page.waitForSelector('body[data-screen="pass"]');

console.log('  keys mid-game: ' + JSON.stringify(await keys()));

console.log('== reload and resume');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('body[data-screen="home"]');
const resumeVisible = await page.isVisible('#btn-resume-game');
console.log(`  resume offered: ${resumeVisible}`);
if (!resumeVisible) note('Resume game was not offered after a reload');
await page.click('#btn-resume-game');
await page.waitForSelector('body[data-screen="pass"]');

const restored = await page.evaluate(() => {
  const s = window.__timeline.state;
  const img = document.querySelector('#pass-avatar [data-field="photo"]');
  return {
    photos: s.players.map((p) => (p.photo ? p.photo.slice(0, 22) : null)),
    colors: s.players.map((p) => p.color),
    passState: document.getElementById('pass-avatar').dataset.photo,
    passSrc: img && img.getAttribute('src') ? img.getAttribute('src').slice(0, 22) : null,
    passSeat: getComputedStyle(document.getElementById('pass-avatar')).borderTopColor,
  };
});
console.log('  ' + JSON.stringify(restored));
if (restored.passState !== 'true' || !restored.passSrc) {
  note('the resumed pass screen lost its photo');
}
if (restored.photos[3] !== null) note('the skipped player came back with a photo');
await page.screenshot({ path: `${OUT}/resume-pass-390.png` });

console.log('== end the game, check nothing is orphaned');
await page.click('#btn-pass-continue');
await page.waitForSelector('body[data-screen="play"]');
await page.click('#btn-menu');
await page.waitForSelector('#menu-sheet[data-open="true"]');
await page.click('#btn-end-game');
await page.waitForSelector('body[data-screen="win"]');

const after = await keys();
console.log('  keys after End game: ' + JSON.stringify(after));
const names = Object.keys(after);
const stray = names.filter(
  (k) => !k.startsWith('music-timeline:v1:') && !k.startsWith('music-timeline:preview:'),
);
if (stray.length) note(`stray storage keys left behind: ${stray.join(', ')}`);
if (names.includes('music-timeline:v1:game')) note('the finished game was not cleared');

const rosterHasPhotos = await page.evaluate(() => {
  const raw = localStorage.getItem('music-timeline:v1:players');
  if (!raw) return null;
  const box = JSON.parse(raw);
  return box.d.map((p) => ({ name: p.name, photo: !!p.photo, skipped: !!p.skipped }));
});
console.log('  roster kept for next time: ' + JSON.stringify(rosterHasPhotos));
if (!rosterHasPhotos || !rosterHasPhotos.some((p) => p.photo)) {
  note('the roster lost its photos');
}

console.log('== next session picks the faces back up');
await page.click('#btn-win-home');
await page.waitForSelector('body[data-screen="home"]');
await page.click('#btn-new-game');
await page.waitForSelector('#setup .player-row');
const back = await page.evaluate(() =>
  [...document.querySelectorAll('#player-list > li')].map((li) => ({
    name: li.querySelector('[data-role="player-name"]').value,
    state: li.dataset.photoState,
  })),
);
console.log('  ' + JSON.stringify(back));
if (back.length !== 4 || back[0].state !== 'photo' || back[3].state !== 'skipped') {
  note('the roster did not come back intact');
}
const startReady = await page.isDisabled('#btn-start-game');
if (startReady) note('a restored roster still blocked Start');
console.log(`  start immediately enabled: ${!startReady}`);

await browser.close();
console.log(problems.length ? `\nPROBLEMS (${problems.length})` : '\nNo problems detected');
for (const p of problems) console.log(' - ' + p);
