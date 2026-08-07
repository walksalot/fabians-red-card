import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:4178/index.html?debug=1&seed=99');
await page.click('#btn-new-game');
await page.click('label[for="mode-coop"]');
for (let i = 0; i < 4; i += 1) {
  await page.locator('#player-list .player-row').nth(i).locator('[data-action="skip-photo"]').click();
}
await page.click('#btn-start-game');
await page.click('#btn-pass-continue');
// advance to seat 3
for (let t = 0; t < 2; t += 1) {
  await page.locator('#timeline-strip .gap').first().click();
  await page.click('#btn-place');
  await page.click('#btn-next-player');
  await page.click('#btn-pass-continue');
}
const read = async (label) => {
  const r = await page.evaluate(() => {
    const s = document.getElementById('play-roster-seats');
    const chip = s.querySelector('[data-rank="active"]');
    return { scrollLeft: s.scrollLeft, clientWidth: s.clientWidth, scrollWidth: s.scrollWidth,
             offsetLeft: chip.offsetLeft, w: chip.offsetWidth };
  });
  console.log(label, JSON.stringify(r));
};
await page.waitForTimeout(600);
await read('390');
await page.setViewportSize({ width: 320, height: 568 });
await page.waitForTimeout(1500);
await read('320 after 1.5s');
await browser.close();
