/* Throwaway Playwright driver for the player-rail work. Delete when done. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const BASE = 'http://localhost:4178/index.html?debug=1&seed=99';
const OUT = process.env.SHOT_DIR || '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const WIDE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 568 };

/* --- a tiny solid-ish PNG so the photo path gets exercised ---------------- */
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(Buffer.from([0]));
    const row = Buffer.alloc(size * 3);
    for (let x = 0; x < size; x += 1) {
      const band = (x + y) % 24 < 12 ? 1 : 0.65;
      row[x * 3] = Math.round(rgb[0] * band);
      row[x * 3 + 1] = Math.round(rgb[1] * band);
      row[x * 3 + 2] = Math.round(rgb[2] * band);
    }
    raw.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const FACES = [
  [255, 120, 90],
  [90, 200, 255],
  [180, 255, 120],
  [255, 210, 90],
  [200, 140, 255],
  [120, 255, 210],
  [255, 140, 200],
  [140, 160, 255],
];

/* --- harness ------------------------------------------------------------- */
const problems = [];

function watch(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      problems.push(`[${tag}] console: ${msg.text()} @ ${JSON.stringify(msg.location())}`);
    }
  });
  page.on('requestfailed', (req) => problems.push(`[${tag}] requestfailed: ${req.url()}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[${tag}] http ${res.status()}: ${res.url()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${tag}] pageerror: ${err.message}`));
}

async function noSideScroll(page, where) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out = [];
    const scrollers = '.strip, .roster__seats, .mini-timeline, .prose';
    for (const node of document.querySelectorAll('body *')) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (node.closest(scrollers)) continue;
      if (r.right > w + 0.5) {
        out.push(`${node.tagName}.${node.className || ''}#${node.id || ''} R${Math.round(r.right)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: w,
      body: document.body.scrollWidth,
      out: out.slice(0, 12),
    };
  });
  if (wide.scrollWidth > wide.clientWidth || wide.out.length > 0) {
    problems.push(`[${where}] horizontal scroll: ${JSON.stringify(wide)}`);
  }
}

async function shoot(page, name, opts = {}) {
  await page.waitForTimeout(120);
  await noSideScroll(page, name);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
}

async function setupGame(page, { names, mode = 'classic', target = null, photos = null }) {
  await page.goto(BASE);
  await page.click('#btn-new-game');
  await page.waitForSelector('#setup .player-row');
  let rows = await page.locator('#player-list .player-row').count();
  while (rows < names.length) {
    await page.click('#btn-add-player');
    rows += 1;
  }
  while (rows > names.length) {
    await page.locator('#player-list .player-row [data-action="remove-player"]').last().click();
    rows -= 1;
  }
  for (let i = 0; i < names.length; i += 1) {
    await page.fill(`#player-name-${i}`, names[i]);
  }
  for (let i = 0; i < names.length; i += 1) {
    const row = page.locator('#player-list .player-row').nth(i);
    if (!photos || photos[i]) {
      await row.locator('[data-role="player-photo"]').setInputFiles({
        name: `face-${i}.png`,
        mimeType: 'image/png',
        buffer: png(96, FACES[i % FACES.length]),
      });
      await row.locator('[data-photo-state="photo"]').or(row).first().waitFor();
      await page.waitForTimeout(60);
    } else {
      await row.locator('[data-action="skip-photo"]').click();
    }
  }
  if (mode !== 'classic') await page.click(`label[for="mode-${mode}"]`);
  if (target === 5) await page.click('[data-action="target-dec"]');
  if (target === 15) await page.click('[data-action="target-inc"]');
  await page.waitForTimeout(120);
  await page.click('#btn-start-game');
  await page.waitForFunction(() => document.body.dataset.screen !== 'setup');
}

/** Draw the card by tapping gap 0, then place it right (or deliberately wrong). */
async function playTurn(page, { correct = null } = {}) {
  const screen = await page.evaluate(() => document.body.dataset.screen);
  if (screen === 'pass') await page.click('#btn-pass-continue');
  await page.waitForSelector('#play .gap');
  await page.locator('#timeline-strip .gap').first().click();
  // Seat 0 always gets it right, seat 1 half the time, the rest never: the
  // point of the rail is that diverging scores are readable.
  const want = correct === null
    ? await page.evaluate(() => {
        const s = window.__timeline.state;
        if (s.activeIndex === 0) return true;
        if (s.activeIndex === 1) return s.turn % 2 === 0;
        return false;
      })
    : correct;
  const gap = await page.evaluate((wantCorrect) => {
    const s = window.__timeline.state;
    const mine = s.mode === 'coop'
      ? s.sharedTimeline
      : s.players[s.activeIndex].timeline;
    const year = s.card.year;
    const ok = [];
    const bad = [];
    for (let i = 0; i <= mine.length; i += 1) {
      const leftOk = i === 0 || year >= mine[i - 1].year;
      const rightOk = i === mine.length || year <= mine[i].year;
      (leftOk && rightOk ? ok : bad).push(i);
    }
    const pick = wantCorrect ? ok[0] : (bad.length ? bad[0] : ok[0]);
    return pick;
  }, want);
  await page.locator(`#timeline-strip .gap[data-gap-index="${gap}"]`).click();
  await page.click('#btn-place');
  await page.waitForFunction(() => document.body.dataset.screen === 'reveal');
}

async function nextTurn(page) {
  await page.click('#btn-next-player');
  await page.waitForFunction(() => ['pass', 'play', 'win'].includes(document.body.dataset.screen));
}

async function bothWidths(page, name) {
  await page.setViewportSize(WIDE);
  await shoot(page, `${name}-390`);
  await page.setViewportSize(NARROW);
  await shoot(page, `${name}-320`);
  await page.setViewportSize(WIDE);
}

/* --- the runs ------------------------------------------------------------ */
async function run(browser, tag, options, turns) {
  const context = await browser.newContext({ viewport: WIDE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  watch(page, tag);
  await setupGame(page, options);

  await bothWidths(page, `${tag}-pass-first`);

  let over = false;
  for (let t = 0; t < turns; t += 1) {
    await playTurn(page);
    if (t === 0) await bothWidths(page, `${tag}-reveal-first`);
    await nextTurn(page);
    if (await page.evaluate(() => document.body.dataset.screen === 'win')) {
      over = true;
      break;
    }
  }

  if (!over) {
    // Mid-game, on the pass screen: the standings shot.
    await bothWidths(page, `${tag}-pass`);
    await page.setViewportSize(NARROW);
    await shoot(page, `${tag}-pass-full-320`, { fullPage: true });
    await page.setViewportSize(WIDE);
    await shoot(page, `${tag}-pass-full-390`, { fullPage: true });

    await page.click('#btn-pass-continue');
    await page.waitForSelector('#play .gap');
    await bothWidths(page, `${tag}-play`);

    await playTurn(page);
    await bothWidths(page, `${tag}-reveal`);
  }

  const state = await page.evaluate(() => {
    const s = window.__timeline.state;
    const seats = [...document.querySelectorAll('#play-roster-seats .roster__seat')];
    return {
      screen: document.body.dataset.screen,
      cards: s.players.map((p) => [p.name, p.timeline.length, p.tokens]),
      shared: s.sharedTimeline.length,
      mistakes: s.mistakes,
      active: s.players[s.activeIndex].name,
      turn: s.turn,
      rail: seats.map((seat) => ({
        rank: seat.dataset.rank,
        leader: seat.dataset.leader,
        cards: seat.querySelector('[data-field="cards"]').textContent,
        label: seat.querySelector('.roster__chip').getAttribute('aria-label'),
      })),
      standings: [...document.querySelectorAll('#pass-standings-list .standing')].map((row) => ({
        rank: row.dataset.rank,
        leader: row.dataset.leader,
        fill: row.style.getPropertyValue('--fill'),
        text: row.textContent.replace(/\s+/g, ' ').trim(),
      })),
    };
  });
  console.log(tag, JSON.stringify(state, null, 1));

  await context.close();
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

const only = process.argv[2];
if (!only || only === 'four') {
  await run(browser, 'four', { names: ['Ann', 'Bo', 'Cy', 'Dee'], photos: [1, 1, 0, 1] }, 6);
}
if (!only || only === 'eight') {
  await run(
    browser,
    'eight',
    {
      names: [
        'Alexandrina Rose',
        'Bartholomew Max',
        'Cassiopeia Jane',
        'Demetrius Blake',
        'Evangelina Hope',
        'Ferdinand Grey',
        'Guinevere Wren',
        'Hieronymus Fox',
      ],
      photos: [1, 1, 1, 0, 1, 1, 1, 0],
    },
    9,
  );
}
if (!only || only === 'coop') {
  await run(
    browser,
    'coop',
    { names: ['Ann', 'Bo', 'Cy', 'Dee'], mode: 'coop', photos: [1, 0, 1, 1] },
    6,
  );
}

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log(' -', p);
  process.exitCode = 1;
} else {
  console.log('\nno console errors, no horizontal scroll');
}
