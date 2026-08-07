// Audio for the Timeline music game: turn a deck card into a playable
// 30-second preview without ever telling anyone what year it came out.
//
// Resolution goes through the iTunes Search API, and it has to be JSONP. The
// plain JSON form answers without `access-control-allow-origin`, so a fetch()
// from the game's origin (or from file://, where there is no origin at all) is
// blocked; the `callback=` form is served as text/javascript with
// `access-control-allow-origin: *`, which a <script> tag has always been able
// to read. That is the only transport that works in all three ways this app is
// meant to run, so it is the one we implement - carefully, with a hard timeout
// and guaranteed cleanup of both the injected tag and the global it needs.
//
// Two rules shape everything below:
//
//  1. The year must not leak. The search we send is title + artist only, the
//     module never touches the DOM, and the one year-shaped field we return
//     (`matchedYear`) is named so that rendering it before the reveal reads as
//     an obvious mistake in review. Nothing here writes the card's own year.
//  2. Every failure path ends at `null`. No network, blocked script, garbage
//     JSON, nothing that scores well enough - the caller gets null and shows
//     the streaming-link fallback instead. Resolution is never load-bearing.

/** Where the search lives. Only ever hit over https; JSONP is script injection. */
const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';

/** Preview resolutions live here - deliberately outside storage.js's key
 * namespace because this is a disposable cache with its own eviction policy,
 * and storage.js is allowed to delete it wholesale to survive a quota error. */
export const PREVIEW_CACHE_KEY = 'music-timeline:preview:v1';

/** Hard cap on cached resolutions so a long-lived install cannot grow forever. */
const CACHE_LIMIT = 500;

/** Negative results expire; a miss is usually the network, not the catalogue. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Someone is holding a phone waiting to hear a song. Do not stall past this. */
const LOOKUP_TIMEOUT_MS = 8000;

/** Candidates are rejected outright below these, before scoring matters. */
const MIN_TITLE_SIMILARITY = 0.6;
const MIN_ARTIST_SIMILARITY = 0.5;

/** Accept an in-era match at this score; demand more from an out-of-era one. */
const MIN_SCORE = 0.55;
const MIN_SCORE_OUT_OF_ERA = 0.7;

/**
 * @typedef {object} Card
 * @property {string} [id]
 * @property {string} title
 * @property {string} artist
 * @property {number} [year]
 */

/**
 * @typedef {object} ResolvedTrack
 * @property {string} previewUrl 30-second m4a preview
 * @property {string} artworkUrl square cover art, 600px where available
 * @property {string} matchedTitle title as the catalogue spells it
 * @property {string} matchedArtist artist as the catalogue spells it
 * @property {number|null} matchedYear REVEAL ONLY - never render pre-reveal
 */

/* ------------------------------------------------------------------ JSONP */

let jsonpSeq = 0;

/**
 * Fetch a JSONP endpoint.
 *
 * The callback name is generated per call and injected into the URL: pass a
 * `{callback}` placeholder, an existing `callback=` parameter (its value is
 * replaced), or neither (one is appended). Both the <script> tag and the
 * global are removed in a `finally`, so a hung request, an error and a success
 * all leave the page exactly as they found it.
 *
 * @param {string} url absolute https URL
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<*>} whatever the endpoint passed to the callback
 */
export function jsonp(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      reject(new Error('jsonp: an absolute https URL is required'));
      return;
    }
    if (typeof document === 'undefined' || !document.createElement) {
      reject(new Error('jsonp: no document (this module needs a browser)'));
      return;
    }

    jsonpSeq += 1;
    const name = `__musicTimelineJsonp_${Date.now().toString(36)}_${jsonpSeq}_${Math.floor(
      Math.random() * 1e9,
    ).toString(36)}`;

    const script = document.createElement('script');
    let timer = 0;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      script.onerror = null;
      script.onload = null;
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete (/** @type {Record<string, unknown>} */ (globalThis))[name];
      } catch {
        // Some engines refuse `delete` on a global; blanking it is enough.
        (/** @type {Record<string, unknown>} */ (globalThis))[name] = undefined;
      }
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        fn(value);
      } finally {
        cleanup();
      }
    };

    (/** @type {Record<string, unknown>} */ (globalThis))[name] = (payload) => {
      finish(resolve, payload);
    };

    script.src = withCallback(url, name);
    script.async = true;
    script.charset = 'utf-8';
    script.onerror = () => {
      finish(reject, new Error(`jsonp: script failed to load (${SEARCH_ENDPOINT})`));
    };
    // A 200 that never calls back (an error page, a truncated body) would hang
    // forever otherwise, so the timeout is the real guarantee here.
    timer = setTimeout(() => {
      finish(reject, new Error(`jsonp: timed out after ${timeoutMs}ms`));
    }, Math.max(1, timeoutMs));

    const parent = document.head || document.body || document.documentElement;
    parent.appendChild(script);
  });
}

/** Put `name` into the URL's callback slot however the caller left room for it. */
function withCallback(url, name) {
  if (url.includes('{callback}')) return url.replace('{callback}', name);
  if (/[?&]callback=/.test(url)) return url.replace(/([?&]callback=)[^&]*/, `$1${name}`);
  return `${url}${url.includes('?') ? '&' : '?'}callback=${name}`;
}

/* ------------------------------------------------------- text normalising */

/** @param {number} code */
function chr(code) {
  return String.fromCharCode(code);
}

// Built from char codes rather than written literally so every file in
// public/music/ stays plain ASCII: U+0300..U+036F are the combining marks NFD
// splits accents into, U+2013/U+2014 are the dashes iTunes titles use.
const COMBINING_MARKS = new RegExp(`[${chr(0x300)}-${chr(0x36f)}]`, 'g');
const LONG_DASHES = new RegExp(`[${chr(0x2013)}${chr(0x2014)}]`, 'g');

/** Lowercase, strip diacritics and flatten dashes, so a folded "Beyonce"
 * matches the accented spelling the catalogue actually uses. */
function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(LONG_DASHES, '-')
    .toLowerCase();
}

/** Drop punctuation and collapse whitespace; bigram scoring wants plain words. */
function squash(value) {
  return value
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove "(2011 Remaster)", "[Single Version]" and friends. */
function stripBrackets(value) {
  return value.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
}

/** Remove a trailing " - 2011 Remaster" style suffix, which iTunes loves. */
function stripDashSuffix(value) {
  return value.replace(
    /\s-\s.*\b(remaster|remastered|version|mix|edit|mono|stereo|single|album|live|radio|remix|take|demo|deluxe|anniversary|reissue|soundtrack|theme|from)\b.*$/,
    ' ',
  );
}

/** Drop a "feat. X" tail; the credit is noise for matching. */
function stripFeat(value) {
  return value.replace(/\b(feat|ft|featuring)\b\.?.*$/, ' ');
}

/** Canonical form of a song title for comparison. */
function normTitle(value) {
  return squash(stripFeat(stripDashSuffix(stripBrackets(fold(value)))));
}

/** Canonical form of an artist name; a leading "the" is never meaningful. */
function normArtist(value) {
  return squash(stripFeat(stripBrackets(fold(value)))).replace(/^the /, '');
}

/**
 * Dice coefficient over character bigrams: cheap, dependency-free, and stable
 * for the kinds of difference we actually see (spelling, ampersands, "and").
 * @returns {number} 0..1
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    left.set(gram, (left.get(gram) || 0) + 1);
  }
  let hits = 0;
  const total = a.length - 1 + (b.length - 1);
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const seen = left.get(gram) || 0;
    if (seen > 0) {
      hits += 1;
      left.set(gram, seen - 1);
    }
  }
  const dice = total > 0 ? (2 * hits) / total : 0;
  // "take on me" inside "take on me the 2015 remaster" should not be punished
  // for the extra words the bracket-stripper could not see. Guarded by length,
  // though: without that, a card called "One" would happily match "One Dance".
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const ratio = shorter / Math.max(a.length, b.length);
    if (shorter >= 5 && ratio >= 0.4) return Math.max(dice, 0.88);
  }
  return dice;
}

/* ------------------------------------------------------ variant rejection */

// A cover, a live take or a karaoke backing track is worse than no audio at
// all: the tune is wrong, and in a game about release years a re-recording is
// actively misleading. Markers are matched as whole words against the raw
// (bracket-preserving) title, because "(Live)" is exactly where they hide.
const TRACK_MARKERS = [
  'remix',
  'live',
  'karaoke',
  'instrumental',
  'tribute',
  'cover',
  'covers',
  'acoustic',
  'unplugged',
  'demo',
  're recorded',
  're recording',
  'rerecorded',
  // squash() turns "Taylor's Version" into "taylor s version", so both
  // spellings are listed rather than relying on the apostrophe surviving.
  'taylors version',
  'taylor s version',
  'sped up',
  'slowed',
  'in the style of',
  'made famous by',
  'originally performed',
  'as made famous',
  'lullaby',
  '8 bit',
  'workout',
  'medley',
  'parody',
  'a cappella',
  'acappella',
  'backing track',
];

// Album-level markers only include the ones that reliably mean "not the
// original recording"; "Deluxe Edition" and "Greatest Hits" are fine.
const ALBUM_MARKERS = [
  'karaoke',
  'tribute',
  'unplugged',
  'in the style of',
  'made famous by',
  'originally performed',
  'as made famous',
  'lullaby',
  'workout',
  '8 bit',
];

// Whole-word match. Both sides have been through squash(), so every marker is
// lowercase alphanumerics separated by single spaces and nothing needs
// escaping. Word boundaries matter: "Alive" must not read as "live".
function hasMarker(haystack, marker) {
  return new RegExp(`(^| )${marker}( |$)`).test(haystack);
}

/**
 * @param {string} trackName catalogue title, brackets intact
 * @param {string} albumName catalogue album, brackets intact
 * @param {string} cardTitleWords normalised card title, so "Live and Let Die"
 *   does not reject itself
 * @returns {boolean}
 */
function isVariant(trackName, albumName, cardTitleWords) {
  const track = squash(fold(trackName));
  const album = squash(fold(albumName));
  for (const marker of TRACK_MARKERS) {
    if (hasMarker(cardTitleWords, marker)) continue;
    if (hasMarker(track, marker)) return true;
  }
  for (const marker of ALBUM_MARKERS) {
    if (hasMarker(cardTitleWords, marker)) continue;
    if (hasMarker(album, marker)) return true;
  }
  return false;
}

/* --------------------------------------------------------------- scoring */

/** @returns {number|null} */
function releaseYear(result) {
  const raw = result && result.releaseDate;
  if (typeof raw !== 'string' || raw.length < 4) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** How much a candidate's era is worth, 0..1. */
function eraScore(delta) {
  if (delta === null) return 0.5;
  if (delta <= 2) return 1;
  if (delta <= 5) return 0.55;
  if (delta <= 10) return 0.25;
  return 0;
}

/** iTunes hands back 100px art; the same URL serves 600px for the reveal card. */
function upscaleArtwork(url) {
  if (typeof url !== 'string' || !url) return '';
  return url.replace(/\/(\d+)x(\d+)(bb)?\.(jpg|png)$/i, '/600x600bb.$4');
}

/**
 * Pick the best usable result, or null.
 * @param {Array<*>} results raw iTunes rows
 * @param {Card} card
 * @returns {ResolvedTrack|null}
 */
function chooseBest(results, card) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const wantTitle = normTitle(card.title);
  const wantArtist = normArtist(card.artist);
  const cardYear = Number.isFinite(Number(card.year)) ? Number(card.year) : null;
  const scored = [];

  for (const row of results) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.previewUrl !== 'string' || !row.previewUrl) continue;
    if (row.kind && row.kind !== 'song') continue;

    const trackName = String(row.trackName || row.trackCensoredName || '');
    const artistName = String(row.artistName || '');
    const albumName = String(row.collectionName || '');
    if (!trackName || !artistName) continue;
    if (isVariant(trackName, albumName, wantTitle)) continue;

    const titleSim = similarity(wantTitle, normTitle(trackName));
    if (titleSim < MIN_TITLE_SIMILARITY) continue;
    const artistSim = similarity(wantArtist, normArtist(artistName));
    if (artistSim < MIN_ARTIST_SIMILARITY) continue;

    const year = releaseYear(row);
    const delta = cardYear !== null && year !== null ? Math.abs(year - cardYear) : null;
    let score = titleSim * 0.45 + artistSim * 0.35 + eraScore(delta) * 0.2;
    // Family game: prefer the clean cut when both exist.
    if (row.trackExplicitness === 'explicit') score -= 0.05;

    scored.push({
      score,
      inEra: delta !== null && delta <= 2,
      track: {
        previewUrl: String(row.previewUrl),
        artworkUrl: upscaleArtwork(row.artworkUrl100 || row.artworkUrl60 || row.artworkUrl30),
        matchedTitle: trackName,
        matchedArtist: artistName,
        matchedYear: year,
      },
    });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  // The era filter is what stops a 2019 cover or a "Taylor's Version" from
  // hijacking a 1985 card: if anything at all landed within two years of the
  // card, nothing outside that window is even considered.
  const inEra = scored.filter((entry) => entry.inEra);
  if (inEra.length > 0) {
    return inEra[0].score >= MIN_SCORE ? inEra[0].track : null;
  }
  // Nothing in era. Often that just means iTunes only stocks the reissue, so a
  // very strong title+artist match is still worth taking - but only that.
  return scored[0].score >= MIN_SCORE_OUT_OF_ERA ? scored[0].track : null;
}

/* ----------------------------------------------------------------- cache */

/** @returns {Record<string, *>} */
function readCache() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return {};
    const entries = parsed.e;
    return entries && typeof entries === 'object' ? entries : {};
  } catch {
    // Unusable storage or a corrupt payload: behave as if the cache is empty.
    return {};
  }
}

function writeCache(entries) {
  try {
    if (!globalThis.localStorage) return;
    const keys = Object.keys(entries);
    if (keys.length > CACHE_LIMIT) {
      // Oldest out, by the timestamp written with each entry.
      keys
        .sort((a, b) => (entries[a].t || 0) - (entries[b].t || 0))
        .slice(0, keys.length - CACHE_LIMIT)
        .forEach((key) => {
          delete entries[key];
        });
    }
    globalThis.localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify({ v: 1, e: entries }));
  } catch {
    // Quota or private mode. The cache is an optimisation; losing it is fine.
  }
}

/** Identity of a card for cache purposes; editing the deck invalidates it. */
function cacheKey(card) {
  const id = card.id ? String(card.id) : `${normArtist(card.artist)}-${normTitle(card.title)}`;
  return id || 'unknown';
}

function signature(card) {
  return `${normTitle(card.title)}|${normArtist(card.artist)}`;
}

/**
 * @returns {ResolvedTrack|null|undefined} undefined means "not cached"
 */
function readEntry(key, sig) {
  const entry = readCache()[key];
  if (!entry || typeof entry !== 'object' || entry.s !== sig) return undefined;
  if (entry.miss) {
    return Date.now() - (entry.t || 0) < MISS_TTL_MS ? null : undefined;
  }
  if (typeof entry.u !== 'string' || !entry.u) return undefined;
  return {
    previewUrl: entry.u,
    artworkUrl: typeof entry.w === 'string' ? entry.w : '',
    matchedTitle: typeof entry.mt === 'string' ? entry.mt : '',
    matchedArtist: typeof entry.ma === 'string' ? entry.ma : '',
    matchedYear: typeof entry.my === 'number' ? entry.my : null,
  };
}

function writeEntry(key, sig, track) {
  const entries = readCache();
  entries[key] = track
    ? {
        t: Date.now(),
        s: sig,
        u: track.previewUrl,
        w: track.artworkUrl,
        mt: track.matchedTitle,
        ma: track.matchedArtist,
        my: track.matchedYear,
      }
    : { t: Date.now(), s: sig, miss: 1 };
  writeCache(entries);
}

/**
 * Forget every cached resolution. Exposed for a settings-screen "clear cache".
 * @returns {boolean}
 */
export function clearPreviewCache() {
  try {
    if (globalThis.localStorage) globalThis.localStorage.removeItem(PREVIEW_CACHE_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- resolution */

/** @type {Map<string, Promise<ResolvedTrack|null>>} */
const inflight = new Map();

function searchUrl(term) {
  const params = new URLSearchParams({
    term,
    entity: 'song',
    media: 'music',
    limit: '8',
  });
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

/**
 * Run the searches for one card. Never throws.
 *
 * `answered` distinguishes "the catalogue does not have this" from "we could
 * not ask" - only the first is worth remembering, otherwise one flight-mode
 * turn would poison the cache for a week.
 *
 * @param {Card} card
 * @returns {Promise<{track: ResolvedTrack|null, answered: boolean}>}
 */
async function lookup(card) {
  // Two attempts: the card as written, then a scrubbed form. The second one
  // rescues titles with parentheticals or "feat." credits the catalogue spells
  // differently. Note that neither query ever contains the year.
  const verbatim = `${String(card.title || '').trim()} ${String(card.artist || '').trim()}`.trim();
  const scrubbed = `${normTitle(card.title)} ${normArtist(card.artist)}`.trim();
  const terms = scrubbed && scrubbed !== verbatim.toLowerCase() ? [verbatim, scrubbed] : [verbatim];
  let answered = false;

  for (const term of terms) {
    if (!term) continue;
    let payload;
    try {
      payload = await jsonp(searchUrl(term), { timeoutMs: LOOKUP_TIMEOUT_MS });
    } catch {
      // Offline, blocked, rate-limited or timed out. Rephrasing cannot fix any
      // of those, and a second 8-second stall in front of a player waiting to
      // hear a song is worse than falling straight through to the fallback.
      return { track: null, answered };
    }
    const results =
      payload && typeof payload === 'object' && Array.isArray(payload.results)
        ? payload.results
        : null;
    if (!results) continue;
    answered = true;
    const best = chooseBest(results, card);
    if (best) return { track: best, answered: true };
  }
  return { track: null, answered };
}

/**
 * Resolve a card to a playable preview.
 *
 * Cached in localStorage (capped at 500 entries, oldest evicted) so a replayed
 * deck costs nothing, and deduplicated in memory so a prefetch and a tap for
 * the same card share one request.
 *
 * @param {Card} card
 * @returns {Promise<ResolvedTrack|null>} null whenever the caller should fall
 *   back to `streamingLinks(card)`
 */
export async function resolveTrack(card) {
  if (!card || typeof card !== 'object' || (!card.title && !card.artist)) return null;

  const key = cacheKey(card);
  const sig = signature(card);

  const cached = readEntry(key, sig);
  if (cached !== undefined) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = lookup(card)
      .then(({ track, answered }) => {
        // A hit is cached forever; a genuine "not in the catalogue" is cached
        // briefly; an unreachable network is not cached at all, so the next
        // turn on a better connection tries again.
        if (track || answered) writeEntry(key, sig, track);
        return track;
      })
      .catch(() => null)
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }

  try {
    return await pending;
  } catch {
    return null;
  }
}

/**
 * Warm the next card's resolution while the current one is playing, so the
 * turn change feels instant. Shares the cache and the in-flight map with
 * resolveTrack, and never rejects - a failed prefetch is not an error.
 *
 * @param {Card} card
 * @returns {Promise<ResolvedTrack|null>}
 */
export function prefetch(card) {
  return resolveTrack(card).catch(() => null);
}

/* -------------------------------------------------------------- fallback */

/**
 * Search links for the "I cannot play this here" path. Every one of these
 * reveals the title, so the UI must put them behind a confirmation.
 *
 * @param {Card} card
 * @returns {{spotify: string, appleMusic: string, youtube: string}}
 */
export function streamingLinks(card) {
  const title = String((card && card.title) || '').trim();
  const artist = String((card && card.artist) || '').trim();
  const query = encodeURIComponent(`${title} ${artist}`.trim());
  return {
    spotify: `https://open.spotify.com/search/${query}`,
    appleMusic: `https://music.apple.com/us/search?term=${query}`,
    youtube: `https://www.youtube.com/results?search_query=${query}`,
  };
}

/* ---------------------------------------------------------------- player */

/**
 * @typedef {object} PlayerState
 * @property {'play'|'pause'|'stop'|'ended'|'time'|'loaded'|'error'} type
 * @property {boolean} playing
 * @property {number} currentTime
 * @property {number} duration 0 until metadata arrives
 * @property {string} src
 * @property {Error|null} error
 */

/** @type {ReturnType<typeof createPlayer>|null} */
let player = null;

/**
 * The shared <audio> element.
 *
 * iOS only honours playback that starts inside a user gesture, and it counts
 * the *element* as blessed by that first gesture - so there is exactly one
 * element for the whole app, it is not created until someone taps play, and it
 * is never replaced. `preload` stays "none" until we have a URL to want, so
 * merely opening the play screen costs no bandwidth. play()'s promise is
 * always caught: an autoplay rejection is an expected outcome here, not a bug,
 * and an unhandled rejection in a game running on someone's phone is noise
 * nobody will ever see.
 *
 * @returns {ReturnType<typeof createPlayer>}
 */
export function getPlayer() {
  if (!player) player = createPlayer();
  return player;
}

function createPlayer() {
  /** @type {HTMLAudioElement|null} */
  let el = null;
  /** @type {Set<(state: PlayerState) => void>} */
  const listeners = new Set();
  let currentUrl = '';
  /** @type {Error|null} */
  let lastError = null;
  let ticking = false;
  let frame = 0;

  const snapshot = (type) => ({
    type,
    playing: !!el && !el.paused && !el.ended,
    currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
    duration: el && Number.isFinite(el.duration) ? el.duration : 0,
    src: currentUrl,
    error: lastError,
  });

  const emit = (type) => {
    const state = snapshot(type);
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // One bad subscriber must not stop the others (or the audio).
      }
    }
  };

  // timeupdate only fires about four times a second, which makes a 30-second
  // progress ring visibly step. Drive it from rAF while playing instead, and
  // let the browser pause the loop when the tab is hidden.
  const stopTicking = () => {
    ticking = false;
    if (frame && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(frame);
    }
    frame = 0;
  };

  const tick = () => {
    if (!ticking) return;
    emit('time');
    if (typeof globalThis.requestAnimationFrame === 'function') {
      frame = globalThis.requestAnimationFrame(tick);
    } else {
      ticking = false;
    }
  };

  const startTicking = () => {
    if (ticking || typeof globalThis.requestAnimationFrame !== 'function') return;
    ticking = true;
    frame = globalThis.requestAnimationFrame(tick);
  };

  const buildElement = () => {
    const node = /** @type {HTMLAudioElement} */ (document.createElement('audio'));
    node.preload = 'none';
    // playsinline in all three spellings: iOS will otherwise try to take a
    // media element full-screen, which would cover the game.
    node.playsInline = true;
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');
    node.setAttribute('aria-hidden', 'true');
    node.style.display = 'none';
    node.addEventListener('play', () => {
      lastError = null;
      startTicking();
      emit('play');
    });
    node.addEventListener('pause', () => {
      stopTicking();
      emit('pause');
    });
    node.addEventListener('ended', () => {
      stopTicking();
      emit('ended');
    });
    node.addEventListener('loadedmetadata', () => emit('loaded'));
    node.addEventListener('timeupdate', () => {
      if (!ticking) emit('time');
    });
    node.addEventListener('error', () => {
      stopTicking();
      lastError = new Error('audio: playback failed');
      emit('error');
    });
    const parent = document.body || document.documentElement;
    if (parent && parent.appendChild) parent.appendChild(node);
    return node;
  };

  const ensureElement = () => {
    if (el) return el;
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      el = buildElement();
    } catch {
      // No usable media element (a stripped-down webview, a test double). The
      // caller sees `false` from play() and shows the streaming fallback.
      el = null;
    }
    return el;
  };

  /**
   * Start (or resume) playback. Call this from a tap handler.
   * @param {string} [url] omit to resume whatever is loaded
   * @returns {Promise<boolean>} false when the browser refused
   */
  const play = async (url) => {
    const node = ensureElement();
    if (!node) return false;
    const next = typeof url === 'string' && url ? url : currentUrl;
    if (!next) return false;
    if (next !== currentUrl) {
      currentUrl = next;
      lastError = null;
      node.preload = 'auto';
      node.src = next;
      try {
        node.load();
      } catch {
        // Safari can throw on load() for an unsupported source; play() below
        // will surface the same failure through its rejection.
      }
    }
    try {
      const started = node.play();
      if (started && typeof started.then === 'function') await started;
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('audio: play was blocked');
      emit('error');
      return false;
    }
  };

  const pause = () => {
    if (!el) return;
    try {
      el.pause();
    } catch {
      // Nothing loaded; there is nothing to pause.
    }
  };

  /** Pause and rewind, so the next tap replays from the top. */
  const stop = () => {
    if (!el) return;
    pause();
    try {
      el.currentTime = 0;
    } catch {
      // Seeking before metadata exists throws; the reload will reset it anyway.
    }
    stopTicking();
    emit('stop');
  };

  /**
   * @param {number} seconds
   * @returns {number} where playback actually landed
   */
  const seek = (seconds) => {
    if (!el) return 0;
    const target = Number(seconds);
    if (!Number.isFinite(target)) return el.currentTime || 0;
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
    const clamped = Math.max(0, Math.min(target, max === Infinity ? target : max));
    try {
      el.currentTime = clamped;
    } catch {
      // Not seekable yet.
    }
    emit('time');
    return el.currentTime || 0;
  };

  /**
   * @param {(state: PlayerState) => void} listener
   * @returns {() => void} unsubscribe
   */
  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    play,
    pause,
    stop,
    seek,
    subscribe,
    /** Alias of subscribe, for callers that read better as `onchange(fn)`. */
    onchange: subscribe,
    /** Current state without waiting for an event. */
    state: () => snapshot('time'),
    get element() {
      return el;
    },
    get src() {
      return currentUrl;
    },
    get playing() {
      return !!el && !el.paused && !el.ended;
    },
    get currentTime() {
      return el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
    },
    get duration() {
      return el && Number.isFinite(el.duration) ? el.duration : 0;
    },
    get error() {
      return lastError;
    },
  };
}
