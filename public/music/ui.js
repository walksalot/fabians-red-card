/**
 * ui.js - the controller that turns the pure modules into a playable game.
 *
 * Why this file is shaped the way it is: `engine.js` owns every rule and is
 * pure, so the only honest way to drive it is a single module-scoped `state`
 * that is *only* ever produced by `state = reduce(state, action)`. Nothing here
 * reaches into a timeline, a token count or a phase and edits it - a rules bug
 * must be impossible to introduce from an event handler.
 *
 * Two consequences run through the whole file:
 *
 *  - There is one delegated click listener on `document`. Every control in
 *    index.html carries `data-action`, so adding a button is a markup change,
 *    never a wiring change, and a screen that is torn down cannot leak a
 *    listener.
 *  - `render()` projects state onto DOM that already exists. It never builds a
 *    screen. The one thing it must not do is run on the audio clock, so the
 *    30-second ring and the countdown are updated in place by `paintAudio()`
 *    (~60x a second) while `render()` only ever runs after an action.
 *
 * `view` holds the things the engine has no opinion about - which screen is up,
 * which sheet is open, the half-finished challenge, the setup form's draft. It
 * is deliberately separate from `state` so no view concern can ever be mistaken
 * for a rule.
 *
 * The year is the secret the whole game protects. It is written to exactly
 * three nodes (#reveal-year and friends) and it is never put in the QR payload;
 * see `listenUrl()`, which builds its object field by field rather than
 * spreading the card, so a future deck field cannot leak by accident.
 *
 * Player photos are the other thing this file is careful with. They are taken on
 * the setup screen, squashed to a 192px square JPEG here and then handed to the
 * engine as part of the player object. They go into localStorage and nowhere
 * else: no upload, no network, and never into the QR payload. The full-size
 * capture (a phone camera hands over ten-plus megapixels) is decoded, drawn once
 * and released inside `squareThumbnail()`; nothing holds the File afterwards.
 */

import {
  ACTIONS,
  BUY_COST,
  createGame,
  reduce,
  deserialize,
  currentPlayer,
  timelineFor,
  tokensFor,
  gapsFor,
  buyBlockedReason,
  challengeBlockedReason,
  challengeFor,
  progressFor,
  scoreboard,
  seatStandings,
  nextPlayer,
  isGameOver,
  winners,
  pendingResult,
  seatColor,
  recap,
} from './engine.js';
import { DECK, DECADES, GENRES, filterDeck } from './deck.js';
import {
  resolveTrack,
  prefetch,
  streamingLinks,
  getPlayer,
  primeBaked,
  bakedTrackSync,
} from './audio.js';
import {
  saveGame,
  loadGame,
  clearGame,
  saveSettings,
  loadSettings,
  savePlayers,
  loadPlayers,
  rememberAvatar,
  avatarsFor,
  loadPeople,
  rememberPerson,
  forgetPerson,
  loadBuyin,
  saveBuyin,
  isPersistent,
  NAMESPACE,
  VERSION,
  KEYS,
  get as getStored,
  set as setStored,
  remove as removeStored,
} from './storage.js';
import { potFor, normaliseHandle, venmoPayUrl } from './buyin.js';
import { qrSvg } from './qr.js';
import { burst } from './confetti.js';
// Namespaced because the cue names (tap, select, place, win) are exactly the
// words this file already uses for other things.
import * as sfx from './sfx.js';

/* ========================================================================== */
/* Constants                                                                  */
/* ========================================================================== */

/** iTunes previews are 30s; the ring is drawn against this when duration is unknown. */
const PREVIEW_SECONDS = 30;

const TARGET_CHOICES = [5, 10, 15];

/**
 * Roughly how long a game runs, per target, so somebody choosing the length can
 * see what they are choosing. Measured against the design prototype's own
 * numbers rather than guessed - a family picking "15" deserves to know that is
 * over an hour before they start, not after.
 */
const SESSION_MINUTES = { 5: 20, 10: 45, 15: 70 };

/**
 * Buy-in steps in whole dollars. $2 is the default because that is what this was
 * built for - a reunion where the pot is a joke with a winner, not a stake.
 * The ceiling is low on purpose: this app cannot move money, so a number big
 * enough to matter is a number somebody typed by accident.
 */
const BUYIN_STEP_CENTS = 100;
const BUYIN_MIN_CENTS = 0;
const BUYIN_MAX_CENTS = 10000;
const BUYIN_DEFAULT_CENTS = 200;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MIN_MISTAKES = 1;
const MAX_MISTAKES = 9;
const YEAR_MIN = 1900;
const YEAR_MAX = new Date().getFullYear();
const DEFAULT_YEAR_GUESS = 1985;

/** Head-room over "one card each plus the target" before we stop nagging about deck size. */
const DECK_SLACK = 10;

/**
 * Avatar pipeline numbers.
 *
 * 192px covers the largest place a photo is ever drawn (the pass screen, capped
 * at 188 CSS px) at 1x and stays sharp enough at 2x for a face; going bigger
 * multiplies the localStorage cost of eight players for no visible gain. 0.72 is
 * where JPEG stops getting smaller much faster than it gets worse on a photo
 * this small.
 */
const PHOTO_SIZE = 192;
const PHOTO_QUALITY = 0.72;

const SCREEN_HEADINGS = {
  home: 'home-title',
  setup: 'setup-title',
  pass: 'pass-title',
  play: 'play-title',
  reveal: 'reveal-title',
  scoreboard: 'scoreboard-title',
  win: 'win-title',
  rules: 'rules-title',
};

const GENRE_LABELS = {
  pop: 'Pop',
  rock: 'Rock',
  hiphop: 'Hip-hop',
  rnb: 'R&B',
  soul: 'Soul',
  country: 'Country',
  dance: 'Dance',
  latin: 'Latin',
  metal: 'Metal',
  folk: 'Folk',
  jazz: 'Jazz',
  reggae: 'Reggae',
  indie: 'Indie',
  disco: 'Disco',
};

const SOURCE_LABELS = {
  preview: 'In-app preview',
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube',
};

const DEFAULT_SETTINGS = {
  skipPass: false,
  sound: true,
  playbackSource: 'preview',
  reducedMotion: false,
};

/**
 * Generic-storage keys owned by this file (KEYS in storage.js lists the shared
 * ones). ACTIVE_BUYIN_KEY is the stake SNAPSHOT taken at Shuffle & start - the
 * winner screen pays from it, never from the live setup draft, so fiddling
 * with the buy-in in a setup that was never started cannot rewrite the pot of
 * the game being resumed. SETUP_DRAFT_KEY is the whole setup form, so a reload
 * mid-setup restores the options as well as the names.
 */
const ACTIVE_BUYIN_KEY = 'buyin-active';
const SETUP_DRAFT_KEY = 'setup';

/**
 * How long a tap burst is swallowed after a tap replaces the screen under the
 * finger. Place-here and Next-player render at the same coordinates, so a
 * double tap used to skip the whole reveal; same story for Play again over the
 * mode rows. 700ms outlasts any accidental burst without ever meeting a
 * deliberate second tap.
 */
const TAP_GUARD_MS = 700;

/** The name inputs' maxlength; the counter under a long name reads against it. */
const NAME_MAX = 16;

/* ========================================================================== */
/* Module state                                                               */
/* ========================================================================== */

/** The one game state. Only ever reassigned from `reduce()` or `createGame()`. */
let state = null;

/** Everything the engine has no opinion about. */
const view = {
  screen: 'home',
  /** Where `rules-back` / `close-scoreboard` return to. */
  returnScreen: 'home',
  menuOpen: false,
  challengeOpen: false,
  challengerId: null,
  /** Guest-list edit mode: chips become remove buttons. */
  peopleEditing: false,
  challengeGap: null,
  lastFocus: null,
  /**
   * Setup form draft, persisted between sessions. Each player is
   * `{ name, photo, skipped, pending }`: `photo` is a data URL or null,
   * `skipped` means "this one deliberately uses the generated initial", and
   * `pending` is true only while a chosen image is being downscaled.
   */
  setup: {
    players: [0, 1, 2, 3].map((i) => playerDraft(i)),
    target: 10,
    mode: 'classic',
    mistakeLimit: 3,
    decades: DECADES.slice(),
    genres: GENRES.slice(),
    /** House rule: three kept cards in a row earns a token. */
    streakBonus: false,
    /**
     * The pot. `amount` is integer CENTS - see buyin.js for why dollars never
     * appear as numbers anywhere near this. `handle` is whatever is typed in the
     * field, raw; it is normalised at the point of use so a half-typed handle
     * does not fight the person typing it.
     */
    buyin: { enabled: false, amount: BUYIN_DEFAULT_CENTS, handle: '' },
  },
  /** Per-card audio bookkeeping; reset on every draw. */
  audio: {
    /** Bumped per card so a slow resolve for a stale card is dropped. */
    token: 0,
    cardId: null,
    resolving: false,
    resolved: null,
    failed: false,
    linksShown: false,
    status: '',
  },
  /**
   * The group's Title/Artist vote in classic + co-op, where the engine has no
   * title/artist gate and the two buttons are only there to settle an
   * "I can name it" claim. Advanced and expert read state.confirmations instead.
   */
  identifyVote: { title: false, artist: false },
  confettiStop: null,
  /**
   * The armed-tap guards on the two destructive controls (End game, and
   * Shuffle & start over an unfinished save). Armed by the first tap, disarmed
   * by a timeout, a sheet close or a screen change - never a dialog, because
   * window.confirm steals focus and looks like a crash on a phone.
   */
  endGameArmed: false,
  startArmed: false,
  /**
   * True once another tab has written a newer save than this tab holds. Every
   * input except the Reload button is refused from then on - a stale tab that
   * keeps playing writes somebody else's turn out of existence.
   */
  stale: false,
};

let settings = { ...DEFAULT_SETTINGS };

/** The shared <audio>; created lazily so merely opening the app costs nothing. */
let audioPlayer = null;

/* ========================================================================== */
/* Tiny DOM helpers                                                           */
/* ========================================================================== */

const el = (id) => document.getElementById(id);

function text(id, value) {
  const node = el(id);
  if (node) node.textContent = String(value);
}

function show(node, visible) {
  if (node) node.hidden = !visible;
}

function pressed(node, on) {
  if (node) node.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function disable(node, off, reason) {
  if (!node) return;
  node.disabled = !!off;
  if (reason) node.title = reason;
  else node.removeAttribute('title');
}

/** Clone a <template>'s single root element. Templates are the only row markup. */
function clone(templateId) {
  const tpl = el(templateId);
  if (!tpl || !tpl.content || !tpl.content.firstElementChild) return null;
  return tpl.content.firstElementChild.cloneNode(true);
}

/** Fill `[data-field="x"]` nodes - including the root itself, which #tpl-chip uses. */
function fill(root, values) {
  for (const key of Object.keys(values)) {
    const selector = `[data-field="${key}"]`;
    const node = root.matches(selector) ? root : root.querySelector(selector);
    if (node) node.textContent = String(values[key]);
  }
}

function replaceChildren(node, children) {
  if (!node) return;
  node.textContent = '';
  const frag = document.createDocumentFragment();
  for (const child of children) if (child) frag.appendChild(child);
  node.appendChild(frag);
}

function announce(message) {
  const node = el('live-status');
  if (node) node.textContent = String(message);
}

/**
 * An error has two audiences: #live-alert for screen readers, and the #toast
 * pill for everyone else - a message only assistive tech can perceive is no
 * feedback at all for a sighted player who just picked a broken photo.
 * The toast is presentation only (it is not a live region); it hides itself
 * after a few seconds, and onClick clears it on the next tap either way.
 */
let toastTimer = null;

function alertUser(message) {
  const words = String(message);
  const node = el('live-alert');
  if (node) node.textContent = words;
  const toast = el('toast');
  if (!toast) return;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toast.textContent = words;
  show(toast, !!words);
  if (words) {
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      show(el('toast'), false);
    }, 4500);
  }
}

/* ========================================================================== */
/* Seat colour + avatars                                                      */
/* ========================================================================== */

/**
 * The seat hex at an alpha, as `rgba()`.
 *
 * Done in JS rather than with `color-mix()` because this app has to work on
 * iOS Safari 16.0, which shipped before `color-mix()` did, and a tint that
 * silently evaluates to nothing would leave the play screen with no accent at
 * all - the one thing this whole feature exists to prevent.
 */
function seatAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex : '');
  if (!match) return `rgba(169, 124, 255, ${alpha})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Publish one player's accent onto an element for its subtree to read. */
/** WCAG relative luminance. Only used to decide a text colour. */
function luminance(hex) {
  const channel = (offset) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Ink or white for a label sitting ON a seat colour, whichever has the better
 * contrast against it.
 *
 * This has to be computed rather than fixed. The design's crayon palette runs
 * from a dark teal to a light lime, and no single label colour survives both:
 * white on #74b816 is 2.4:1, which is unreadable, while ink on #7048e8 is 3.0:1.
 * Picking per seat puts every one of the eight at 4.2:1 or better - comfortably
 * over the 3:1 WCAG asks of text this large, and over 4.5:1 for most of them.
 */
function seatInk(hex) {
  const seat = luminance(hex);
  const vsWhite = 1.05 / (seat + 0.05);
  const vsInk = (seat + 0.05) / (luminance('#241c15') + 0.05);
  return vsWhite >= vsInk ? '#ffffff' : '#241c15';
}

/**
 * The circle an initial sits on. Usually the seat colour itself - but the
 * initial is 16px bold, under WCAG's large-text threshold, so its ink needs
 * 4.5:1 and two of the eight crayons leave white at 4.2-4.35. Those are nudged
 * (darkened under white ink, lightened under dark ink) until the pairing
 * crosses the line; the seat colour everywhere else - borders, tints, meters -
 * stays exactly what the engine handed out.
 */
function seatFill(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const dark = seatInk(hex) !== '#ffffff';
  const value = Number.parseInt(match[1], 16);
  let [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const toHex = () =>
    `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  const contrast = () => {
    const seat = luminance(toHex());
    return dark ? (seat + 0.05) / (luminance('#241c15') + 0.05) : 1.05 / (seat + 0.05);
  };
  for (let i = 0; i < 12 && contrast() < 4.5; i += 1) {
    if (dark) {
      r = Math.min(255, Math.round(r * 1.06 + 6));
      g = Math.min(255, Math.round(g * 1.06 + 6));
      b = Math.min(255, Math.round(b * 1.06 + 6));
    } else {
      r = Math.round(r * 0.93);
      g = Math.round(g * 0.93);
      b = Math.round(b * 0.93);
    }
  }
  return toHex();
}

function applySeat(node, color) {
  if (!node) return;
  const hex = typeof color === 'string' && color ? color : seatColor(0);
  node.style.setProperty('--seat', hex);
  node.style.setProperty('--seat-soft', seatAlpha(hex, 0.18));
  node.style.setProperty('--seat-glow', seatAlpha(hex, 0.45));
  node.style.setProperty('--seat-ink', seatInk(hex));
  node.style.setProperty('--seat-fill', seatFill(hex));
}

/**
 * First character of a name, upper-cased.
 * Spread rather than `[0]` so an emoji or an accented astral character comes
 * back whole instead of as half a surrogate pair.
 */
function initialFor(name) {
  const trimmed = String(name === null || name === undefined ? '' : name).trim();
  if (!trimmed) return '?';
  return [...trimmed][0].toLocaleUpperCase();
}

/**
 * Only a data URL for an image is ever allowed near an `<img src>`. Photos come
 * back out of localStorage, which a curious teenager can edit, and this is the
 * one place a hand-written value would turn into a request.
 */
function safePhoto(value) {
  return typeof value === 'string' && /^data:image\//.test(value) ? value : null;
}

/**
 * Paint one `.avatar` block from anything shaped `{ name, photo, color }` -
 * a player, a scoreboard row, a setup draft.
 */
function paintAvatar(node, person) {
  if (!node) return;
  const photo = safePhoto(person && person.photo);
  applySeat(node, person && person.color);
  node.dataset.photo = photo ? 'true' : 'false';
  const img = node.querySelector('[data-field="photo"]');
  if (img) {
    // Never leave a stale src behind a hidden <img>: it would keep the old
    // player's face one CSS rule away from the screen.
    if (photo) {
      if (img.getAttribute('src') !== photo) img.src = photo;
    } else if (img.hasAttribute('src')) {
      img.removeAttribute('src');
    }
  }
  const initial = node.querySelector('[data-field="initial"]');
  if (initial) initial.textContent = initialFor(person && person.name);
}

/* ========================================================================== */
/* Taking a photo                                                             */
/* ========================================================================== */

/**
 * File a face in the avatar library - unless the row still carries a
 * "Player N" placeholder. storage.js's rememberPerson refuses those names as
 * not-a-person; filing an avatar under one would offer this face to every
 * future unnamed row, so the same rule applies at every call site here.
 */
function fileAvatar(name, photo) {
  const trimmed = (name || '').trim();
  if (!trimmed || /^player\s*\d+$/i.test(trimmed)) return;
  rememberAvatar(trimmed, photo);
}

/** A fresh setup row. */
function playerDraft(index, name) {
  return {
    name: typeof name === 'string' && name ? name : `Player ${index + 1}`,
    photo: null,
    skipped: false,
    pending: false,
  };
}

/**
 * Decode `file` into something drawable.
 *
 * `createImageBitmap` with `imageOrientation: 'from-image'` is the cheap way to
 * respect EXIF - it hands back an already-rotated bitmap, so a portrait taken
 * on a phone held sideways is not stored on its side. Where it is missing (or
 * refuses the option, which some older WebKit builds do) we fall back to a plain
 * `Image`; those browsers apply EXIF themselves when drawing to a canvas.
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Old implementations reject the options object rather than ignoring it.
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to the <img> path */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A centre-cropped square JPEG data URL, at PHOTO_SIZE.
 *
 * The whole point is that the full-resolution capture exists for as short a
 * time as possible: it is decoded, drawn once into a 192px canvas and then
 * closed. Nothing keeps the File, the bitmap or the original pixels afterwards,
 * and the raw image is never stored anywhere.
 */
async function squareThumbnail(file) {
  const source = await decodeImage(file);
  try {
    const width = source.width || source.naturalWidth || 0;
    const height = source.height || source.naturalHeight || 0;
    if (!width || !height) throw new Error('image has no size');
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      source,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      PHOTO_SIZE,
      PHOTO_SIZE,
    );
    const url = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
    // Drop the backing store now rather than waiting for the next GC.
    canvas.width = 0;
    canvas.height = 0;
    if (!/^data:image\/jpeg/.test(url)) throw new Error('canvas would not encode');
    return url;
  } finally {
    if (source && typeof source.close === 'function') source.close();
  }
}

/** True once every player has either a photo or a deliberate skip. */
function rosterReady() {
  return view.setup.players.every((p) => !!p.photo || p.skipped);
}

function photosOutstanding() {
  return view.setup.players.filter((p) => !p.photo && !p.skipped).length;
}

/**
 * Persist the roster - names and faces - so a regular group does not re-shoot
 * everybody every week. storage.js drops the photos first if the quota bites,
 * because losing the faces is survivable and losing the names is just rude.
 */
let rosterSaveTimer = null;

function rememberRoster() {
  if (rosterSaveTimer !== null) {
    clearTimeout(rosterSaveTimer);
    rosterSaveTimer = null;
  }
  savePlayers(
    view.setup.players.map((p) => ({
      name: (p.name || '').trim(),
      photo: p.photo,
      skipped: !!p.skipped,
    })),
  );
}

/**
 * The keystroke path into rememberRoster. Debounced, because a name is typed
 * one input event at a time and sixteen JSON writes per name is silly - but it
 * has to exist at all: a name typed after the last photo/skip action used to
 * be the one thing a mid-setup reload silently reverted.
 */
function queueRosterSave() {
  if (rosterSaveTimer !== null) clearTimeout(rosterSaveTimer);
  rosterSaveTimer = window.setTimeout(() => {
    rosterSaveTimer = null;
    rememberRoster();
  }, 500);
}

/**
 * The rest of the setup form - target, mode, mistakes, filters, house rules,
 * stake. The roster taught the lesson: restoring the names but not the options
 * makes a reload look like the app forgot on purpose, so everything set on
 * this screen persists, debounced on the same clock as the names.
 */
let setupSaveTimer = null;

function saveSetupDraft() {
  if (setupSaveTimer !== null) {
    clearTimeout(setupSaveTimer);
    setupSaveTimer = null;
  }
  setStored(SETUP_DRAFT_KEY, {
    target: view.setup.target,
    mode: view.setup.mode,
    mistakeLimit: view.setup.mistakeLimit,
    decades: view.setup.decades,
    genres: view.setup.genres,
    streakBonus: view.setup.streakBonus,
    buyin: {
      enabled: view.setup.buyin.enabled,
      amount: view.setup.buyin.amount,
      handle: view.setup.buyin.handle,
    },
  });
}

function queueSetupSave() {
  if (setupSaveTimer !== null) clearTimeout(setupSaveTimer);
  setupSaveTimer = window.setTimeout(() => {
    setupSaveTimer = null;
    saveSetupDraft();
  }, 500);
}

/** Restore the draft, field by field - a corrupt or partial payload restores
 * what it can and defaults the rest, never throws. */
function loadSetupDraft() {
  const saved = getStored(SETUP_DRAFT_KEY, null);
  if (!saved || typeof saved !== 'object') return;
  if (TARGET_CHOICES.includes(saved.target)) view.setup.target = saved.target;
  if (['classic', 'advanced', 'expert', 'coop'].includes(saved.mode)) view.setup.mode = saved.mode;
  if (Number.isInteger(saved.mistakeLimit)) {
    view.setup.mistakeLimit = Math.min(MAX_MISTAKES, Math.max(MIN_MISTAKES, saved.mistakeLimit));
  }
  // Empty selections are never restored: empty means "everything" to the
  // filter, and the chips would all sit unpressed over a full deck.
  if (Array.isArray(saved.decades)) {
    const decades = saved.decades.filter((d) => DECADES.includes(d));
    if (decades.length) view.setup.decades = decades;
  }
  if (Array.isArray(saved.genres)) {
    const genres = saved.genres.filter((g) => GENRES.includes(g));
    if (genres.length) view.setup.genres = genres;
  }
  view.setup.streakBonus = saved.streakBonus === true;
  const buyin = saved.buyin;
  if (buyin && typeof buyin === 'object') {
    view.setup.buyin = {
      enabled: buyin.enabled === true,
      amount:
        Number.isInteger(buyin.amount) &&
        buyin.amount >= BUYIN_MIN_CENTS &&
        buyin.amount <= BUYIN_MAX_CENTS
          ? buyin.amount
          : view.setup.buyin.amount,
      handle: typeof buyin.handle === 'string' ? buyin.handle : '',
    };
  }
}

/** Handle one chosen file. Async, so the draft is re-checked after the await. */
async function acceptPhoto(draft, file) {
  if (!draft || !file) return;
  if (file.type && !/^image\//.test(file.type)) {
    alertUser('That file is not a photo. Pick an image, or tap Skip photo.');
    return;
  }
  draft.pending = true;
  render();

  let photo = null;
  try {
    photo = await squareThumbnail(file);
  } catch {
    photo = null;
  }

  // The row may have been deleted while a big capture was being decoded.
  if (!view.setup.players.includes(draft)) return;
  draft.pending = false;
  if (!photo) {
    alertUser('That photo could not be read. Try another one, or tap Skip photo.');
    render();
    return;
  }
  draft.photo = photo;
  draft.skipped = false;
  rememberRoster();
  // File it under the name too, so this face is offered next time even if the
  // roster has moved on. (Not under a placeholder - onInput files it when the
  // real name is committed.)
  fileAvatar(draft.name, photo);
  render();
  announce(`Photo added for ${draft.name || 'this player'}.`);
}

/**
 * A row nobody has touched: still a placeholder name, no photo, not skipped.
 * ANY "Player N" counts, not just the one matching this row's position -
 * removing a row shifts every draft down a seat, and a "Player 3" sitting in
 * row 2 is still an empty row, not somebody called Player 3. (storage.js makes
 * the same call: rememberPerson refuses these names as not-a-person.)
 */
function isUntouchedRow(draft) {
  const name = (draft.name || '').trim();
  return !draft.photo && !draft.skipped && (name === '' || /^player\s*\d+$/i.test(name));
}

/**
 * The lowest "Player N" placeholder no current row is using, so an added row
 * never duplicates a name already on the roster (remove row 1, add a row, and
 * counting rows alone mints a second "Player 4").
 */
function freePlaceholderName() {
  const taken = new Set(view.setup.players.map((p) => (p.name || '').trim().toLowerCase()));
  let n = 1;
  while (taken.has(`player ${n}`)) n += 1;
  return `Player ${n}`;
}

/**
 * The guest list: everybody who has played before, one tap to seat them.
 *
 * The avatar library solves half the problem - it puts a face back once the
 * name is typed. This is the other half: not typing the name either.
 */
function paintPeople() {
  const block = el('people-block');
  const list = el('people-list');
  if (!block || !list) return;

  const people = loadPeople();
  show(block, people.length > 0);
  if (!people.length) {
    view.peopleEditing = false;
    block.dataset.editing = 'false';
    replaceChildren(list, []);
    return;
  }

  block.dataset.editing = view.peopleEditing ? 'true' : 'false';
  pressed(el('btn-people-edit'), !!view.peopleEditing);
  const editBtn = el('btn-people-edit');
  if (editBtn) editBtn.textContent = view.peopleEditing ? 'Done' : 'Edit';
  const hint = el('people-hint');
  if (hint) {
    hint.textContent = view.peopleEditing
      ? 'Tap the cross to forget somebody.'
      : 'Tap somebody to add them.';
  }

  const seated = new Set(
    view.setup.players.map((p) => (p.name || '').trim().toLowerCase()).filter(Boolean),
  );
  const full = view.setup.players.length >= MAX_PLAYERS
    && !view.setup.players.some((p, i) => isUntouchedRow(p, i));

  replaceChildren(
    list,
    people.map((person) => {
      const node = clone('tpl-person');
      if (!node) return null;
      const item = node.querySelector('.person');
      const add = node.querySelector('.person__add');
      const forget = node.querySelector('.person__forget');
      const already = seated.has(person.name.toLowerCase());
      if (item) item.dataset.name = person.name;
      if (add) {
        add.dataset.name = person.name;
        add.setAttribute(
          'aria-label',
          already ? `${person.name} is already playing` : `Add ${person.name} to this game`,
        );
        disable(
          add,
          already || full,
          already ? 'Already in this game' : full ? 'Eight players is the maximum' : undefined,
        );
        // The reason rides on the chip, not in a title attribute a phone never
        // shows - a dead-looking chip with no explanation reads as a bug.
        const note = node.querySelector('[data-field="note"]');
        if (note) {
          note.textContent = already ? 'already playing' : full ? 'table is full' : '';
          show(note, already || full);
        }
      }
      if (forget) {
        forget.dataset.name = person.name;
        forget.setAttribute('aria-label', `Forget ${person.name}`);
      }
      fill(node, { name: person.name });
      paintAvatar(node.querySelector('.avatar'), person);
      return node;
    }),
  );
}

/** Seat somebody from the guest list, reusing an empty row before adding one. */
function addPersonToGame(name) {
  const person = loadPeople().find((p) => p.name.toLowerCase() === String(name).toLowerCase());
  if (!person) return;
  const already = view.setup.players.some(
    (p) => (p.name || '').trim().toLowerCase() === person.name.toLowerCase(),
  );
  if (already) return;

  // Fill the first row nobody has touched rather than appending a ninth: on a
  // fresh setup that is four "Player N" rows waiting to be replaced, and adding
  // beside them would be nonsense.
  const slot = view.setup.players.findIndex((p, i) => isUntouchedRow(p, i));
  const photo = person.photo || avatarsFor(person.name)[0] || null;
  const draft = {
    name: person.name,
    photo,
    skipped: !photo && person.skipped,
    pending: false,
  };

  if (slot !== -1) {
    view.setup.players[slot] = draft;
  } else {
    if (view.setup.players.length >= MAX_PLAYERS) return;
    view.setup.players.push(draft);
  }
  rememberRoster();
  render();
  announce(`${person.name} added.`);
}

/**
 * Offer the faces we already hold for the name in this row.
 *
 * Keyed on the name rather than the seat, because the name is the only thing
 * about a player that survives being renamed, reordered or sitting a game out.
 * The photo currently on the row is filtered out - offering somebody the face
 * they are already wearing is just a dead button.
 */
function paintSavedAvatars(row, draft, index) {
  const box = row.querySelector('[data-role="saved-avatars"]');
  const list = row.querySelector('[data-role="saved-list"]');
  if (!box || !list) return;

  const name = (draft.name || '').trim();
  const saved = avatarsFor(name).filter((photo) => photo !== draft.photo);
  show(box, saved.length > 0);
  if (!saved.length) {
    // The signature must go with the children: keeping it meant a name typed
    // through an empty state and back to the same face-set matched the stale
    // signature and left the heading over an empty box.
    delete list.dataset.signature;
    replaceChildren(list, []);
    return;
  }

  const labelNode = row.querySelector('[data-field="saved-label"]');
  if (labelNode) labelNode.textContent = `Previous ${name} photos`;

  // Rebuilding on every keystroke would be wasteful and would fight the caret,
  // so bail out when the same faces are already on screen.
  const signature = saved.join('|');
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;

  replaceChildren(
    list,
    saved.map((photo, i) => {
      const node = clone('tpl-saved-avatar');
      if (!node) return null;
      const button = node.querySelector('.saved-avatar');
      const img = node.querySelector('[data-field="photo"]');
      if (img) img.src = photo;
      if (button) {
        button.dataset.photoIndex = String(i);
        button.dataset.playerIndex = String(index);
        button.setAttribute('aria-label', `Use this saved photo for ${name || 'this player'}`);
      }
      return node;
    }),
  );
}

/** Put a remembered face back on a row - no camera, no photo library, one tap. */
function applySavedPhoto(index, photoIndex) {
  const draft = view.setup.players[index];
  if (!draft) return;
  const saved = avatarsFor(draft.name).filter((photo) => photo !== draft.photo);
  const photo = saved[photoIndex];
  if (!photo) return;
  draft.photo = photo;
  draft.skipped = false;
  draft.pending = false;
  rememberRoster();
  // Re-file it so the one they just picked is the first offered next time.
  fileAvatar(draft.name, photo);
  render();
  announce(`Photo set for ${draft.name || 'this player'}.`);
}

/** The escape hatch: nobody's grandmother can block the game from starting. */
function skipPhoto(index) {
  const draft = view.setup.players[index];
  if (!draft) return;
  const next = !(draft.skipped && !draft.photo);
  draft.skipped = next;
  if (next) draft.photo = null;
  rememberRoster();
  render();
  announce(
    next
      ? `${draft.name || 'This player'} will use their initial.`
      : `${draft.name || 'This player'} still needs a photo.`,
  );
}

/* ========================================================================== */
/* Settings                                                                   */
/* ========================================================================== */

function applySettings() {
  if (settings.reducedMotion) document.body.dataset.motion = 'reduce';
  else delete document.body.dataset.motion;

  // The Sound switch governs the interface cues as well as the previews - a
  // player who turned sound off in a quiet room meant all of it.
  sfx.setEnabled(!!settings.sound);

  const skip = el('opt-skip-pass');
  if (skip) skip.checked = !!settings.skipPass;
  const sound = el('opt-sound');
  if (sound) sound.checked = !!settings.sound;
  const motion = el('opt-reduced-motion');
  if (motion) motion.checked = !!settings.reducedMotion;
  for (const id of ['playback-source', 'opt-playback-source']) {
    const select = el(id);
    if (select) select.value = settings.playbackSource;
  }
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  applySettings();
}

function loadSavedSettings() {
  const saved = loadSettings();
  if (saved && typeof saved === 'object') {
    settings = {
      skipPass: !!saved.skipPass,
      sound: saved.sound !== false,
      playbackSource:
        typeof saved.playbackSource === 'string' && SOURCE_LABELS[saved.playbackSource]
          ? saved.playbackSource
          : 'preview',
      reducedMotion: !!saved.reducedMotion,
    };
  }
  // A phone that asks for less motion gets it without having to find the switch.
  if (!saved && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settings.reducedMotion = true;
  }
}

function motionIsReduced() {
  if (settings.reducedMotion) return true;
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* ========================================================================== */
/* Dispatch + persistence                                                     */
/* ========================================================================== */

/** The only way state ever changes. Autosaves, then repaints. */
function dispatch(action) {
  if (!state) return null;
  const next = reduce(state, action);
  if (next.lastError && next.lastError.reason) {
    alertUser(next.lastError.reason);
  }
  state = next;
  persist();
  render();
  return state;
}

/**
 * The save slot's write counter, as this tab last wrote or loaded it. It rides
 * inside the saved payload (`__writes` - deserialize tolerates the extra
 * field), and it is what stops a stale second tab from time-machining the
 * game: before writing, the stored counter is read back, and a counter AHEAD
 * of ours means another tab has moved the game on - so this tab must not
 * write, it must stop and ask for a reload.
 */
let saveCounter = 0;

/** Whether the couldn't-save toast has fired for the current run of failures. */
let saveWarned = false;

function storedWriteCount() {
  const stored = loadGame();
  return stored && Number.isFinite(stored.__writes) ? stored.__writes : 0;
}

function persist(replacing) {
  if (!state) return;
  const stored = storedWriteCount();
  // `replacing` is Shuffle & start deliberately taking the slot over; anything
  // else yields to a newer save rather than clobbering it.
  if (!replacing && stored > saveCounter) {
    enterStaleState();
    return;
  }
  saveCounter = Math.max(saveCounter, stored) + 1;
  // Finished games are saved too, not cleared: switching to the Venmo app to
  // settle the pot reloads the tab on most phones, and the winner screen -
  // recap, payout QR and all - has to still be reachable afterwards. A
  // finished save is replaced the next time a game starts.
  const ok = saveGame({ ...state, __writes: saveCounter });
  if (!ok) {
    // Once per run of failures, and again only after a success-then-failure -
    // a toast per turn would drown the game it is warning about.
    if (!saveWarned) {
      saveWarned = true;
      alertUser("Couldn't save — storage is full. The game still works, but a reload loses it.");
    }
  } else {
    saveWarned = false;
  }
}

/**
 * The stale-tab dead end: another tab has written a newer save, so every input
 * here would either lie or destroy progress. A full-screen notice with a
 * Reload button blocks the lot; onClick and onKeydown honour `view.stale` as
 * well, in case the overlay is missing from a stripped-down DOM.
 */
function enterStaleState() {
  if (view.stale) return;
  view.stale = true;
  stopAudio();
  const overlay = el('stale-overlay');
  if (overlay) {
    show(overlay, true);
    const button = overlay.querySelector('[data-action="reload-page"]');
    if (button) requestAnimationFrame(() => button.focus());
  }
  alertUser('This game changed in another tab — reload to catch up.');
}

/* ========================================================================== */
/* Screens                                                                    */
/* ========================================================================== */

function showScreen(name) {
  const leavingPlay = view.screen === 'play' && name !== 'play';
  view.screen = name;
  document.body.dataset.screen = name;
  if (leavingPlay) stopAudio();
  // A screen change stands down both armed-tap guards - the second tap has to
  // land on the same screen the first one armed.
  disarmEndGame();
  disarmStartGame();
  render();
  focusHeading(name);
}

function focusHeading(name) {
  const heading = el(SCREEN_HEADINGS[name]);
  if (!heading) return;
  // A frame's grace so the newly-shown section is focusable and scrolled.
  requestAnimationFrame(() => {
    try {
      heading.focus({ preventScroll: true });
    } catch {
      heading.focus();
    }
    const scroller = heading.closest('.screen');
    if (scroller) scroller.scrollTop = 0;
    // The page itself scrolls on any screen that outgrows the viewport - setup,
    // the rules, a pass screen with eight players in the standings - and a
    // leftover offset would drop the next person into the middle of theirs.
    window.scrollTo(0, 0);
  });
}

/* ========================================================================== */
/* Home                                                                       */
/* ========================================================================== */

/**
 * The saved game, finished or not - the home screen offers an unfinished one
 * as "Resume game" and a finished one as "See final result" (the pot is often
 * still being collected when the tab reloads).
 */
function savedGame() {
  const raw = loadGame();
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    clearGame();
    // The stake snapshot belongs to that save; it goes with it.
    removeStored(ACTIVE_BUYIN_KEY);
    return null;
  }
}

function renderHome() {
  // The deck figures ship baked into the markup so the line is honest with no
  // JS at all; this keeps them honest after the deck grows.
  const years = DECK.reduce(
    (span, card) => [Math.min(span[0], card.year), Math.max(span[1], card.year)],
    [Infinity, -Infinity],
  );
  if (Number.isFinite(years[0])) {
    text('home-deck-stat', `${DECK.length} songs · ${years[0]}–${years[1]}`);
  }

  const saved = savedGame();
  const button = el('btn-resume-game');
  show(button, !!saved);
  if (saved) {
    const names = saved.players.map((p) => p.name).join(', ');
    if (saved.phase === 'game-over') {
      text('btn-resume-title', 'See final result');
      text('btn-resume-detail', `Game over — ${names}`);
    } else {
      text('btn-resume-title', 'Resume game');
      text('btn-resume-detail', `Turn ${saved.turn} — ${names}`);
    }
  }

  show(el('home-storage-warn'), !isPersistent());
}

/* ========================================================================== */
/* Setup                                                                      */
/* ========================================================================== */

/**
 * Restore the last roster. Tolerates the old shape (a plain array of names)
 * because a phone that played last week has one of those in localStorage.
 */
function loadSavedPlayers() {
  const saved = loadPlayers();
  if (!Array.isArray(saved) || saved.length < MIN_PLAYERS) return;
  const roster = saved
    .map((entry, index) => {
      const raw = typeof entry === 'string' ? { name: entry } : entry;
      if (!raw || typeof raw !== 'object') return null;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) return null;
      const draft = playerDraft(index, name);
      draft.photo = safePhoto(raw.photo);
      draft.skipped = draft.photo ? false : raw.skipped === true;
      return draft;
    })
    .filter((entry) => entry !== null)
    .slice(0, MAX_PLAYERS);
  if (roster.length >= MIN_PLAYERS) view.setup.players = roster;
}

/**
 * Restore the stake. Also the reason the winner screen can still name a pot
 * after a reload: nothing about the buy-in lives in game state, so this is
 * where it comes back from.
 */
function loadSavedBuyin() {
  const saved = loadBuyin();
  if (!saved) return;
  view.setup.buyin = {
    enabled: saved.enabled,
    amount: saved.amount,
    handle: saved.handle || '',
  };
}

/**
 * Rebuild the chip rows from deck.js, which is the authority on what exists.
 * The leading "All decades" / "All genres" chip ships inside each container and
 * MUST survive the rebuild - replaceChildren without it deleted the only
 * one-tap way back to a full deck.
 */
function buildChips() {
  const decadeBox = el('decade-chips');
  if (decadeBox) {
    replaceChildren(decadeBox, [
      el('btn-decades-all'),
      ...DECADES.map((decade) => {
        const chip = clone('tpl-chip');
        if (!chip) return null;
        chip.dataset.action = 'toggle-decade';
        chip.dataset.decade = String(decade);
        delete chip.dataset.genre;
        fill(chip, { label: `${String(decade).slice(2)}s` });
        return chip;
      }),
    ]);
  }
  const genreBox = el('genre-chips');
  if (genreBox) {
    replaceChildren(genreBox, [
      el('btn-genres-all'),
      ...GENRES.map((genre) => {
        const chip = clone('tpl-chip');
        if (!chip) return null;
        chip.dataset.action = 'toggle-genre';
        chip.dataset.genre = genre;
        delete chip.dataset.decade;
        fill(chip, { label: GENRE_LABELS[genre] || genre });
        return chip;
      }),
    ]);
  }
}

const PHOTO_STATUS = {
  none: 'Photo needed',
  photo: 'Photo added',
  skipped: 'Using their initial',
  pending: 'Shrinking the photo...',
};

/**
 * The row's control labels, in one place so the keystroke path and the render
 * path cannot drift: renaming a player must rename what a screen reader hears
 * on the same keystroke, not on the next roster rebuild.
 */
function paintRowLabels(row, draft, index) {
  const person = (draft.name || '').trim() || `player ${index + 1}`;
  const avatar = row.querySelector('.player-row__avatar');
  if (avatar) {
    avatar.setAttribute(
      'aria-label',
      draft.photo ? `Replace the photo for ${person}` : `Add a photo for ${person}`,
    );
  }
  const skip = row.querySelector('[data-action="skip-photo"]');
  if (skip) skip.setAttribute('aria-label', `Skip the photo for ${person}`);
  const remove = row.querySelector('[data-action="remove-player"]');
  if (remove) remove.setAttribute('aria-label', `Remove ${person}`);
}

/**
 * The input clips silently at maxlength, so the last few characters of a long
 * name need a visible count - "Grandma Josephine" becoming "Grandma Josephin"
 * for the whole night should never be a surprise.
 */
function paintNameCount(row, draft) {
  const count = row.querySelector('[data-field="count"]');
  if (!count) return;
  const length = (draft.name || '').length;
  const near = length >= NAME_MAX - 3;
  if (near) count.textContent = `${length}/${NAME_MAX}`;
  show(count, near);
}

function renderPlayerRows() {
  const list = el('player-list');
  if (!list) return;
  const drafts = view.setup.players;
  // Only rebuild when the count changed - rebuilding on every keystroke would
  // steal the caret out of the input being typed into.
  if (list.children.length !== drafts.length) {
    replaceChildren(
      list,
      drafts.map((draft, index) => {
        const row = clone('tpl-player-row');
        if (!row) return null;
        row.dataset.playerIndex = String(index);
        const num = row.querySelector('.player-row__num');
        if (num) num.textContent = String(index + 1);
        const label = row.querySelector('[data-field="label"]');
        const input = row.querySelector('[data-role="player-name"]');
        if (input) {
          input.id = `player-name-${index}`;
          input.name = `player-name-${index}`;
          input.value = draft.name;
        }
        if (label) {
          label.setAttribute('for', `player-name-${index}`);
          label.textContent = `Player ${index + 1} name`;
        }
        return row;
      }),
    );
  }

  drafts.forEach((draft, index) => {
    const row = list.children[index];
    if (!row) return;
    const input = row.querySelector('[data-role="player-name"]');
    if (input && input.value !== draft.name && document.activeElement !== input) {
      input.value = draft.name;
    }

    // Seat colours come from the same palette the engine will hand out, so the
    // face somebody sets up in row 3 is the face - and the colour - they play
    // with. Nothing is re-rolled at Shuffle & start.
    const who = { name: draft.name, photo: draft.photo, color: seatColor(index) };
    applySeat(row, who.color);
    const avatar = row.querySelector('.player-row__avatar');
    paintAvatar(avatar, who);

    const stateName = draft.photo ? 'photo' : draft.skipped ? 'skipped' : 'none';
    row.dataset.photoState = stateName;
    const label = row.querySelector('[data-field="status"]');
    if (label) label.textContent = draft.pending ? PHOTO_STATUS.pending : PHOTO_STATUS[stateName];

    paintSavedAvatars(row, draft, index);

    const skip = row.querySelector('[data-action="skip-photo"]');
    pressed(skip, stateName === 'skipped');
    if (skip) skip.textContent = stateName === 'skipped' ? 'Photo skipped' : 'Skip photo';
    paintRowLabels(row, draft, index);
    paintNameCount(row, draft);
    disable(
      row.querySelector('[data-action="remove-player"]'),
      drafts.length <= MIN_PLAYERS,
      'At least two players',
    );
  });

  text('player-count-note', `${drafts.length} player${drafts.length === 1 ? '' : 's'}`);
  disable(el('btn-add-player'), drafts.length >= MAX_PLAYERS, 'Eight players is the maximum');
}

function eligibleDeck() {
  return filterDeck(DECK, { decades: view.setup.decades, genres: view.setup.genres });
}

/**
 * The buy-in row on the setup screen.
 *
 * The pot line is the whole point of this block: two dollars a head is abstract
 * until you see "Pot: $8 with 4 players", and seeing it is what stops the
 * argument later. Everything here is display only - no money moves in this app,
 * and the copy underneath says so.
 */
function paintBuyin() {
  const buyin = view.setup.buyin;
  const toggle = el('opt-buyin');
  if (toggle) toggle.checked = buyin.enabled;
  show(el('buyin-block'), buyin.enabled);

  // Whole dollars in the stepper: cents are the internal representation, not
  // something anyone should be asked to tap out one penny at a time.
  text('buyin-amount-value', Math.round(buyin.amount / 100));

  const field = el('buyin-venmo');
  // Only write the field when it disagrees, or every render would jump the
  // caret to the end while somebody is still typing their handle.
  if (field && field.value !== buyin.handle) field.value = buyin.handle;

  // Live validation, in normaliseHandle's own terms: the winner screen will
  // pay whatever that function reads out of this field, so the person typing
  // gets shown that exact reading - or told there is none - right here, not
  // after the game. Empty is fine (the handle is optional).
  const hint = el('buyin-venmo-hint');
  const typed = (buyin.handle || '').trim();
  const handle = normaliseHandle(typed);
  if (hint) {
    hint.dataset.tone = typed && !handle ? 'bad' : 'ok';
    hint.textContent = !typed
      ? ''
      : handle
        ? `The winner screen will pay @${handle}`
        : "That's not a Venmo handle or profile link — it won't be on the winner screen";
    show(hint, !!typed);
  }
  if (field) {
    if (typed && !handle) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  const pot = potFor({ amount: buyin.amount, playerCount: view.setup.players.length });
  // potFor returns null rather than a wrong number; there is nothing honest to
  // put in the line in that case, so it says nothing.
  text('buyin-pot', pot ? pot.label : '');
}

function renderSetup() {
  document.body.dataset.mode = view.setup.mode;
  paintPeople();
  renderPlayerRows();

  text('target-cards-value', view.setup.target);
  text('mistake-limit-value', view.setup.mistakeLimit);

  // Steppers pin at their bounds the way the roster buttons already do -
  // a live-looking "+" that silently does nothing reads as a broken button.
  const stepper = (action) => document.querySelector(`[data-action="${action}"]`);
  disable(stepper('target-dec'), view.setup.target <= TARGET_CHOICES[0]);
  disable(stepper('target-inc'), view.setup.target >= TARGET_CHOICES[TARGET_CHOICES.length - 1]);
  disable(stepper('mistakes-dec'), view.setup.mistakeLimit <= MIN_MISTAKES);
  disable(stepper('mistakes-inc'), view.setup.mistakeLimit >= MAX_MISTAKES);
  disable(stepper('buyin-dec'), view.setup.buyin.amount <= BUYIN_MIN_CENTS);
  disable(stepper('buyin-inc'), view.setup.buyin.amount >= BUYIN_MAX_CENTS);

  // How long this will take, next to the number that decides it.
  const minutes = SESSION_MINUTES[view.setup.target];
  text('target-cards-hint', minutes ? `≈ ${minutes} min` : '');

  const streak = el('opt-streak-bonus');
  if (streak) streak.checked = view.setup.streakBonus;
  paintBuyin();

  const radio = el(`mode-${view.setup.mode}`);
  if (radio) radio.checked = true;
  show(el('field-mistake-limit'), view.setup.mode === 'coop');

  // [data-decade] / [data-genre] so the leading All-chip - a plain button, not
  // a toggle - never grows an aria-pressed it does not mean.
  for (const chip of document.querySelectorAll('#decade-chips .chip[data-decade]')) {
    pressed(chip, view.setup.decades.includes(Number(chip.dataset.decade)));
  }
  for (const chip of document.querySelectorAll('#genre-chips .chip[data-genre]')) {
    pressed(chip, view.setup.genres.includes(chip.dataset.genre));
  }

  const eligible = eligibleDeck();
  text('eligible-count-value', eligible.length);
  // "0 songs match" in success green sat directly above two red warnings.
  const match = el('eligible-count');
  if (match) match.dataset.tone = eligible.length === 0 ? 'bad' : 'ok';

  // The foldout's summary. Folding may hide the controls; it must never hide the
  // fact that a filter is on, or somebody wonders for a whole game why the deck
  // is all eighties.
  const decades = view.setup.decades;
  const genres = view.setup.genres;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Selecting every chip is the same deck as selecting none, so it has to read
  // the same too - "8 decades" looks like a filter when nothing is filtered.
  const allDecades = decades.length === 0 || decades.length === DECADES.length;
  const allGenres = genres.length === 0 || genres.length === GENRES.length;
  const parts = [
    allDecades ? 'All decades' : plural(decades.length, 'decade', 'decades'),
    allGenres ? 'all genres' : plural(genres.length, 'genre', 'genres'),
    `${eligible.length} songs`,
  ];
  text('setup-more-state', parts.join(' · '));

  // In co-op there is one timeline, so the group needs far fewer cards than
  // four people racing to ten each.
  const seats = view.setup.mode === 'coop' ? 1 : view.setup.players.length;
  const comfortable = seats * view.setup.target + DECK_SLACK;
  const dealable = view.setup.mode === 'coop' ? 2 : view.setup.players.length + 1;
  show(el('deck-warning'), eligible.length < comfortable);

  // Two ways to be blocked, one line to say which. The photo one names the
  // escape hatch in the same breath as the requirement - a photo somebody does
  // not want to take must never be the reason a family cannot play.
  const outstanding = photosOutstanding();
  let blocked = null;
  if (eligible.length < dealable) blocked = 'Not enough songs match these filters';
  else if (outstanding > 0) {
    blocked =
      outstanding === 1
        ? 'One player still needs a photo - or tap Skip photo for them'
        : `${outstanding} players still need a photo - or tap Skip photo for them`;
  }
  const reason = el('setup-photo-reason');
  if (reason) {
    if (blocked) reason.textContent = blocked;
    show(reason, !!blocked);
  }
  disable(el('btn-start-game'), blocked !== null, blocked || undefined);

  show(el('setup-storage-warn'), !isPersistent());
}

function startGame() {
  const eligible = eligibleDeck();
  // The engine hands out the seat colour; the photo rides along so every screen
  // can read a player's face straight off game state instead of a side map that
  // a reload would lose.
  const roster = view.setup.players.map((draft, i) => ({
    name: (draft.name || '').trim() || `Player ${i + 1}`,
    photo: draft.photo,
  }));
  // Starting a game is the moment a line-up is real, so this is where the guest
  // list learns who plays. Filed in reverse so the first seat ends up first in
  // the list rather than last - each call moves its person to the front.
  for (let i = view.setup.players.length - 1; i >= 0; i--) {
    const draft = view.setup.players[i];
    rememberPerson({
      name: (draft.name || '').trim(),
      photo: draft.photo,
      skipped: !!draft.skipped,
    });
    if (draft.photo) fileAvatar(draft.name, draft.photo);
  }
  const dealable = view.setup.mode === 'coop' ? 2 : roster.length + 1;
  if (eligible.length < dealable) {
    alertUser('Not enough songs match these filters. Turn some decades or genres back on.');
    return;
  }
  if (!rosterReady()) {
    alertUser('Everyone needs a photo, or a tap on Skip photo, before the game can start.');
    return;
  }

  rememberRoster();
  const params = new URLSearchParams(window.location.search);
  const forced = Number.parseInt(params.get('seed') || '', 10);
  const seed = Number.isInteger(forced) ? forced : (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0;

  try {
    state = createGame({
      players: roster,
      deck: eligible,
      targetCards: view.setup.target,
      mode: view.setup.mode,
      mistakeLimit: view.setup.mistakeLimit,
      streakBonus: view.setup.streakBonus,
      seed,
    });
  } catch (error) {
    alertUser(error && error.message ? error.message : 'That game could not be set up.');
    return;
  }
  // The stake is remembered per device, not per game: the same reunion plays
  // several rounds and nobody wants to retype a Venmo handle on a phone each
  // time. Normalised on the way out so what we store is a handle, not whatever
  // shape it was pasted in.
  const stake = {
    enabled: view.setup.buyin.enabled,
    amount: view.setup.buyin.amount,
    handle: normaliseHandle(view.setup.buyin.handle),
  };
  saveBuyin(stake);
  // ...and snapshotted per game: the winner screen pays from THIS copy, so a
  // buy-in fiddled with in a later setup draft - one that never started -
  // cannot rewrite the pot of the game actually being played. Cleared with the
  // game (play-again), replaced here on every start.
  setStored(ACTIVE_BUYIN_KEY, stake);
  saveSetupDraft();
  persist(true);
  beginTurn();
}

/* ========================================================================== */
/* Turn flow                                                                  */
/* ========================================================================== */

function beginTurn() {
  if (!state) return showScreen('home');
  if (isGameOver(state)) return showWin();
  if (state.phase === 'turn-start') {
    if (settings.skipPass) return enterPlay();
    return showScreen('pass');
  }
  if (state.phase === 'revealed' || state.phase === 'turn-end') return showReveal();
  return showScreen('play');
}

function enterPlay() {
  resetCardAudio();
  showScreen('play');
  const player = currentPlayer(state);
  if (!player) return;
  // Politely, on the existing status region: the handover is the one thing a
  // player who cannot see the rail still has to be told about.
  const upNext = nextPlayer(state);
  announce(
    `${player.name}'s turn. Turn ${state.turn}.${upNext ? ` ${upNext.name} is next.` : ''}`,
  );
}

/**
 * Draw the card, lazily.
 *
 * Buying is legal at the start of a turn and nowhere else, and drawing ends
 * that window - so the turn opens on an undrawn card and the deck is only
 * touched when the player does something that needs a song. Everything on the
 * play screen that implies "I am going to guess this one" funnels through here
 * first.
 */
function ensureCard() {
  if (!state || state.phase !== 'turn-start') return;
  dispatch({ type: ACTIONS.DRAW });
  if (state.mode === 'expert') {
    dispatch({ type: ACTIONS.SET_YEAR_GUESS, year: DEFAULT_YEAR_GUESS });
  }
  resetCardAudio();
  render();
}

/**
 * Tap-burst guards on the two transitions that swap a button out from under a
 * finger (Place here -> Next player, Play again -> the setup form). A tap
 * inside the window is dropped silently - no flash, no disabled style, because
 * the button is fine; it is the finger that has not caught up.
 */
let revealTapGuardUntil = 0;
let setupTapGuardUntil = 0;

/**
 * Advanced and expert gate the placement on a vote that has not happened yet
 * when the card flips: `confirmations` still holds nulls. Until both boxes are
 * voted there IS no verdict, and the banner, the tint and the cue must not
 * announce one - the engine recomputes the outcome the moment the votes land.
 */
function verdictPending(outcome) {
  if (!state || !gated()) return false;
  if (!outcome || outcome.kind !== 'placement') return false;
  if (state.phase !== 'revealed') return false;
  return state.confirmations.title === null || state.confirmations.artist === null;
}

function showReveal() {
  revealTapGuardUntil = Date.now() + TAP_GUARD_MS;
  showScreen('reveal');
  runFlip();
  // One cue per reveal, fired on the transition rather than in renderReveal -
  // that function runs again on every repaint (a confirmation vote, a rotate),
  // and a verdict sound that replayed each time would be maddening.
  const outcome = state && state.outcome;
  if (!outcome) return;
  // In gated modes the verdict is not settled yet; confirmToggle fires the cue
  // when the vote resolves it.
  if (verdictPending(outcome)) return;
  if (outcome.accepted) sfx.win();
  else sfx.lose();
  // The token cue rides on top, and only when the pool actually moved: a claim
  // confirmed at the cap awards zero, and chiming for it announces a reward
  // that visibly did not arrive.
  if (outcome.tokenAwards.some((award) => award.delta > 0)) sfx.token();
}

function runFlip() {
  const flip = el('reveal-flip');
  if (!flip) return;
  flip.dataset.flipped = 'false';
  if (motionIsReduced()) {
    flip.dataset.flipped = 'true';
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flip.dataset.flipped = 'true';
    });
  });
}

function showWin() {
  showScreen('win');
  const result = state && state.result;
  const lost = !result || result.coopWon === false || result.winnerIds.length === 0;
  if (!lost && !motionIsReduced()) {
    const canvas = el('confetti');
    if (view.confettiStop) view.confettiStop();
    view.confettiStop = canvas ? burst(canvas, { count: 160, duration: 4000 }) : null;
  }
}

function endGame() {
  stopAudio();
  dispatch({ type: ACTIONS.END_GAME });
  closeSheets();
  showWin();
}

/**
 * The armed-tap guard on the menu's End game row. The first tap arms it and
 * relabels it; only a second tap while armed actually ends the game. ~4s (or
 * closing the sheet) puts it back, so a mis-tap costs nothing.
 */
let endGameArmTimer = null;

function paintEndGameArm() {
  const button = el('btn-end-game');
  if (button) button.textContent = view.endGameArmed ? 'Tap again to end the game' : 'End game';
}

function disarmEndGame() {
  if (endGameArmTimer !== null) {
    clearTimeout(endGameArmTimer);
    endGameArmTimer = null;
  }
  if (!view.endGameArmed) return;
  view.endGameArmed = false;
  paintEndGameArm();
}

function armEndGame() {
  view.endGameArmed = true;
  paintEndGameArm();
  announce('Tap End game again to end it for everyone. The game cannot be resumed.');
  if (endGameArmTimer !== null) clearTimeout(endGameArmTimer);
  endGameArmTimer = window.setTimeout(() => {
    endGameArmTimer = null;
    disarmEndGame();
  }, 4000);
}

/**
 * The same guard on Shuffle & start, armed only while an UNFINISHED game is in
 * the save slot - starting would silently destroy it (a finished save has had
 * its moment and is replaced without ceremony).
 */
let startArmTimer = null;

function paintStartArm() {
  const button = el('btn-start-game');
  if (button) {
    button.textContent = view.startArmed ? 'Tap again to replace the saved game' : 'Shuffle & start';
  }
}

function disarmStartGame() {
  if (startArmTimer !== null) {
    clearTimeout(startArmTimer);
    startArmTimer = null;
  }
  if (!view.startArmed) return;
  view.startArmed = false;
  paintStartArm();
}

function armStartGame() {
  view.startArmed = true;
  paintStartArm();
  announce('Starting replaces the saved game. Tap Shuffle & start again to go ahead.');
  if (startArmTimer !== null) clearTimeout(startArmTimer);
  startArmTimer = window.setTimeout(() => {
    startArmTimer = null;
    disarmStartGame();
  }, 4000);
}

function goHome() {
  stopAudio();
  closeSheets();
  if (view.confettiStop) {
    view.confettiStop();
    view.confettiStop = null;
  }
  showScreen('home');
}

/* ========================================================================== */
/* Audio                                                                      */
/* ========================================================================== */

function player() {
  if (!audioPlayer) {
    audioPlayer = getPlayer();
    audioPlayer.subscribe(onAudioEvent);
  }
  return audioPlayer;
}

/**
 * Every player event repaints the ring; 'ended' also rewinds it. A clip that
 * runs out on its own used to freeze at '0s' under copy still claiming the
 * song was playing - the honest state is "over, tap to hear it again".
 */
function onAudioEvent(snapshot) {
  paintAudio();
  if (!snapshot || snapshot.type !== 'ended') return;
  if (view.screen !== 'play' || !view.audio.resolved) return;
  audioPlayer.seek(0);
  view.audio.status = 'That was the 30 seconds. Play it again?';
  render();
}

function stopAudio() {
  stopDemoTimer();
  if (audioPlayer) audioPlayer.stop();
}

function resetCardAudio() {
  stopAudio();
  view.identifyVote = { title: false, artist: false };
  view.audio = {
    token: view.audio.token + 1,
    cardId: state && state.card ? state.card.id : null,
    resolving: false,
    resolved: null,
    failed: false,
    linksShown: false,
    /** The offline stand-in clock; see startDemoTimer(). */
    demo: null,
    status: !state || !state.card
      ? 'Tap play to draw the mystery song.'
      : settings.sound
        ? 'Tap play when everyone is listening.'
        : 'Sound is off. Turn it on in the menu.',
  };
}

/* The silent 30-second demo timer the home screen promises offline. It runs
   the existing ring from a wall clock, keeps skip and the streaming links
   reachable, and never pretends a song is coming. */
let demoTimerTick = null;

function stopDemoTimer() {
  if (demoTimerTick !== null) {
    clearInterval(demoTimerTick);
    demoTimerTick = null;
  }
  if (view.audio.demo) view.audio.demo = null;
}

function startDemoTimer() {
  stopDemoTimer();
  view.audio.resolving = false;
  // failed=true keeps the fallback block (links + skip) on screen, exactly as
  // a failed preview would; only the copy differs, because this one is honest
  // about why.
  view.audio.failed = true;
  view.audio.demo = { startedAt: performance.now() };
  view.audio.status = 'No connection — using a silent 30s timer.';
  render();
  demoTimerTick = window.setInterval(() => {
    const demo = view.audio.demo;
    if (!demo) {
      stopDemoTimer();
      return;
    }
    if ((performance.now() - demo.startedAt) / 1000 >= PREVIEW_SECONDS) {
      stopDemoTimer();
      view.audio.status = "Time's up — place your best guess, or skip this card.";
      render();
      return;
    }
    paintAudio();
  }, 250);
}

/** Tap-to-play. Every path through here starts inside a user gesture. */
async function toggleAudio() {
  // Everything from here to the play() call must stay synchronous. iOS grants
  // permission to start audio only inside a user gesture, and the first await
  // hands control back to the event loop and throws that permission away - the
  // song then simply never starts, with no error anyone can see. This is why
  // the unlock happens first and why the baked lookup below is the sync one.
  const p = player();
  p.unlock();

  ensureCard();
  if (!state || !state.card) return;

  if (settings.playbackSource !== 'preview') {
    view.audio.failed = true;
    view.audio.status = `Open ${SOURCE_LABELS[settings.playbackSource]} to play this card.`;
    render();
    return;
  }
  if (!settings.sound) {
    view.audio.status = 'Sound is off. Turn it on in the menu.';
    render();
    return;
  }

  if (p.playing) {
    p.pause();
    return;
  }
  if (view.audio.resolved && view.audio.resolved.previewUrl) {
    const started = await p.play(view.audio.resolved.previewUrl);
    if (!started) failAudio('That preview would not play here.');
    else warmNextCard();
    return;
  }

  // Most cards were resolved at build time, and that answer is available
  // without waiting - so start them here, in the same tick as the tap, rather
  // than going through the async path below and losing the gesture.
  const quick = bakedTrackSync(state.card);
  if (quick) {
    view.audio.resolved = quick;
    const quickToken = view.audio.token;
    const started = await p.play(quick.previewUrl);
    // A play() that resolves after the turn moved on must not write anything:
    // its status would land on the NEXT player's screen, about a card they have
    // not heard. The slow path already guarded this; the fast one did not.
    if (quickToken !== view.audio.token) return;
    if (!started) failAudio('That preview would not play here.');
    else {
      // A retry that works has to clear the failure, or the song plays under a
      // banner still saying it would not - and, worse, under the streaming
      // links, which spell out the title nobody has guessed yet.
      view.audio.failed = false;
      view.audio.status = 'Playing the preview.';
      render();
      warmNextCard();
    }
    return;
  }

  if (view.audio.resolving) return;

  const token = view.audio.token;
  view.audio.resolving = true;
  view.audio.status = 'Finding the song...';
  render();

  let track = null;
  try {
    track = await resolveTrack(state.card);
  } catch {
    track = null;
  }
  if (token !== view.audio.token) return; // A new card arrived while we waited.

  view.audio.resolving = false;
  if (!track || !track.previewUrl) {
    failAudio('No preview available for this one.');
    return;
  }
  view.audio.resolved = track;
  const started = await p.play(track.previewUrl);
  if (token !== view.audio.token) return;
  if (!started) failAudio('That preview would not play here.');
  else {
    // See the note on the fast path: a working retry must clear the failure, or
    // the streaming links stay on screen with the title in them.
    view.audio.failed = false;
    view.audio.status = 'Playing the preview.';
    render();
    warmNextCard();
  }
}

function failAudio(message) {
  // Offline is not a failure to apologise for - the home screen promises a
  // demo timer, so a fetch that died with no connection delivers one instead
  // of pointing at three fallbacks that all need the internet.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    startDemoTimer();
    return;
  }
  view.audio.resolving = false;
  view.audio.failed = true;
  view.audio.status = `${message} Use the links below, or skip this card.`;
  render();
}

/** Warm the next card while this one plays so the turn change feels instant. */
function warmNextCard() {
  if (!state || state.deck.length === 0) return;
  prefetch(state.deck[0]);
}

function replayAudio() {
  if (!state || !state.card) return;
  const p = player();
  p.seek(0);
  if (view.audio.resolved && view.audio.resolved.previewUrl) {
    p.play(view.audio.resolved.previewUrl)
      .then((started) => {
        if (!started) failAudio('That preview would not play here.');
      })
      .catch(() => failAudio('That preview would not play here.'));
  } else {
    toggleAudio().catch(() => failAudio('The preview could not be loaded.'));
  }
}

/**
 * The only thing allowed to run on the audio clock. Touches four nodes, never
 * calls render(), and bails when the play screen is not up.
 */
function paintAudio() {
  if (view.screen !== 'play') return;
  const ring = el('countdown-ring');
  const button = el('btn-play-song');
  const badge = button ? button.querySelector('.disc__time') : null;

  // Link modes play nothing on this phone, so a countdown is a promise the
  // vinyl cannot keep - the hub names the service instead. (This is also what
  // kept the unlock buffer's 10ms duration from arithmetic-ing "1s" into view.)
  if (settings.playbackSource !== 'preview') {
    text('countdown-value', SOURCE_LABELS[settings.playbackSource] || '');
    text('countdown-unit', '');
    if (badge) badge.dataset.mode = 'link';
    if (ring) ring.style.setProperty('--ring-progress', '1');
    pressed(button, false);
    text('btn-play-label', 'Play song');
    return;
  }
  if (badge) delete badge.dataset.mode;
  text('countdown-unit', 's');

  // The offline demo timer drives the same ring from a wall clock.
  const demo = view.audio.demo;
  if (demo) {
    const remaining = Math.max(
      0,
      PREVIEW_SECONDS - (performance.now() - demo.startedAt) / 1000,
    );
    text('countdown-value', Math.ceil(remaining));
    if (ring) ring.style.setProperty('--ring-progress', String(remaining / PREVIEW_SECONDS));
    pressed(button, false);
    text('btn-play-label', 'Play song');
    return;
  }

  const p = audioPlayer;
  const playing = !!(p && p.playing);
  // The unlock buffer is the one data: URI ever loaded, and its 10ms duration
  // must never reach the arithmetic - the ring is 30s until a real clip says
  // otherwise.
  const real = p && p.duration > 0 && !/^data:/.test(p.src || '');
  const duration = real ? p.duration : PREVIEW_SECONDS;
  const elapsed = real ? Math.min(p.currentTime, duration) : 0;
  const remaining = Math.max(0, duration - elapsed);

  text('countdown-value', Math.ceil(remaining));
  if (ring) ring.style.setProperty('--ring-progress', String(remaining / duration));
  pressed(button, playing);
  text('btn-play-label', playing ? 'Pause' : view.audio.resolving ? 'Loading' : 'Play song');
}

/* ========================================================================== */
/* QR                                                                         */
/* ========================================================================== */

function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The URL the QR encodes.
 *
 * The payload is built field by field on purpose: spreading the card would put
 * `year` on another phone's screen, which is the one thing this game cannot
 * survive. `s` is the table's playback source, so a game set to Spotify hands
 * the scanning phone a streaming link instead of the preview player - still no
 * year, and the title only inside the link the mode exists to open.
 */
function listenUrl(card, turnNumber) {
  const payload = {
    v: 1,
    t: typeof card.title === 'string' ? card.title : '',
    a: typeof card.artist === 'string' ? card.artist : '',
    n: turnNumber,
    s: settings.playbackSource !== 'preview' ? settings.playbackSource : undefined,
  };
  const dir = window.location.pathname.replace(/[^/]*$/, '');
  return `${window.location.origin}${dir}listen.html#${base64url(JSON.stringify(payload))}`;
}

function isLoopback() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function paintQr() {
  const box = el('qr-code');
  const note = el('qr-file-note');
  if (!box) return;
  // An empty white frame reads as a broken image, so the frame goes with the code.
  const frame = box.closest('.qr__frame');

  const card = state && state.card;

  // Nothing has been drawn yet, so there is nothing to scan - and a "Scan to
  // play it" caption floating over no code read as something broken. The whole
  // block waits for the draw. (Drawing eagerly instead is not an option: it
  // would close the buy-a-card window, which is only open until the deck is
  // touched.)
  show(el('qr-block'), !!card);
  if (!card) {
    box.textContent = '';
    show(frame, false);
    show(note, false);
    return;
  }

  const target = listenUrl(card, state.turn);

  try {
    box.innerHTML = qrSvg(target, { margin: 3, dark: '#0b0616', light: '#ffffff' });
    const svg = box.querySelector('svg');
    show(frame, !!svg);
    if (svg) {
      // Belt and braces: an intrinsically-sized SVG must not be able to push
      // the page wider than the viewport.
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.style.display = 'block';
    }
  } catch {
    box.textContent = '';
    show(frame, false);
  }

  if (note) {
    if (isLoopback()) {
      note.textContent =
        'This address only works on this device. Run "npm run music" and use the Wi-Fi address it prints so everyone can scan.';
      show(note, true);
    } else {
      show(note, false);
    }
  }
}

/* ========================================================================== */
/* Timeline strips                                                            */
/* ========================================================================== */

function gapLabel(gap) {
  return `Place ${gapShort(gap)}`;
}

/** The same idea in as few characters as possible - the hint line is narrow. */
function gapShort(gap) {
  if (gap.left && gap.right) return `between ${gap.left.year} and ${gap.right.year}`;
  if (gap.right) return `before ${gap.right.year}`;
  if (gap.left) return `after ${gap.left.year}`;
  return 'as the first card';
}

/**
 * Build (or update in place) a gap/card/gap strip.
 *
 * The DOM is only rebuilt when the underlying cards change; selecting a gap
 * just flips aria-pressed, which keeps the horizontal scroll position and lets
 * the browser animate the selection instead of flashing the whole row.
 */
function paintStrip(strip, gaps, timeline, selectedIndex) {
  if (!strip) return;
  const key = `${timeline.map((c) => c.id).join('|')}#${timeline.length}`;
  if (strip.dataset.stripKey !== key) {
    const nodes = [];
    gaps.forEach((gap, index) => {
      const gapNode = clone('tpl-timeline-gap');
      if (gapNode) {
        const button = gapNode.querySelector('.gap');
        if (button) {
          button.dataset.gapIndex = String(gap.index);
          const label = button.querySelector('[data-field="label"]');
          if (label) label.textContent = gapLabel(gap);
        }
        nodes.push(gapNode);
      }
      if (index < timeline.length) {
        const card = timeline[index];
        const cardNode = clone('tpl-timeline-card');
        if (cardNode) {
          cardNode.dataset.cardId = card.id;
          fill(cardNode, {
            year: card.year,
            title: card.title || 'Unknown song',
            artist: card.artist || '',
          });
          nodes.push(cardNode);
        }
      }
    });
    replaceChildren(strip, nodes);
    strip.dataset.stripKey = key;
  }

  const buttons = strip.querySelectorAll('.gap');
  for (const button of buttons) {
    const index = Number(button.dataset.gapIndex);
    const on = selectedIndex !== null && index === selectedIndex;
    pressed(button, on);
    if (on) scrollIntoStrip(strip, button);
  }
}

function scrollIntoStrip(strip, node) {
  if (typeof strip.scrollTo !== 'function') return;
  const left = node.offsetLeft - strip.clientWidth / 2 + node.offsetWidth / 2;
  const target = Math.max(0, Math.min(left, strip.scrollWidth - strip.clientWidth));
  if (Math.abs(strip.scrollLeft - target) < 4) return;
  try {
    strip.scrollTo({ left: target, behavior: motionIsReduced() ? 'auto' : 'smooth' });
  } catch {
    strip.scrollLeft = target;
  }
}

/* ========================================================================== */
/* The player rail + the standings list                                       */
/* ========================================================================== */
/* Both are the same data - engine.seatStandings(), in seat order - drawn twice
   at two sizes. The rail is what the table glances at mid-turn; the standings
   list is what they read while the phone is being handed over.                */

function rankOf(row) {
  if (row.isActive) return 'active';
  if (row.isNext) return 'next';
  return 'other';
}

/**
 * What a screen reader gets instead of a face.
 *
 * The card count is the whole point of the badge, so it goes in the name rather
 * than a title attribute - except in co-op, where every player would report the
 * same shared pile and the number would be noise eight times over.
 */
function seatLabel(row, mode) {
  const parts = [row.name];
  if (mode !== 'coop') parts.push(`${row.cards} card${row.cards === 1 ? '' : 's'}`);
  if (row.isActive) parts.push('playing now');
  else if (row.isNext) parts.push('up next');
  if (row.isLeader) parts.push('leading');
  return parts.join(', ');
}

/** How far along the meter is. Clamped: a bought card can overshoot the target. */
function meterWidth(cards, target) {
  if (!Number.isFinite(target) || target <= 0) return '0%';
  return `${Math.max(0, Math.min(100, Math.round((cards / target) * 100)))}%`;
}

function buildTokenPills(list, count) {
  if (!list || !state) return;
  replaceChildren(
    list,
    Array.from({ length: state.tokenCap }, (unused, index) => {
      const pill = clone('tpl-token-pill');
      if (pill) pill.dataset.state = index < count ? 'full' : 'empty';
      return pill;
    }),
  );
  list.setAttribute('aria-label', `${count} token${count === 1 ? '' : 's'}`);
}

/**
 * Paint one rail (there is one on the play screen and one on the reveal).
 *
 * Chips are only rebuilt when the roster itself changes, so an ordinary turn
 * change is four attribute flips - which keeps the scroll position, lets CSS
 * animate the handover, and means a photo is never re-decoded mid-game.
 */
function paintRoster(seats, team) {
  if (!seats || !state) return;
  const rows = seatStandings(state);

  const key = rows.map((row) => row.playerId).join('|');
  if (seats.dataset.rosterKey !== key) {
    replaceChildren(seats, rows.map(() => clone('tpl-roster-chip')));
    seats.dataset.rosterKey = key;
  }

  rows.forEach((row, index) => {
    const seat = seats.children[index];
    if (!seat) return;
    seat.dataset.playerId = row.playerId;
    seat.dataset.rank = rankOf(row);
    seat.dataset.leader = row.isLeader ? 'true' : 'false';
    applySeat(seat, row.color);
    paintAvatar(seat.querySelector('.avatar'), row);
    fill(seat, { cards: row.cards, flag: row.isNext ? 'Next' : '' });
    const chip = seat.querySelector('.roster__chip');
    if (chip) chip.setAttribute('aria-label', seatLabel(row, state.mode));
  });

  if (team) {
    fill(team, {
      cards: state.sharedTimeline.length,
      target: state.targetCards,
      mistakes: state.mistakes,
      limit: state.mistakeLimit,
    });
  }

  // Only chase the active chip when the turn moved on - or when the rail itself
  // changed size, which is a rotated phone. Doing it on every repaint would
  // scroll somebody's own browsing out from under them.
  const active = currentPlayer(state);
  const fit = active ? `${active.id}@${seats.clientWidth}` : '';
  if (active && seats.dataset.activeSeat !== fit) {
    seats.dataset.activeSeat = fit;
    scrollSeatIntoView(
      seats,
      seats.querySelector('[data-rank="active"]'),
      seats.querySelector('[data-rank="next"]'),
    );
  }
}

/**
 * Put the active chip - and the one after it - in view, but only when they are
 * not there already.
 *
 * Three rules, all learned the hard way. Both chips, because "who is next" is
 * half the point of the rail and the two are always neighbours. Not centred the
 * way the timeline strip is: the rail is a seating plan, and shoving the first
 * two seats off the left edge to centre the third throws away the thing the
 * rail is for. And when it does scroll it lands exactly on the active chip's own
 * snap position - anywhere else and the scroll-snap container simply drags the
 * rail somewhere else the moment the programmatic scroll finishes.
 */
function scrollSeatIntoView(seats, chip, nextChip) {
  if (!chip || typeof seats.scrollTo !== 'function') return;
  const left = seats.scrollLeft;
  const right = left + seats.clientWidth;
  const inView = (node) =>
    node.offsetLeft >= left && node.offsetLeft + node.offsetWidth <= right;
  if (inView(chip) && (!nextChip || inView(nextChip))) return;
  // Snap positions are start-aligned, offset by the scroll padding - which is
  // the container's own inline padding, so the first chip's is exactly 0.
  const pad = Number.parseFloat(window.getComputedStyle(seats).paddingLeft) || 0;
  const target = Math.max(
    0,
    Math.min(chip.offsetLeft - pad, seats.scrollWidth - seats.clientWidth),
  );
  if (Math.abs(left - target) < 2) return;
  try {
    seats.scrollTo({ left: target, behavior: motionIsReduced() ? 'auto' : 'smooth' });
  } catch {
    seats.scrollLeft = target;
  }
}

function renderStandings() {
  const list = el('pass-standings-list');
  if (list) {
    replaceChildren(
      list,
      seatStandings(state).map((row) => {
        const node = clone('tpl-standings-row');
        if (!node) return null;
        node.dataset.playerId = row.playerId;
        node.dataset.rank = rankOf(row);
        node.dataset.leader = row.isLeader ? 'true' : 'false';
        applySeat(node, row.color);
        node.style.setProperty('--fill', meterWidth(row.cards, state.targetCards));
        paintAvatar(node.querySelector('.standing__avatar'), row);
        fill(node, {
          name: row.name,
          cards: row.cards,
          target: state.targetCards,
          flag: row.isActive ? 'Playing now' : row.isNext ? 'Up next' : '',
        });
        buildTokenPills(node.querySelector('[data-field="tokens"]'), row.tokens);
        return node;
      }),
    );
  }

  // Co-op: one pile, one pool, one mistake budget. CSS decides which of the two
  // blocks is on screen; this only has to keep the numbers right.
  const coop = el('pass-coop');
  if (coop) {
    const cards = state.sharedTimeline.length;
    fill(coop, {
      cards,
      target: state.targetCards,
      mistakes: state.mistakes,
      limit: state.mistakeLimit,
    });
    coop.style.setProperty('--fill', meterWidth(cards, state.targetCards));
    buildTokenPills(coop.querySelector('[data-field="tokens"]'), state.sharedTokens);
  }
}

/* ========================================================================== */
/* Play screen                                                                */
/* ========================================================================== */

function paintTokens(list, count, cap) {
  if (!list) return;
  // The markup ships the classic five pills; the cap is the engine's to set
  // (co-op holds six), so the strip is rebuilt whenever the two disagree -
  // restyling five pills for a six-token pool made 5 and 6 indistinguishable
  // on the one screen where spend decisions happen.
  let pills = list.querySelectorAll('.token-pill');
  if (pills.length !== cap) {
    replaceChildren(
      list,
      Array.from({ length: cap }, () => clone('tpl-token-pill')),
    );
    pills = list.querySelectorAll('.token-pill');
  }
  pills.forEach((pill, index) => {
    pill.dataset.state = index < count ? 'full' : 'empty';
  });
  list.setAttribute('aria-label', `Tokens: ${count} of ${cap}`);
}

function renderPlay() {
  const active = currentPlayer(state);
  if (!active) return;

  text('play-turn-number', state.turn);
  text('play-player-name', active.name);
  paintAvatar(el('play-avatar'), active);

  const progress = progressFor(state, active.id);
  text('play-progress-current', progress.cards);
  text('play-progress-target', progress.target);
  paintTokens(el('play-tokens'), tokensFor(state, active.id), state.tokenCap);

  // Who is up, who is after them: the rail says it in faces, the bar in words.
  const upNext = nextPlayer(state);
  show(el('play-next'), !!upNext);
  if (upNext) text('play-next-name', upNext.name);
  paintRoster(el('play-roster-seats'), el('play-roster-team'));

  const heading = el('timeline-heading');
  // "Shared", not "The shared": at 320px the longer version wraps the header
  // onto a second line and pushes the mystery card's Play button off screen.
  if (heading) heading.textContent = state.mode === 'coop' ? 'Shared timeline' : 'Your timeline';

  const timeline = timelineFor(state, active.id);
  paintStrip(el('timeline-strip'), gapsFor(state, active.id), timeline, state.selectedGap);
  const hint = el('timeline-hint');
  if (hint) {
    const gaps = gapsFor(state, active.id);
    const chosen = state.selectedGap === null ? null : gaps[state.selectedGap];
    // Once the strip is longer than the screen, "tap a gap" is only half the
    // instruction - the gap you want may be off to one side, and a player who
    // does not know it scrolls will place the card in the wrong half of their
    // own timeline.
    const scrolls = timeline.length > 3;
    hint.textContent = chosen
      ? `Placing ${gapShort(chosen)}`
      : scrolls
        ? 'Swipe, then tap a gap'
        : 'Tap a gap to choose a spot';
  }

  // Actions
  const buyReason = buyBlockedReason(state);
  disable(el('btn-buy-card'), buyReason !== null);
  const reasonNode = el('btn-buy-card-reason');
  if (reasonNode) {
    // The engine words the reason for one owner; in co-op the pool belongs to
    // the table, and "you have 2" reads as a personal pile that does not exist.
    const worded =
      buyReason && state.mode === 'coop' ? buyReason.replace('you have', 'the table has') : buyReason;
    reasonNode.textContent = worded || `Costs ${BUY_COST} tokens`;
    show(reasonNode, buyReason !== null);
  }

  pressed(el('btn-claim-identify'), state.claimIdentify);
  text('year-guess-value', state.yearGuess === null ? DEFAULT_YEAR_GUESS : state.yearGuess);

  const count = state.challenges.length;
  const badge = el('challenge-count');
  if (badge) {
    badge.textContent = String(count);
    show(badge, count > 0);
  }
  // A challenge is a token already spent on a guess nobody else can see. Naming
  // the challengers on the play screen is what turns that from a hidden count
  // into table talk - and it is the placing player's cue that this one matters.
  const locks = el('challenge-locks');
  if (locks) {
    const pills = state.challenges
      .map((challenge) => {
        const node = clone('tpl-challenge-lock');
        if (!node) return null;
        fill(node, { label: `${nameOf(challenge.playerId)} challenged` });
        return node;
      })
      .filter(Boolean);
    replaceChildren(locks, pills);
    show(locks, pills.length > 0);
  }
  // Before the draw nobody "can" challenge yet (there is no card), but the
  // button must still be live: tapping it is what draws. And while any
  // challenge is locked in, the button stays live even when no NEW challenger
  // is eligible - the sheet is the only way to a take-back, and a disabled
  // button stranded that token forever.
  const others = state.players.filter((p) => p.id !== active.id);
  const anyCanChallenge =
    count > 0 ||
    (state.phase === 'turn-start'
      ? others.some((p) => tokensFor(state, p.id) >= 1)
      : others.some((p) => challengeBlockedReason(state, p.id) === null));
  disable(el('btn-challenge'), !anyCanChallenge);

  disable(
    el('btn-place'),
    state.selectedGap === null || state.placementCommitted,
    state.placementCommitted ? 'Already placed this card' : 'Tap a gap in your timeline first',
  );

  // Audio + QR
  const status = el('audio-status');
  if (status && status.textContent !== view.audio.status) status.textContent = view.audio.status;
  disable(el('btn-play-song'), view.audio.resolving);
  disable(el('btn-replay'), !view.audio.resolved);
  show(el('audio-fallback'), view.audio.failed);
  const linksOpen = view.audio.failed && view.audio.linksShown;
  show(el('streaming-links'), linksOpen);
  if (linksOpen) paintStreamingLinks();
  // A toggle has to say which way it is pointing. It read "Show streaming
  // links" with the links already showing, so the only way to put the title
  // back out of sight was to guess that the same button did it.
  const linksBtn = el('btn-show-links');
  if (linksBtn) {
    pressed(linksBtn, linksOpen);
    const label = linksOpen ? 'Hide streaming links' : 'Show streaming links';
    if (linksBtn.textContent.trim() !== label) linksBtn.textContent = label;
  }
  paintAudio();
  paintQr();
}

function paintStreamingLinks() {
  const box = el('streaming-links');
  if (!box || !state || !state.card) return;
  const links = streamingLinks(state.card);
  const wanted =
    settings.playbackSource === 'preview'
      ? [
          ['spotify', 'Spotify'],
          ['appleMusic', 'Apple Music'],
          ['youtube', 'YouTube'],
        ]
      : [
          [
            settings.playbackSource === 'apple' ? 'appleMusic' : settings.playbackSource,
            SOURCE_LABELS[settings.playbackSource],
          ],
        ];
  replaceChildren(
    box,
    wanted.map(([key, label]) => {
      const anchor = document.createElement('a');
      anchor.className = 'btn btn--quiet btn--sm';
      anchor.href = links[key];
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      // The label is the service, never the song - the title stays a secret
      // until somebody deliberately opens the link.
      anchor.textContent = `Search ${label}`;
      return anchor;
    }),
  );
}

/* ========================================================================== */
/* Pass screen                                                                */
/* ========================================================================== */

function renderPass() {
  const active = currentPlayer(state);
  if (!active) return;
  paintAvatar(el('pass-avatar'), active);
  text('pass-player-name', active.name);
  text('pass-turn-number', state.turn);
  const progress = progressFor(state, active.id);
  text('pass-progress', `${progress.cards} / ${progress.target} cards`);

  // "then Ann" - the handover is the only moment the running order is anybody's
  // question, so it gets answered in words here rather than in a caret.
  const upNext = nextPlayer(state);
  show(el('pass-then'), !!upNext);
  if (upNext) text('pass-next-name', upNext.name);

  renderStandings();
}

/* ========================================================================== */
/* Reveal screen                                                              */
/* ========================================================================== */

function playerOf(playerId) {
  return state.players.find((p) => p.id === playerId) || null;
}

function nameOf(playerId) {
  const found = playerOf(playerId);
  return found ? found.name : 'Someone';
}

function verdictFor(outcome) {
  if (outcome.kind === 'buy') {
    return { verdict: 'correct', message: `Bought and slotted in. That cost ${BUY_COST} tokens.` };
  }
  if (outcome.kind === 'skip') {
    return { verdict: 'neutral', message: 'Card skipped. No penalty.' };
  }
  if (outcome.accepted) return { verdict: 'correct', message: 'Correct. The card is yours.' };
  if (outcome.placementCorrect && !outcome.requirementsMet) {
    // Expert fails the same placement two very different ways, and the year is
    // the one the reveal never shows - "you had to name it too" is simply untrue
    // for somebody who named it and missed 1994 by a year.
    if (outcome.titleOk === true && outcome.artistOk === true && outcome.yearGuessCorrect === false) {
      return {
        verdict: 'wrong',
        message:
          outcome.yearGuess === null
            ? 'Right spot and you named it - but expert wants the exact year.'
            : `Right spot and you named it - but it was not ${outcome.yearGuess}.`,
      };
    }
    return { verdict: 'wrong', message: 'Right spot, but you had to name it too.' };
  }
  if (outcome.stolenBy) {
    return { verdict: 'wrong', message: `Not quite - ${nameOf(outcome.stolenBy)} stole it.` };
  }
  return { verdict: 'wrong', message: 'Not quite. The card is discarded.' };
}

const REVEAL_SUB = {
  placement: 'played this card',
  buy: 'bought this card',
  skip: 'skipped this card',
};

function renderReveal() {
  paintRoster(el('reveal-roster-seats'), el('reveal-roster-team'));
  const outcome = state.outcome;
  if (!outcome) return;
  const card = outcome.card;

  // Whose card was it? Face first - by the time the reveal lands the phone may
  // already be halfway to the next person.
  const who = playerOf(outcome.playerId);
  const whoAvatar = el('reveal-avatar');
  paintAvatar(whoAvatar, who);
  if (whoAvatar) applySeat(whoAvatar.parentElement, who && who.color);
  text('reveal-who-name', who ? who.name : 'Someone');
  text('reveal-who-sub', REVEAL_SUB[outcome.kind] || REVEAL_SUB.placement);

  text('reveal-year', card.year);
  text('reveal-title-text', card.title || 'Unknown song');
  text('reveal-artist', card.artist || 'Unknown artist');

  const art = el('reveal-artwork');
  const placeholder = el('reveal-art-placeholder');
  const artUrl = view.audio.resolved && view.audio.resolved.artworkUrl;
  if (art) {
    if (artUrl) {
      art.onerror = () => {
        show(art, false);
        show(placeholder, true);
      };
      art.src = artUrl;
      art.alt = '';
      show(art, true);
      show(placeholder, false);
    } else {
      art.removeAttribute('src');
      show(art, false);
      show(placeholder, true);
    }
  }

  // Until the group's vote lands in a gated mode, the banner holds the
  // markup's own neutral state rather than calling the turn lost in past
  // tense - the tint (a :has() on data-verdict) follows it automatically.
  const { verdict, message } = verdictPending(outcome)
    ? { verdict: 'neutral', message: 'Waiting for the group — vote Title and Artist to settle it.' }
    : verdictFor(outcome);
  const banner = el('verdict-banner');
  if (banner) {
    banner.dataset.verdict = verdict;
    banner.textContent = message;
  }

  // Confirmations: advanced/expert gate the placement on them, and any mode
  // needs them when the player claimed they could name it.
  const showConfirm =
    outcome.kind === 'placement' && state.phase === 'revealed' && (gated() || state.claimIdentify);
  show(el('confirm-panel'), showConfirm);
  text('confirm-player-name', nameOf(outcome.playerId));
  pressed(el('btn-confirm-title'), voted('title'));
  pressed(el('btn-confirm-artist'), voted('artist'));

  if (state.mode === 'expert' && outcome.kind === 'placement') {
    const guess = outcome.yearGuess === null ? 'no guess' : outcome.yearGuess;
    const hit = outcome.yearGuessCorrect ? 'exact' : 'missed';
    announce(`Year guess ${guess}, ${hit}.`);
  }

  renderAwards(outcome);
  renderOutcomes(outcome);
  renderRevealStrip(outcome);

  // "Between 1971 and 1983" is the sentence that turns a bare year into a
  // placement people can argue about, and it is the whole reason the strip
  // below it exists. Only shown when the card was actually kept - a discarded
  // card belongs nowhere, and saying otherwise would read as a consolation.
  const belongs = el('reveal-belongs');
  if (belongs) {
    const neighbours = outcome.accepted ? stripNeighbours(outcome) : null;
    if (neighbours) belongs.textContent = neighbours;
    show(belongs, !!neighbours);
  }

  // The house rule only speaks when it pays. A note that says "1 of 3" every
  // turn is noise; a note that appears exactly when a token lands is a reward.
  show(el('reveal-streak'), outcome.streakAwarded === true);

  const pending = pendingResult(state);
  const next = el('btn-next-player');
  if (next) next.textContent = pending ? 'See the result' : 'Next player';
}

function renderAwards(outcome) {
  const list = el('token-awards');
  if (!list) return;
  const rows = [];

  for (const award of outcome.tokenAwards) {
    const node = clone('tpl-award-item');
    if (!node) continue;
    // The engine reports what the pool really moved by, so a claim confirmed at
    // the cap arrives as 0. Say why, rather than printing a gold "+1" next to a
    // token row that visibly did not change.
    // Three states, not two: a claim confirmed at the token cap moves the pool
    // by zero, and painting that in verdict red announces a loss that did not
    // happen. Nothing was gained and nothing was taken.
    node.dataset.delta = award.delta > 0 ? 'gain' : award.delta < 0 ? 'loss' : 'none';
    let what = 'Bought a card';
    if (award.reason === 'identify') {
      what = award.delta === 0 ? 'Named it - tokens already full' : 'Named the song';
    } else if (award.reason === 'streak') {
      // Same cap-honesty as the identify row: a streak earned at the token cap
      // pays nothing, and calling that a purchase started table arguments.
      what =
        award.delta === 0
          ? 'Streak bonus - tokens already full'
          : 'Streak bonus - three in a row';
    }
    fill(node, {
      who: state.mode === 'coop' ? 'Shared pool' : nameOf(award.playerId),
      what,
      delta: award.delta > 0 ? `+${award.delta}` : String(award.delta),
    });
    rows.push(node);
  }

  if (outcome.claimedIdentify && outcome.identifyConfirmed !== true) {
    const node = clone('tpl-award-item');
    if (node) {
      node.dataset.delta = 'loss';
      fill(node, {
        who: state.mode === 'coop' ? 'Shared pool' : nameOf(outcome.playerId),
        what: outcome.identifyConfirmed === false ? 'Did not name it' : 'Claim not confirmed yet',
        delta: '0',
      });
      rows.push(node);
    }
  }

  for (const challenge of outcome.challenges) {
    const node = clone('tpl-award-item');
    if (!node) continue;
    node.dataset.delta = 'loss';
    fill(node, {
      who: state.mode === 'coop' ? 'Shared pool' : nameOf(challenge.playerId),
      what: 'Challenged',
      delta: `-${challenge.tokenSpent}`,
    });
    rows.push(node);
  }

  replaceChildren(list, rows);
  const panel = list.closest('.panel');
  show(panel, rows.length > 0);
}

/**
 * Where the card ended up, whoever ended up with it. Searched rather than
 * derived from `outcome.playerId`, because a won challenge moves the card to
 * the challenger and the strip has to follow the card, not the turn.
 * @returns {{timeline: Array<*>, index: number}|null}
 */
function placedContext(outcome) {
  if (!outcome || !outcome.accepted || !outcome.card) return null;
  const id = outcome.card.id;
  if (state.mode === 'coop') {
    const index = state.sharedTimeline.findIndex((c) => c.id === id);
    return index < 0 ? null : { timeline: state.sharedTimeline, index };
  }
  for (const p of state.players) {
    const index = p.timeline.findIndex((c) => c.id === id);
    if (index >= 0) return { timeline: p.timeline, index };
  }
  return null;
}

/** "Between 1971 and 1983", or the honest thing to say at either end. */
function stripNeighbours(outcome) {
  const found = placedContext(outcome);
  if (!found) return null;
  const { timeline, index } = found;
  if (timeline.length < 2) return null;
  const before = index > 0 ? timeline[index - 1] : null;
  const after = index < timeline.length - 1 ? timeline[index + 1] : null;
  if (before && after) return `Between ${before.year} and ${after.year}`;
  if (after) return `Earliest so far - before ${after.year}`;
  if (before) return `Latest so far - after ${before.year}`;
  return null;
}

/**
 * Three cards of context around the one just placed. The whole timeline is a tap
 * away on the scoreboard; what the reveal needs is the neighbours, big enough to
 * read at arm's length across a table.
 */
function renderRevealStrip(outcome) {
  const strip = el('reveal-strip');
  if (!strip) return;
  const found = placedContext(outcome);
  if (!found || found.timeline.length < 2) {
    replaceChildren(strip, []);
    show(strip, false);
    return;
  }
  const { timeline, index } = found;
  const from = Math.max(0, index - 1);
  const to = Math.min(timeline.length, index + 2);
  const nodes = [];
  for (let i = from; i < to; i++) {
    const node = miniCard(timeline[i]);
    if (!node) continue;
    if (i === index) node.dataset.highlight = 'true';
    nodes.push(node);
  }
  replaceChildren(strip, nodes);
  show(strip, nodes.length > 0);
}

function renderOutcomes(outcome) {
  const list = el('challenge-outcomes');
  if (!list) return;
  const rows = outcome.challenges.map((challenge) => {
    const node = clone('tpl-outcome-item');
    if (!node) return null;
    node.dataset.result = challenge.won ? 'correct' : 'wrong';
    let what;
    if (challenge.won) what = 'Right spot - the card goes to them';
    else if (!challenge.resolved) what = 'The placement stood, token spent';
    else if (challenge.correct) what = 'Right spot, but someone claimed it first';
    else what = 'Wrong spot, token spent';
    fill(node, { who: nameOf(challenge.playerId), what });
    return node;
  });
  replaceChildren(list, rows);
  const panel = list.closest('.panel');
  show(panel, rows.length > 0);
}

/* ========================================================================== */
/* Scoreboard                                                                 */
/* ========================================================================== */

function miniCard(card) {
  const node = clone('tpl-mini-card');
  if (!node) return null;
  node.dataset.cardId = card.id;
  fill(node, {
    year: card.year,
    label: `${card.title || 'Unknown song'} by ${card.artist || 'unknown artist'}`,
  });
  return node;
}

/**
 * The co-op scoreboard: ONE shared block - timeline, pool, cards to go - and a
 * compact list of who is at the table. The per-player rows are a race view,
 * and co-op is not a race; eight copies of the same shared pile read as a
 * rendering bug, because they were one.
 */
function coopScoreboardRows() {
  const rows = [];
  const team = clone('tpl-scoreboard-row');
  if (team) {
    const cards = state.sharedTimeline.length;
    team.dataset.playerId = 'team';
    team.dataset.active = 'false';
    paintAvatar(team.querySelector('.score-row__avatar'), { name: 'The team' });
    fill(team, { name: 'The team', togo: Math.max(0, state.targetCards - cards) });
    buildTokenPills(team.querySelector('[data-field="tokens"]'), state.sharedTokens);
    const strip = team.querySelector('[data-field="timeline"]');
    if (strip) replaceChildren(strip, state.sharedTimeline.map(miniCard));
    rows.push(team);
  }
  const roster = clone('tpl-coop-roster');
  if (roster) {
    const inner = roster.querySelector('.coop-roster__list');
    const active = currentPlayer(state);
    if (inner) {
      replaceChildren(
        inner,
        state.players.map((p) => {
          const chip = clone('tpl-coop-player');
          if (!chip) return null;
          chip.dataset.rank = active && active.id === p.id ? 'active' : 'other';
          applySeat(chip, p.color);
          paintAvatar(chip.querySelector('.avatar'), p);
          fill(chip, { name: p.name });
          return chip;
        }),
      );
    }
    rows.push(roster);
  }
  return rows;
}

function renderScoreboard() {
  const list = el('scoreboard-list');
  if (!list) return;
  const rows =
    state.mode === 'coop'
      ? coopScoreboardRows()
      : scoreboard(state).map((row) => {
          const node = clone('tpl-scoreboard-row');
          if (!node) return null;
          node.dataset.playerId = row.playerId;
          // The row already says "Playing" in its own element, so the name
          // stays the name - a screen reader used to hear it twice.
          node.dataset.active = row.isActive ? 'true' : 'false';
          applySeat(node, row.color);
          paintAvatar(node.querySelector('.score-row__avatar'), row);
          fill(node, { name: row.name, togo: row.cardsToGo });
          buildTokenPills(node.querySelector('[data-field="tokens"]'), row.tokens);
          const strip = node.querySelector('[data-field="timeline"]');
          if (strip) replaceChildren(strip, row.timeline.map(miniCard));
          return node;
        });
  replaceChildren(list, rows);

  // How much game is left. The scoreboard is where somebody checks whether it is
  // worth starting another round before dinner, and "9 cards left" answers that
  // better than any of the rows do. Skips are counted in the same line because
  // they are the other reason the deck shrinks without anybody scoring.
  const left = state.deck.length;
  const skipped = state.skips;
  const parts = [plural(left, 'card') + ' left in the deck'];
  if (skipped > 0) parts.push(`${plural(skipped, 'card')} skipped`);
  text('scoreboard-meta', parts.join(' · '));
  show(el('scoreboard-meta'), true);
}

/* ========================================================================== */
/* Win screen                                                                 */
/* ========================================================================== */

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** "1 card" / "3 cards". The win screen is the one line that gets read aloud. */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function renderWin() {
  const result = state && state.result;
  const won = winners(state);
  const box = el('win');
  const coopLoss = result && result.coopWon === false;
  const noWinner = !result || won.length === 0;
  if (box) box.dataset.outcome = coopLoss || noWinner ? 'loss' : 'win';

  let eyebrow = 'Winner';
  let title = 'Nobody';
  let summary = '';

  // The winner's face, big, and the whole screen in their colour. Co-op has no
  // single winner and a loss has none at all, so the circle simply goes.
  const face = el('win-avatar');
  const champion = state.mode === 'coop' || won.length === 0 ? null : won[0];
  show(face, !!champion);
  if (champion) {
    paintAvatar(face, champion);
    if (box) applySeat(box, champion.color);
  } else if (box) {
    box.style.removeProperty('--seat');
    box.style.removeProperty('--seat-soft');
    box.style.removeProperty('--seat-glow');
  }

  if (state.mode === 'coop') {
    const cards = state.sharedTimeline.length;
    const mistakes = `${state.mistakes} of ${plural(state.mistakeLimit, 'mistake')} used`;
    if (result && result.coopWon) {
      eyebrow = 'Co-op win';
      title = 'Everybody';
      summary = `${plural(cards, 'card')} together with ${mistakes}.`;
    } else if (result && result.reason === 'ended') {
      // Somebody tapped End game. There is a deck left and there are mistakes
      // left; saying the deck ran dry would be inventing a defeat nobody had.
      eyebrow = 'Game over';
      title = 'Stopped early';
      summary = `${plural(cards, 'card')} of ${state.targetCards}, with ${mistakes}.`;
    } else {
      eyebrow = 'Game over';
      title = 'So close';
      summary =
        result && result.reason === 'mistake-limit'
          ? `${plural(state.mistakeLimit, 'mistake')} reached on ${plural(cards, 'card')}.`
          : `The deck ran dry on ${cards} of ${state.targetCards} cards.`;
    }
    replaceChildren(el('win-timeline'), state.sharedTimeline.map(miniCard));
  } else if (won.length > 0) {
    // "Ended" is somebody tapping End game, not a victory - say so rather than
    // handing out a trophy nobody played for.
    if (result.reason === 'ended') {
      eyebrow = won.length > 1 ? 'Level when it ended' : 'Ahead when it ended';
    } else {
      eyebrow = won.length > 1 ? 'Joint winners' : 'Winner';
    }
    title = joinNames(won.map((p) => p.name));
    const lead = won[0];
    summary = `${plural(lead.timeline.length, 'card')}, ${plural(lead.tokens, 'token')} left.`;
    replaceChildren(el('win-timeline'), lead.timeline.map(miniCard));
  } else {
    eyebrow = 'Game over';
    title = 'No winner';
    summary = 'The game ended before anyone got there.';
    replaceChildren(el('win-timeline'), []);
  }

  text('win-eyebrow', eyebrow);
  // The heading's sr-only prefix must match the outcome: "Winner:" over a
  // co-op loss announced a victory nobody had. The eyebrow already says the
  // honest thing, so the prefix simply repeats it.
  text('win-title-prefix', `${eyebrow}: `);
  text('win-player-name', title);
  text('win-summary', summary);
  renderRecap();
  renderPot();
  announce(`${eyebrow}: ${title}. ${summary}`);
}

/**
 * The four things worth remembering about a game that is now over. The engine
 * returns null for any of them that did not earn itself - nobody challenged, no
 * song caught two people out - and a row that says "Boldest call: nobody" is
 * worse than no row, so those simply do not appear. All four null and the whole
 * list goes.
 */
function renderRecap() {
  const list = el('win-recap');
  if (!list) return;
  const summary = recap(state);
  const rows = [];

  const push = (key, value) => {
    const node = clone('tpl-recap-row');
    if (!node) return;
    fill(node, { key, value });
    rows.push(node);
  };

  if (summary.hardestSong) {
    // `card` is looked up from the timelines and the discard, so a card that
    // left the game by a route neither covers comes back null. Name what we can.
    const { card, misses } = summary.hardestSong;
    const title = card && card.title ? card.title : 'One song';
    push('Hardest song', `${title} - missed ${misses === 1 ? 'once' : `${misses} times`}`);
  }
  // One decade row, not one per player. The engine reports every player's best
  // decade, and printing all of them turns the recap into a table nobody reads -
  // four rows of "3 cards of 10" say nothing. The line is worth having only when
  // somebody actually stood out, so this takes the single strongest claim: a
  // dominant player first, then the biggest concentration, and nothing at all
  // when two people tie, following the engine's own rule that a badge shared by
  // two is worse than no badge.
  const decades = summary.bestDecades || [];
  const pool = decades.filter((row) => row.dominant);
  const contenders = pool.length > 0 ? pool : decades;
  // Rank on the raw count first - "4 cards in the 80s" beats "3 in the 70s"
  // however long the timelines are - then on the share, because two people on
  // three cards each are not equally specialised if one of them holds ten cards
  // and the other holds nine. Counting alone leaves four players tied often
  // enough that the row simply never appeared.
  const rank = (row) => [row.count, row.total > 0 ? row.count / row.total : 0];
  const better = (a, b) => {
    const [ac, as] = rank(a);
    const [bc, bs] = rank(b);
    return ac !== bc ? ac > bc : as > bs;
  };
  const top = contenders.reduce(
    (best, row) => (best === null || better(row, best) ? row : best),
    /** @type {typeof contenders[0]|null} */ (null),
  );
  // Dead level on both count and share: nobody stood out, so nobody is named.
  const shared =
    top !== null &&
    contenders.filter((row) => !better(row, top) && !better(top, row)).length > 1;
  if (top && !shared) {
    const decade = `${String(top.decade).slice(2)}s`;
    // "Owns the 80s" is a claim; make it only when the engine says the lead is
    // big enough to be one, otherwise state the fact and let it speak.
    const value = top.dominant
      ? `owns the ${decade}`
      : `${decade} - ${plural(top.count, 'card')} of ${top.total}`;
    push(top.name ? `${top.name}'s decade` : 'Best decade', value);
  }
  if (summary.boldestCall) {
    const { name, wins } = summary.boldestCall;
    push('Boldest call', `${name} - ${plural(wins, 'challenge')} won`);
  }
  if (summary.skipped) {
    push('Skipped', plural(summary.skipped, 'card'));
  }

  replaceChildren(list, rows);
  show(list, rows.length > 0);
}

/**
 * The payout. Deliberately not a transaction: this app has no server and holds
 * no money, so the most it can honestly do is put the right number and the right
 * handle in front of the room, and open Venmo with both filled in.
 *
 * With no handle saved there is still a pot worth naming - the room can settle
 * it however it likes - so the amount stays and only the button and the QR go.
 */
function renderPot() {
  const box = el('win-pot');
  if (!box) return;
  const payout = payoutFor();
  show(box, !!payout);
  if (!payout) return;

  // Co-op has no one to pay: the pot was everybody's, however the game ended,
  // so the block names the amount and stops - no payee, no button, no QR. A
  // defeat screen handing out a scannable payment request was the worst case.
  const coop = state.mode === 'coop';
  show(el('win-pot-venmo'), !coop);
  show(el('win-pot-coop'), coop);
  fill(box, {
    pot: payout.total,
    venmo: payout.handle ? `@${payout.handle}` : 'whoever is holding it',
    each: payout.perPlayer,
  });
  const payable = !coop && !!payout.url;
  show(el('btn-venmo'), payable);

  const qr = el('win-qr');
  if (qr) {
    // The QR is one buy-in, same as the button, so a cousin across the table can
    // scan it and pay their own share without typing a handle.
    qr.innerHTML = payable ? qrSvg(payout.url) : '';
    if (payable) {
      qr.setAttribute('aria-label', `Scan to send ${payout.perPlayer} to @${payout.handle}`);
    }
  }
  const frame = qr && qr.closest('.pot__frame');
  show(frame, payable);
  // The caption describes the QR, so it goes wherever the QR goes - with no
  // handle there is nothing to scan and "scan this to pay" would be a lie.
  show(box.querySelector('.pot__note'), payable);
}

/* ========================================================================== */
/* Sheets                                                                     */
/* ========================================================================== */

function openSheet(id, opener) {
  const sheet = el(id);
  if (!sheet) return;
  view.lastFocus = opener || document.activeElement;
  sheet.dataset.open = 'true';
  if (id === 'menu-sheet') view.menuOpen = true;
  if (id === 'challenge-sheet') view.challengeOpen = true;
  render();
  const focusable = sheet.querySelector(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable) requestAnimationFrame(() => focusable.focus());
}

function closeSheet(id) {
  const sheet = el(id);
  if (!sheet) return;
  sheet.dataset.open = 'false';
  if (id === 'menu-sheet') {
    view.menuOpen = false;
    disarmEndGame();
  }
  if (id === 'challenge-sheet') {
    view.challengeOpen = false;
    view.challengerId = null;
    view.challengeGap = null;
  }
  render();
  const back = view.lastFocus;
  view.lastFocus = null;
  if (back && document.contains(back)) requestAnimationFrame(() => back.focus());
}

function closeSheets() {
  for (const id of ['menu-sheet', 'challenge-sheet']) {
    const sheet = el(id);
    if (sheet) sheet.dataset.open = 'false';
  }
  view.menuOpen = false;
  view.challengeOpen = false;
  view.challengerId = null;
  view.challengeGap = null;
  disarmEndGame();
}

function renderSheets() {
  const menuBtn = el('btn-menu');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', view.menuOpen ? 'true' : 'false');
  const challengeBtn = el('btn-challenge');
  if (challengeBtn) challengeBtn.setAttribute('aria-expanded', view.challengeOpen ? 'true' : 'false');
  if (view.challengeOpen) renderChallengeSheet();
}

function renderChallengeSheet() {
  if (!state) return;
  const active = currentPlayer(state);
  if (!active) return;

  const list = el('challenge-players');
  if (list) {
    const rows = state.players
      .filter((p) => p.id !== active.id)
      .map((p) => {
        const node = clone('tpl-challenge-option');
        if (!node) return null;
        const button = node.querySelector('.challenge-option');
        if (!button) return null;
        button.dataset.playerId = p.id;
        applySeat(button, p.color);
        paintAvatar(button.querySelector('.avatar'), p);
        const blocked = challengeBlockedReason(state, p.id);
        const existing = challengeFor(state, p.id);
        const tokens = tokensFor(state, p.id);
        fill(button, {
          name: p.name,
          tokens: existing
            ? 'Locked in - tap to take it back'
            : blocked || `${tokens} token${tokens === 1 ? '' : 's'}`,
        });
        pressed(button, view.challengerId === p.id);
        if (existing) {
          // Still a live control, doing the opposite thing. Leaving it disabled
          // stranded a player with a spent token and a placement they knew was
          // wrong, which is the least fun a token can buy.
          button.dataset.action = 'remove-challenge';
          disable(button, false);
        } else {
          disable(button, blocked !== null, blocked || undefined);
        }
        return node;
      });
    replaceChildren(list, rows);
  }

  const step = el('challenge-step-gap');
  const chosen = view.challengerId;
  show(step, !!chosen);
  if (chosen) {
    const challenger = playerOf(chosen);
    applySeat(step, challenger && challenger.color);
    text('challenge-player-name', nameOf(chosen));
    paintStrip(
      el('challenge-timeline'),
      gapsFor(state, chosen),
      timelineFor(state, chosen),
      view.challengeGap,
    );
  }
  disable(el('btn-challenge-confirm'), !chosen || view.challengeGap === null);
}

/* ========================================================================== */
/* The single render                                                          */
/* ========================================================================== */

function render() {
  if (state) {
    document.body.dataset.mode = state.mode;
    // One place publishes the active player's accent; play, pass and reveal all
    // inherit it from <body>. Anything showing somebody else (the winner, a
    // scoreboard row, a challenge option) overrides it on its own element.
    const active = currentPlayer(state);
    if (active) applySeat(document.body, active.color);
  }

  switch (view.screen) {
    case 'home':
      renderHome();
      break;
    case 'setup':
      renderSetup();
      break;
    case 'pass':
      if (state) renderPass();
      break;
    case 'play':
      if (state) renderPlay();
      break;
    case 'reveal':
      if (state) renderReveal();
      break;
    case 'scoreboard':
      if (state) renderScoreboard();
      break;
    case 'win':
      if (state) renderWin();
      break;
    default:
      break;
  }
  renderSheets();
}

/* ========================================================================== */
/* Actions                                                                    */
/* ========================================================================== */

function stepTarget(delta) {
  const index = TARGET_CHOICES.indexOf(view.setup.target);
  const next = Math.min(TARGET_CHOICES.length - 1, Math.max(0, (index < 0 ? 1 : index) + delta));
  view.setup.target = TARGET_CHOICES[next];
  queueSetupSave();
  render();
}

function stepMistakes(delta) {
  view.setup.mistakeLimit = Math.min(
    MAX_MISTAKES,
    Math.max(MIN_MISTAKES, view.setup.mistakeLimit + delta),
  );
  queueSetupSave();
  render();
}

function stepBuyin(delta) {
  const next = view.setup.buyin.amount + delta * BUYIN_STEP_CENTS;
  view.setup.buyin.amount = Math.min(BUYIN_MAX_CENTS, Math.max(BUYIN_MIN_CENTS, next));
  queueSetupSave();
  render();
}

/**
 * What one person owes, where it goes, and a link that opens Venmo with all of
 * it filled in. Null whenever any part of that is unknown, so the caller can
 * hide the offer rather than show a button that goes somewhere wrong.
 */
function payoutFor() {
  // The stake SNAPSHOT taken at Shuffle & start, never the live setup draft:
  // the draft belongs to whatever game somebody is thinking about next, and
  // editing it must not touch the pot of the game on the table.
  const stake = getStored(ACTIVE_BUYIN_KEY, null);
  if (!stake || typeof stake !== 'object' || stake.enabled !== true || !state) return null;
  const amount = Number.isInteger(stake.amount) ? stake.amount : 0;
  const handle = normaliseHandle(stake.handle || '');
  const pot = potFor({ amount, playerCount: state.players.length });
  if (!pot || pot.totalCents <= 0) return null;

  const won = winners(state);
  const champion = state.mode === 'coop' || won.length === 0 ? null : won[0];
  const note = champion ? `Timeline - ${champion.name} took the pot` : 'Timeline - the pot';
  // The amount on the link is ONE buy-in, not the pot. Whoever taps this is a
  // person who owes their own share; a link pre-filled with the total would ask
  // every single player to pay for everybody, which is the one number here that
  // is certainly wrong.
  return {
    total: pot.total,
    perPlayer: pot.perPlayer,
    handle,
    url: handle ? venmoPayUrl({ handle, amount: pot.perPlayerCents, note }) : null,
  };
}

function openVenmo() {
  const payout = payoutFor();
  if (!payout || !payout.url) return;
  // noopener because this leaves for a payments site; noreferrer keeps the game
  // URL, which carries no secrets but is nobody's business, out of the referer.
  window.open(payout.url, '_blank', 'noopener,noreferrer');
}

function toggleChip(kind, value) {
  const bucket = kind === 'decade' ? view.setup.decades : view.setup.genres;
  const index = bucket.indexOf(value);
  if (index >= 0) {
    bucket.splice(index, 1);
    // filterDeck treats an empty selection as "everything", so the display has
    // to as well: turning the LAST chip off re-presses the whole group rather
    // than showing eight unpressed chips over a full deck.
    if (bucket.length === 0) {
      if (kind === 'decade') view.setup.decades = DECADES.slice();
      else view.setup.genres = GENRES.slice();
    }
  } else {
    bucket.push(value);
  }
  queueSetupSave();
  render();
}

function chipsAll(target) {
  // The one-tap way back to a full deck - and only that. It used to toggle to
  // an empty selection, which filterDeck reads as "everything": a full deck
  // under eight unpressed chips, the same display lie toggleChip now refuses.
  if (target === 'decade') view.setup.decades = DECADES.slice();
  else view.setup.genres = GENRES.slice();
  queueSetupSave();
  render();
}

function stepYear(delta) {
  if (!state) return;
  ensureCard();
  const current = state.yearGuess === null ? DEFAULT_YEAR_GUESS : state.yearGuess;
  const next = Math.min(YEAR_MAX, Math.max(YEAR_MIN, current + delta));
  dispatch({ type: ACTIONS.SET_YEAR_GUESS, year: next });
}

function commitPlacement() {
  if (!state || state.selectedGap === null) return;
  stopAudio();
  dispatch({ type: ACTIONS.COMMIT_PLACEMENT, gapIndex: state.selectedGap });
  dispatch({ type: ACTIONS.REVEAL });
  showReveal();
}

function buyCard() {
  stopAudio();
  dispatch({ type: ACTIONS.BUY_CARD });
  if (state.outcome) showReveal();
}

/**
 * Guards `skip this card` against tap bursts. The button stays put and a skip
 * repaints nothing around it, so a double-tap during the card-swap moment used
 * to burn a second (unheard) song. Place and Buy get their guard from engine
 * state; a skip lands on a fresh, skippable card, so this one is a cooldown -
 * long enough to swallow a burst, short enough that no deliberate second skip
 * ever meets a dead button.
 */
let skipGuardTimer = null;

function skipCard() {
  const button = el('btn-skip-card');
  if (button && button.disabled) return;
  disable(button, true);
  if (skipGuardTimer !== null) clearTimeout(skipGuardTimer);
  skipGuardTimer = window.setTimeout(() => {
    skipGuardTimer = null;
    disable(el('btn-skip-card'), false);
  }, 650);

  stopAudio();
  dispatch({ type: ACTIONS.SKIP_CARD });
  if (state.card) {
    resetCardAudio();
    view.audio.status = 'New card drawn. No penalty.';
    render();
    announce('Card skipped, a new one is up.');
  } else {
    showReveal();
  }
}

function gated() {
  return state.mode === 'advanced' || state.mode === 'expert';
}

/**
 * Re-derive the group's Title/Artist vote from the engine after a reload.
 *
 * In classic and co-op those two buttons are pure view state: the engine only
 * stores the single "they named it" verdict the pair adds up to. A reload
 * therefore came back to a confirmed claim with both buttons unpressed, and the
 * next tap sent `ok: false` and took back a token the group had already
 * awarded - the reveal screen would even still be listing the "+1". The only
 * vote that can produce a confirmed claim is both-ticked, so restore exactly
 * that. Advanced and expert keep their votes in `state.confirmations` and need
 * nothing here.
 */
function restoreIdentifyVote() {
  if (!state || gated()) return;
  const confirmed = state.confirmations && state.confirmations.identify === true;
  view.identifyVote = { title: confirmed, artist: confirmed };
}

/** True when the group has ticked that box, whichever store is in charge. */
function voted(which) {
  return gated() ? state.confirmations[which] === true : view.identifyVote[which];
}

function confirmToggle(which) {
  if (!state) return;
  const wasPending = verdictPending(state.outcome);
  const next = !voted(which);
  if (gated()) {
    dispatch({ type: ACTIONS.CONFIRM_TITLE_ARTIST, [which]: next });
  } else {
    view.identifyVote = { ...view.identifyVote, [which]: next };
  }
  if (state.claimIdentify) {
    dispatch({ type: ACTIONS.CONFIRM_IDENTIFY, ok: voted('title') && voted('artist') });
  } else {
    render();
  }
  // The verdict cue showReveal held back while the vote was open (see there).
  const outcome = state.outcome;
  if (wasPending && outcome && !verdictPending(outcome)) {
    if (outcome.accepted) sfx.win();
    else sfx.lose();
    if (outcome.tokenAwards.some((award) => award.delta > 0)) sfx.token();
  }
}

function nextTurn() {
  // Next player renders at Place-here's exact coordinates, so the second half
  // of a tap burst used to skip the whole reveal (and, in gated modes, forfeit
  // a correctly placed card before anyone could vote). See TAP_GUARD_MS.
  if (Date.now() < revealTapGuardUntil) return;
  stopAudio();
  dispatch({ type: ACTIONS.NEXT_TURN });
  if (isGameOver(state)) showWin();
  else beginTurn();
}

function confirmChallenge() {
  if (!view.challengerId || view.challengeGap === null) return;
  const who = view.challengerId;
  dispatch({
    type: ACTIONS.ADD_CHALLENGE,
    playerId: who,
    gapIndex: view.challengeGap,
  });
  if (!state.lastError) announce(`${nameOf(who)} challenged. One token spent.`);
  closeSheet('challenge-sheet');
}

/* ========================================================================== */
/* Event wiring                                                               */
/* ========================================================================== */

const HANDLERS = {
  'new-game': () => {
    loadSavedPlayers();
    showScreen('setup');
  },
  'resume-game': () => {
    const saved = savedGame();
    if (!saved) {
      alertUser('That saved game could not be opened.');
      renderHome();
      return;
    }
    state = saved;
    // Adopt the save's write counter: this tab is now exactly as fresh as the
    // slot, and the next persist() continues the count instead of losing to it.
    saveCounter = storedWriteCount();
    resetCardAudio();
    restoreIdentifyVote();
    // Resume can land straight on a reveal, whose artwork was fetched during
    // playback - a step resume skips. The baked map answers synchronously when
    // it has arrived; otherwise the placeholder stands in, as it always could.
    if (
      (saved.phase === 'revealed' || saved.phase === 'turn-end') &&
      saved.outcome &&
      saved.outcome.card
    ) {
      const baked = bakedTrackSync(saved.outcome.card);
      if (baked && baked.artworkUrl) view.audio.resolved = baked;
    }
    beginTurn();
  },
  'show-rules': () => {
    if (view.screen !== 'rules') view.returnScreen = view.screen;
    closeSheets();
    showScreen('rules');
  },
  'rules-back': () => showScreen(view.returnScreen === 'rules' ? 'home' : view.returnScreen),
  home: () => goHome(),
  'add-player': () => {
    if (view.setup.players.length >= MAX_PLAYERS) return;
    // The lowest free "Player N", not the row count: after a remove, counting
    // rows mints a duplicate of a name already on the roster.
    view.setup.players.push(playerDraft(view.setup.players.length, freePlaceholderName()));
    render();
  },
  'remove-player': (node) => {
    const row = node.closest('[data-player-index]');
    if (!row) return;
    if (view.setup.players.length <= MIN_PLAYERS) return;
    view.setup.players.splice(Number(row.dataset.playerIndex), 1);
    rememberRoster();
    render();
  },
  // The button is the accessible control; the <input type="file"> behind it is
  // an implementation detail that stays hidden. No `capture` attribute on that
  // input, deliberately - it is what makes iOS offer "Take Photo" AND "Photo
  // Library" instead of forcing the camera on someone who already has the shot.
  'pick-photo': (node) => {
    const row = node.closest('[data-player-index]');
    if (!row) return;
    const input = row.querySelector('[data-role="player-photo"]');
    if (input) input.click();
  },
  'skip-photo': (node) => {
    const row = node.closest('[data-player-index]');
    if (row) skipPhoto(Number(row.dataset.playerIndex));
  },
  'add-person': (node) => addPersonToGame(node.dataset.name),
  'forget-person': (node) => {
    const name = node.dataset.name;
    if (!name) return;
    forgetPerson(name);
    announce(`${name} forgotten.`);
    render();
  },
  'toggle-people-edit': () => {
    view.peopleEditing = !view.peopleEditing;
    render();
  },
  'use-saved-photo': (node) => {
    const row = node.closest('[data-player-index]');
    if (!row) return;
    applySavedPhoto(Number(row.dataset.playerIndex), Number(node.dataset.photoIndex));
  },
  'target-dec': () => stepTarget(-1),
  'target-inc': () => stepTarget(1),
  'mistakes-dec': () => stepMistakes(-1),
  'mistakes-inc': () => stepMistakes(1),
  'buyin-dec': () => stepBuyin(-1),
  'buyin-inc': () => stepBuyin(1),
  'pay-venmo': () => openVenmo(),
  'toggle-decade': (node) => toggleChip('decade', Number(node.dataset.decade)),
  'toggle-genre': (node) => toggleChip('genre', node.dataset.genre),
  'chips-all': (node) => chipsAll(node.dataset.target),
  // Armed tap, but only while an unfinished game sits in the save slot -
  // starting would silently destroy it. A finished save is replaced silently.
  'start-game': () => {
    // The sticky Shuffle & start bar can also sit under a Play-again double
    // tap - starting a game from a tap burst is worse than resetting a mode.
    if (Date.now() < setupTapGuardUntil) return;
    if (!view.startArmed) {
      const saved = savedGame();
      if (saved && saved.phase !== 'game-over') {
        armStartGame();
        return;
      }
    }
    disarmStartGame();
    startGame();
  },
  'pass-continue': () => enterPlay(),
  'open-menu': (node) => openSheet('menu-sheet', node),
  'close-menu': () => closeSheet('menu-sheet'),
  'show-scoreboard': () => {
    closeSheet('menu-sheet');
    if (view.screen !== 'scoreboard') view.returnScreen = view.screen;
    showScreen('scoreboard');
  },
  'close-scoreboard': () =>
    showScreen(view.returnScreen === 'scoreboard' ? 'play' : view.returnScreen),
  // Armed tap: ending is one row above "done" and cannot be undone, so the
  // first tap only arms the row and says what a second one will do.
  'end-game': () => {
    if (!view.endGameArmed) {
      armEndGame();
      return;
    }
    disarmEndGame();
    endGame();
  },
  'toggle-audio': () => {
    toggleAudio().catch(() => failAudio('The preview could not be loaded.'));
  },
  'replay-audio': () => replayAudio(),
  'show-streaming-links': () => {
    view.audio.linksShown = !view.audio.linksShown;
    render();
  },
  'skip-card': () => skipCard(),
  'select-gap': (node) => {
    const index = Number(node.dataset.gapIndex);
    if (node.closest('#challenge-timeline')) {
      view.challengeGap = index;
      render();
    } else {
      ensureCard();
      dispatch({ type: ACTIONS.SELECT_GAP, gapIndex: index });
    }
  },
  'buy-card': () => buyCard(),
  'toggle-identify': () => {
    if (!state) return;
    ensureCard();
    dispatch({ type: ACTIONS.SET_CLAIM_IDENTIFY, value: !state.claimIdentify });
  },
  'year-dec': () => stepYear(-1),
  'year-inc': () => stepYear(1),
  'open-challenge': (node) => {
    ensureCard();
    view.challengerId = null;
    view.challengeGap = null;
    openSheet('challenge-sheet', node);
  },
  'close-challenge': () => closeSheet('challenge-sheet'),
  'pick-challenger': (node) => {
    view.challengerId = node.dataset.playerId;
    view.challengeGap = null;
    render();
    // The render rebuilds the option list, destroying the focused button, and
    // keyboard focus fell to <body>. The next step is choosing a gap, so put
    // focus on the first gap of the newly revealed timeline.
    const gap = document.querySelector('#challenge-timeline .gap');
    if (gap) gap.focus();
  },
  // A challenge is a token spent on a guess, and the guess is made by tapping a
  // tiny gap on somebody else's timeline. Getting it wrong was unrecoverable:
  // the row went disabled and the token was gone. The engine has always
  // supported taking it back with a refund - nothing was exposing it.
  'remove-challenge': (node) => {
    const playerId = node.dataset.playerId;
    if (!playerId) return;
    dispatch({ type: ACTIONS.REMOVE_CHALLENGE, playerId });
    if (view.challengerId === playerId) {
      view.challengerId = null;
      view.challengeGap = null;
    }
    announce(`${nameOf(playerId)}'s challenge taken back. Token refunded.`);
    render();
  },
  'confirm-challenge': () => confirmChallenge(),
  'commit-placement': () => commitPlacement(),
  'confirm-title': () => confirmToggle('title'),
  'confirm-artist': () => confirmToggle('artist'),
  'next-turn': () => nextTurn(),
  'play-again': () => {
    state = null;
    clearGame();
    // The pot went with the game it belonged to.
    removeStored(ACTIVE_BUYIN_KEY);
    saveCounter = 0;
    // The setup screen appears under the finger that just tapped Play again,
    // with the Classic mode row at those exact coordinates - a double tap was
    // silently resetting the mode the table had chosen.
    setupTapGuardUntil = Date.now() + TAP_GUARD_MS;
    if (view.confettiStop) {
      view.confettiStop();
      view.confettiStop = null;
    }
    showScreen('setup');
  },
  // The stale overlay's one live control. Allowed through the stale gate in
  // onClick; everything else on a stale tab is refused.
  'reload-page': () => {
    window.location.reload();
  },
};

/** Which cue a given data-action gets. Anything unlisted gets the plain tap. */
const ACTION_CUES = {
  'select-gap': sfx.select,
  'commit-placement': sfx.place,
  'buy-card': sfx.place,
  'start-game': sfx.start,
  'play-again': sfx.start,
};

function onClick(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  const node = target.closest('[data-action]');
  if (!node) return;
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') return;
  // A stale tab accepts exactly one input: the Reload button on its notice.
  if (view.stale && node.dataset.action !== 'reload-page') return;
  const handler = HANDLERS[node.dataset.action];
  if (!handler) return;
  event.preventDefault();
  alertUser('');
  // Both of these have to happen here, synchronously, before the handler runs.
  // iOS only lets an AudioContext start inside a user gesture, and it stops
  // counting as one the moment we await anything - the same restriction that
  // shapes toggleAudio(). unlock() is cheap and idempotent after the first tap.
  sfx.unlock();
  (ACTION_CUES[node.dataset.action] || sfx.tap)();
  handler(node);
}

function onInput(event) {
  const node = event.target;
  if (view.stale) return;
  if (node.dataset && node.dataset.role === 'player-name') {
    const row = node.closest('[data-player-index]');
    if (!row) return;
    const index = Number(row.dataset.playerIndex);
    const draft = view.setup.players[index];
    if (!draft) return;
    draft.name = node.value;
    // The initial in the circle is the fallback avatar, so it has to keep up
    // with the name as it is typed.
    const avatar = row.querySelector('.player-row__avatar [data-field="initial"]');
    if (avatar) avatar.textContent = initialFor(node.value);
    // The avatar library is FILED on commit only ('change' fires on blur or
    // Enter, never per keystroke) but READ per keystroke. Filing on every
    // input event stored the row's face under each prefix of the name being
    // typed, and the library's 24-name cap then evicted every real person in
    // it. The lookup below is read-only, so offering saved faces while typing
    // stays live.
    if (event.type === 'change' && draft.photo) fileAvatar(draft.name, draft.photo);
    // The roster draft persists as the name is typed (debounced) and settles
    // on the commit, so a mid-setup reload restores what is on the screen
    // rather than resurrecting the name from the last photo/skip action.
    if (event.type === 'change') rememberRoster();
    else queueRosterSave();
    paintSavedAvatars(row, draft, index);
    // Everything else keyed on this name follows the keystroke too: the row's
    // control labels, and the guest chips' seated/full state - a renamed row
    // used to leave "Zoe is already playing" on a chip for the rest of setup.
    paintRowLabels(row, draft, index);
    paintNameCount(row, draft);
    paintPeople();
    return;
  }
  if (node.dataset && node.dataset.role === 'player-photo') {
    const row = node.closest('[data-player-index]');
    const file = node.files && node.files[0] ? node.files[0] : null;
    // Clear the input immediately: keeping the selection alive would pin a
    // multi-megabyte capture in memory for the rest of the session, and it also
    // means picking the same file twice in a row still fires a change event.
    node.value = '';
    if (!row || !file) return;
    const draft = view.setup.players[Number(row.dataset.playerIndex)];
    acceptPhoto(draft, file).catch(() => {
      if (draft) draft.pending = false;
      alertUser('That photo could not be read. Try another one, or tap Skip photo.');
      render();
    });
    return;
  }
  if (node.name === 'mode') {
    // The setup form appears under the finger that tapped Play again, with a
    // mode row at those coordinates - the second half of a tap burst must not
    // reset the mode the table chose. Put the radio back and swallow it.
    if (Date.now() < setupTapGuardUntil) {
      const radio = el(`mode-${view.setup.mode}`);
      if (radio) radio.checked = true;
      return;
    }
    view.setup.mode = node.value;
    document.body.dataset.mode = node.value;
    queueSetupSave();
    render();
    return;
  }
  if (node.id === 'playback-source' || node.id === 'opt-playback-source') {
    updateSettings({ playbackSource: node.value });
    // A preview left running under the new source would be an orphan: the
    // controls would say "Open Spotify" while the song kept playing and the
    // hub's Pause paused nothing. Stop it and repaint the card's audio state
    // in the new source's terms.
    if (view.screen === 'play' && state && state.card) {
      stopAudio();
      if (node.value !== 'preview') {
        view.audio.failed = true;
        view.audio.linksShown = false;
        view.audio.status = `Open ${SOURCE_LABELS[node.value]} to play this card.`;
      } else {
        view.audio.failed = false;
        view.audio.status = settings.sound
          ? 'Tap play when everyone is listening.'
          : 'Sound is off. Turn it on in the menu.';
      }
    }
    if (view.screen === 'play') render();
    return;
  }
  if (node.id === 'opt-streak-bonus') {
    view.setup.streakBonus = node.checked;
    queueSetupSave();
    return;
  }
  if (node.id === 'opt-buyin') {
    view.setup.buyin.enabled = node.checked;
    queueSetupSave();
    render();
    return;
  }
  if (node.id === 'buyin-venmo') {
    // Stored raw and normalised only where it is used. Normalising on every
    // keystroke would delete the "@" the moment somebody typed it, and fight a
    // person halfway through their own name.
    view.setup.buyin.handle = node.value;
    queueSetupSave();
    // Repaint only the buy-in block: the hint under the field tracks the
    // keystrokes, and a full render here would be work for nothing.
    paintBuyin();
    return;
  }
  if (node.id === 'opt-skip-pass') updateSettings({ skipPass: node.checked });
  if (node.id === 'opt-reduced-motion') updateSettings({ reducedMotion: node.checked });
  if (node.id === 'opt-sound') {
    updateSettings({ sound: node.checked });
    if (!node.checked) stopAudio();
  }
}

/**
 * A rotated phone changes how many faces fit, and the rail would otherwise keep
 * a scroll offset that leaves the active one off screen for the rest of the
 * turn. Debounced and rail-only: a full render() here would redraw the QR code
 * every time a mobile browser's address bar slid away.
 */
let railResizeTimer = null;
function onResize() {
  if (railResizeTimer !== null) return;
  railResizeTimer = window.setTimeout(() => {
    railResizeTimer = null;
    if (!state) return;
    if (view.screen === 'play') paintRoster(el('play-roster-seats'), el('play-roster-team'));
    else if (view.screen === 'reveal') paintRoster(el('reveal-roster-seats'), el('reveal-roster-team'));
  }, 180);
}

/** What openSheet() considers focusable; the Tab trap has to agree with it. */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The open sheet layer, or null. The two are mutually exclusive by design. */
function openSheetLayer() {
  if (view.challengeOpen) return el('challenge-sheet');
  if (view.menuOpen) return el('menu-sheet');
  return null;
}

/**
 * Keep Tab inside the open sheet. The sheets claim aria-modal="true", and
 * without this the claim was a lie: Shift+Tab walked straight out onto the
 * covered play screen, where Enter could commit a placement from behind the
 * scrim. Escape still closes (below), and closeSheet restores focus.
 */
function trapSheetFocus(event, sheet) {
  const focusable = [...sheet.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (node) => !node.closest('[hidden]'),
  );
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const current = document.activeElement;
  const inside = sheet.contains(current);
  if (event.shiftKey) {
    if (!inside || current === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || current === last) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event) {
  // A stale tab is read-only until it reloads; only Tab (to reach the Reload
  // button) and Enter/Space on it - plain button activation - pass through.
  if (view.stale && event.key === 'Escape') {
    event.preventDefault();
    return;
  }
  if (event.key === 'Tab') {
    const sheet = openSheetLayer();
    if (sheet) trapSheetFocus(event, sheet);
    return;
  }
  if (event.key !== 'Escape') return;
  if (view.challengeOpen) {
    closeSheet('challenge-sheet');
    event.preventDefault();
  } else if (view.menuOpen) {
    closeSheet('menu-sheet');
    event.preventDefault();
  }
}

/* ========================================================================== */
/* Boot                                                                       */
/* ========================================================================== */

function registerServiceWorker() {
  // A failed worker registration must never be the reason a family cannot play,
  // so every branch here is swallowed on purpose.
  try {
    if (window.location.protocol === 'file:') return;
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      try {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      } catch {
        /* nothing to do - offline support is a bonus, not a requirement */
      }
    });
  } catch {
    /* no navigator at all (a very odd webview): carry on without offline. */
  }
}

function init() {
  // Start fetching the baked previews immediately. By the time anyone reaches a
  // play button the map is in memory, which is what lets the tap handler look a
  // card up without awaiting - see the note at the top of toggleAudio().
  primeBaked();

  loadSavedSettings();
  applySettings();
  loadSavedPlayers();
  loadSavedBuyin();
  // After the stake: the draft is the fresher record of the whole setup form
  // (the buy-in included), so what was on screen at the reload comes back.
  loadSetupDraft();
  buildChips();

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);

  // Two tabs on one game must not be a silent time machine. The storage event
  // only fires in the OTHER tab, so this is exactly the cross-tab signal: a
  // home screen refreshes its resume card; a mid-game tab is now provably
  // stale and gets locked behind the reload notice. persist() backstops this
  // with the write counter, for browsers that drop the event.
  window.addEventListener('storage', (event) => {
    if (event.key !== `${NAMESPACE}:v${VERSION}:${KEYS.game}`) return;
    if (view.screen === 'home') render();
    else if (state && storedWriteCount() > saveCounter) enterStaleState();
  });

  // Nothing here should ever throw, but if something does the player gets a
  // sentence instead of a frozen screen.
  window.addEventListener('error', (event) => {
    alertUser('Something went wrong. The game state is saved.');
    void event;
  });
  window.addEventListener('unhandledrejection', (event) => {
    alertUser('Something went wrong. The game state is saved.');
    void event;
  });

  if (/[?&]debug=1\b/.test(window.location.search)) {
    // A deliberate, opt-in seam for the Playwright walkthrough. Off by default
    // because it would otherwise put the year one console line away.
    Object.defineProperty(window, '__timeline', {
      value: {
        get state() {
          return state;
        },
        get view() {
          return view;
        },
        get settings() {
          return settings;
        },
      },
      configurable: true,
    });
  }

  showScreen('home');
  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
