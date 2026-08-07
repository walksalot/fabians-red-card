// Audits every card against the recording that will actually play for it.
//
// Two things can be silently wrong in a deck this size, and neither shows up until
// a family hits it mid-game: a card whose year disagrees with the recording, and -
// much worse - a card whose preview is a DIFFERENT SONG. Both are checkable here
// because previews.json records what each card matched to. Run this after any
// change to the deck or to scripts/resolve-previews.mjs.
//
// Usage: node scripts/audit-deck.mjs
// year disagrees with the recording that will actually play, and - much worse - a
// card whose preview is a DIFFERENT SONG. Both are invisible until a family hits
// them mid-game, and both are checkable here because previews.json recorded what
// each card matched to.
import fs from 'node:fs';
import { DECK } from '../public/music/deck.js';

const previews = JSON.parse(fs.readFileSync('public/music/previews.json', 'utf8'));

const fold = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’']/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/\b(feat|ft|featuring|with|and|the|&)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const overlap = (a, b) => {
  const A = new Set(fold(a).split(' ').filter(Boolean));
  const B = new Set(fold(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
};

const yearGap = [];
const wrongSong = [];
const noPreview = [];

for (const card of DECK) {
  const p = previews[card.id];
  if (!p || !p.preview) { noPreview.push(card); continue; }

  const matched = String(p.matched || '');
  const dash = matched.indexOf(' - ');
  const mArtist = dash > 0 ? matched.slice(0, dash) : '';
  const mTitle = dash > 0 ? matched.slice(dash + 3) : matched;

  // Does the thing that will PLAY look like the thing on the card?
  const titleScore = overlap(card.title, mTitle);
  const artistScore = overlap(card.artist, mArtist);
  if (titleScore < 0.5 || artistScore < 0.34) {
    wrongSong.push({ card, matched, titleScore: titleScore.toFixed(2), artistScore: artistScore.toFixed(2) });
  }

  // Does the catalogue disagree about when it came out?
  if (typeof p.matchedYear === 'number') {
    const gap = p.matchedYear - card.year;
    if (Math.abs(gap) >= 2) yearGap.push({ card, matched, itunes: p.matchedYear, gap });
  }
}

const show = (rows, fmt) => rows.slice(0, 60).map(fmt).join('\n');

console.log(`deck ${DECK.length} cards, ${Object.keys(previews).length} previews\n`);

console.log(`=== POSSIBLE WRONG SONG (${wrongSong.length}) ===`);
console.log(show(wrongSong, (r) =>
  `  ${r.card.id}\n      card:    ${r.card.artist} - ${r.card.title} (${r.card.year})\n      plays:   ${r.matched}   [title ${r.titleScore} artist ${r.artistScore}]`));

console.log(`\n=== YEAR DISAGREES WITH CATALOGUE BY 2+ (${yearGap.length}) ===`);
console.log(show(yearGap.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)), (r) =>
  `  ${String(r.gap > 0 ? '+' + r.gap : r.gap).padStart(4)}  ${r.card.artist} - ${r.card.title}: card ${r.card.year}, itunes ${r.itunes}  (${r.matched})`));

console.log(`\n=== NO PREVIEW (${noPreview.length}) ===`);
console.log(show(noPreview, (c) => `  ${c.id}`));

fs.writeFileSync('/tmp/claude-0/-home-user-fabians-red-card/476991f1-de30-5fa0-b39f-64afae68c8e3/scratchpad/audit.json',
  JSON.stringify({ wrongSong, yearGap, noPreview }, null, 1));
console.log('\nfull report -> scratchpad/audit.json');
