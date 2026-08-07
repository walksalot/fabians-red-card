/* Throwaway: find what overflows horizontally on the play screen. */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4178/index.html?debug=1&seed=99';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE);
await page.click('#btn-new-game');
for (let i = 0; i < 4; i += 1) {
  await page.locator('#player-list .player-row').nth(i).locator('[data-action="skip-photo"]').click();
}
await page.click('#btn-start-game');
await page.click('#btn-pass-continue');
await page.waitForSelector('#play .gap');
await page.locator('#timeline-strip .gap').first().click();

const report = await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const out = [];
  for (const node of document.querySelectorAll('body *')) {
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > w + 0.5 || r.left < -0.5) {
      out.push(`${node.tagName}.${node.className || ''}#${node.id || ''} L${Math.round(r.left)} R${Math.round(r.right)}`);
    }
  }
  return {
    body: document.body.scrollWidth,
    doc: document.documentElement.scrollWidth,
    w,
    out: out.slice(0, 25),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
