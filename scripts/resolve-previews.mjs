// Resolve every deck card to a 30-second preview ONCE, at build time, and write the
// answers to public/music/previews.json.
//
// Why bother when audio.js can already do this in the browser: doing it live means a
// lookup on every single turn. That is latency before the song starts, a hard
// dependency on Apple's API being reachable from the living room, and - worst of all -
// a matching decision made fresh each time, so a cover or a re-recording can win the
// match on one turn and lose it on the next. Resolving here makes playback instant,
// survives a flaky connection, and lets a human look at the matches before anyone
// plays. audio.js still falls back to the live lookup if a baked URL ever rots.
//
// Usage: node scripts/resolve-previews.mjs [--limit N] [--only <id>] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/music/previews.json');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const LIMIT = Number(flag('--limit') ?? 0) || Infinity;
const ONLY = flag('--only');
const VERBOSE = args.includes('--verbose');

const { DECK } = await import(pathToFileURL(path.join(ROOT, 'public/music/deck.js')).href);

/* -------------------------------------------------------------- matching -- */
// Deliberately the same rules as public/music/audio.js. If you change one, change
// both, or the baked answer and the live fallback will disagree about the same card.

// Latin-extended letters that NFD does not decompose, so the [^a-z0-9] sweep
// below would turn them into spaces and shred the word. Turkish dotless i is the
// one that actually bit us: "Simarik" scored ZERO against Tarkan's own
// "Simarik" because the catalogue spells it with two of them.
const TRANSLITERATE = [
  [/[ı]/g, 'i'], [/[İ]/g, 'i'], [/[đĐ]/g, 'd'],
  [/[łŁ]/g, 'l'], [/[øØ]/g, 'o'], [/[æÆ]/g, 'ae'],
  [/[œŒ]/g, 'oe'], [/[ß]/g, 'ss'], [/[þÞ]/g, 'th'],
  [/[ħ]/g, 'h'], [/[ŋ]/g, 'n'],
];

const strip = (s) => {
  let v = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, to] of TRANSLITERATE) v = v.replace(re, to);
  return v
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    // NOT "with": it is a perfectly ordinary word in a title, and including it
    // here truncated "With or Without You" to nothing, scored it zero and
    // rejected the real U2 recording. Six cards were silently affected.
    .replace(/\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

// Variants that are not the recording on the card. "Live" needs a word boundary or
// it eats "Livery"; "version" alone is too broad (plenty of legitimate titles).
const VARIANT = /\b(remix|remixed|live|karaoke|instrumental|tribute|cover|made famous|originally performed|re-?recorded|taylors version|demo|acoustic version|radio edit remix|extended (mix|version)|club mix|dub mix|edit remix)\b/;

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const union = new Set([...A, ...B]).size;
  const jaccard = union ? shared / union : 0;
  const contains = a.includes(b) || b.includes(a) ? 0.25 : 0;
  return Math.min(1, jaccard + contains);
}

// Acts that exist only to re-record other people's songs. The title matches
// perfectly, which is exactly why they are dangerous: "Garth Brooks Tribute"
// and "Pickin' On Series" both won matches here before this existed.
const IMPOSTOR_ARTIST = /\b(tribute|karaoke|made famous|originally performed|performed by|pickin on|the hit crew|hit co|lullaby|8 bit|string quartet|cover band|covers)\b/;

/** Levenshtein, capped - only used on short artist names. */
function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Is this plausibly the same act?
 *
 * Word overlap alone is too strict for stylised credits - "P!nk" folds to "pnk"
 * and shares no word with "pink" - so a short edit distance and a containment
 * check both count as agreement.
 */
function sameArtist(cardArtist, resultArtist) {
  const a = strip(cardArtist);
  const b = strip(resultArtist);
  if (!a || !b) return false;
  if (similarity(a, b) >= 0.34) return true;
  const ca = a.replace(/ /g, '');
  const cb = b.replace(/ /g, '');
  if (ca.includes(cb) || cb.includes(ca)) return true;
  return editDistance(ca, cb) <= Math.max(1, Math.floor(Math.min(ca.length, cb.length) / 6));
}

function score(card, r) {
  const title = strip(r.trackName);
  const artist = strip(r.artistName);
  const t = similarity(strip(card.title), title);
  const a = similarity(strip(card.artist), artist);
  // Test the RAW title, not the stripped one: strip() deletes bracketed text,
  // and "(feat. ...) [Remix]" is exactly where the catalogue puts the word that
  // tells you this is not the recording on the card.
  const rawTitle = String(r.trackName || '').toLowerCase();
  if (VARIANT.test(rawTitle) && !VARIANT.test(String(card.title).toLowerCase())) return -1;
  if (VARIANT.test(title) && !VARIANT.test(strip(card.title))) return -1;
  if (IMPOSTOR_ARTIST.test(artist)) return -1;
  // The artist is a GATE, not a weight. Scoring it as 45% of a blend meant a
  // perfect title with a completely wrong artist landed on exactly the 0.55
  // acceptance floor and got through - which is how a Mark Chesnutt cover beat
  // Garth Brooks to "Friends in Low Places". Wrong artist is wrong song, full stop.
  if (!sameArtist(card.artist, r.artistName)) return -1;
  if (r.trackTimeMillis && r.trackTimeMillis < 45000) return -1; // interludes, skits
  return t * 0.55 + a * 0.45;
}

const yearOf = (r) => {
  const m = /^(\d{4})/.exec(r.releaseDate || '');
  return m ? Number(m[1]) : null;
};

/* ------------------------------------------------------------ networking -- */

async function search(term, attempt = 0) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=12`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'music-timeline-deck-builder' } });
    if (res.status === 403 || res.status === 429) throw new Error(`throttled ${res.status}`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    return (await res.json()).results || [];
  } catch (err) {
    if (attempt >= 6) throw err;
    // Apple throttles bursts hard and stays cross for a while. Back off a long way
    // rather than hammering: a slow run that finishes beats a fast one that 403s.
    const wait = Math.min(60000, 2000 * 2 ** attempt);
    if (VERBOSE) console.log(`    retry in ${wait}ms (${err.message})`);
    await new Promise((r) => setTimeout(r, wait));
    return search(term, attempt + 1);
  }
}

function pick(card, results) {
  const scored = results
    .map((r) => ({ r, s: score(card, r), y: yearOf(r) }))
    .filter((x) => x.s > 0 && x.r.previewUrl)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;

  // An in-era match beats a better-scoring one from the wrong decade: that is what
  // stops a 2008 covers-album version from beating the 1968 original.
  const inEra = scored.filter((x) => x.y != null && Math.abs(x.y - card.year) <= 2);
  if (inEra.length && inEra[0].s >= 0.55) return inEra[0];
  // Falling through rather than giving up: a weak in-era candidate used to veto
  // a strong out-of-era one, so a catalogue that carried BOTH a badly-titled
  // original and a clean reissue resolved to neither. The out-of-era bar stays
  // high, which is what keeps covers and re-recordings out.
  if (scored[0].s >= 0.7) return scored[0];
  return null;
}

/* ------------------------------------------------------------------ main -- */

const cards = (ONLY ? DECK.filter((c) => c.id === ONLY) : DECK).slice(0, LIMIT);
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const out = { ...previous };
const misses = [];
const outOfEra = [];

console.log(`resolving ${cards.length} cards...\n`);

let done = 0;
for (const card of cards) {
  done++;
  // Resumable: a throttled run can be restarted and will only chase what is left.
  if (!ONLY && out[card.id] && out[card.id].preview) continue;

  let best = null;
  let failed = false;
  // Two phrasings: "title artist" is right almost always, but a few titles collide
  // with an artist name and only the reversed form finds the record.
  for (const term of [`${card.title} ${card.artist}`, `${card.artist} ${card.title}`]) {
    let results;
    try {
      results = await search(term);
    } catch (err) {
      // One card that cannot be reached must not throw away the 200 already done.
      console.log(`  [${done}/${cards.length}] FAIL  ${card.id}: ${err.message}`);
      failed = true;
      break;
    }
    best = pick(card, results);
    if (best) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (failed) {
    misses.push(card);
    fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  if (!best) {
    misses.push(card);
    console.log(`  [${done}/${cards.length}] MISS  ${card.artist} - ${card.title} (${card.year})`);
  } else {
    const drift = best.y == null ? null : best.y - card.year;
    out[card.id] = {
      preview: best.r.previewUrl,
      art: (best.r.artworkUrl100 || '').replace('100x100bb', '600x600bb') || null,
      // Kept for the review pass below, never read at play time.
      matched: `${best.r.artistName} - ${best.r.trackName}`,
      matchedYear: best.y,
    };
    if (drift != null && Math.abs(drift) > 2) {
      outOfEra.push({ card, matched: out[card.id].matched, y: best.y, drift });
    }
    if (VERBOSE) {
      console.log(`  [${done}/${cards.length}] ok    ${card.artist} - ${card.title} -> ${out[card.id].matched} (${best.y})`);
    } else if (done % 25 === 0) {
      console.log(`  [${done}/${cards.length}] ...`);
    }
  }
  // Checkpoint as we go so a throttle-out never costs work already done.
  if (done % 10 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
  await new Promise((r) => setTimeout(r, 500));
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');

const resolved = cards.length - misses.length;
console.log(`\nresolved ${resolved}/${cards.length} (${Math.round((resolved / cards.length) * 100)}%)`);
console.log(`wrote ${OUT} (${fs.statSync(OUT).size} bytes, ${Object.keys(out).length} entries)`);

if (outOfEra.length) {
  console.log(`\n${outOfEra.length} matched outside the card's era - REVIEW THESE:`);
  for (const x of outOfEra) {
    console.log(`  ${x.card.artist} - ${x.card.title} (${x.card.year}) -> ${x.matched} (${x.y}, ${x.drift > 0 ? '+' : ''}${x.drift})`);
  }
}
if (misses.length) {
  console.log(`\n${misses.length} unresolved:`);
  for (const c of misses) console.log(`  ${c.id}`);
}
