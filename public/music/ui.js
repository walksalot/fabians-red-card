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
} from './storage.js';
import { qrSvg } from './qr.js';
import { burst } from './confetti.js';

/* ========================================================================== */
/* Constants                                                                  */
/* ========================================================================== */

/** iTunes previews are 30s; the ring is drawn against this when duration is unknown. */
const PREVIEW_SECONDS = 30;

const TARGET_CHOICES = [5, 10, 15];
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
  qrAlt: false,
  /**
   * The group's Title/Artist vote in classic + co-op, where the engine has no
   * title/artist gate and the two buttons are only there to settle an
   * "I can name it" claim. Advanced and expert read state.confirmations instead.
   */
  identifyVote: { title: false, artist: false },
  confettiStop: null,
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

function alertUser(message) {
  const node = el('live-alert');
  if (node) node.textContent = String(message);
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
function applySeat(node, color) {
  if (!node) return;
  const hex = typeof color === 'string' && color ? color : seatColor(0);
  node.style.setProperty('--seat', hex);
  node.style.setProperty('--seat-soft', seatAlpha(hex, 0.18));
  node.style.setProperty('--seat-glow', seatAlpha(hex, 0.45));
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
function rememberRoster() {
  savePlayers(
    view.setup.players.map((p) => ({
      name: (p.name || '').trim(),
      photo: p.photo,
      skipped: !!p.skipped,
    })),
  );
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
  // roster has moved on.
  rememberAvatar(draft.name, photo);
  render();
  announce(`Photo added for ${draft.name || 'this player'}.`);
}

/** A row nobody has touched: still the placeholder name, no photo, not skipped. */
function isUntouchedRow(draft, index) {
  return (
    !draft.photo
    && !draft.skipped
    && (!draft.name || draft.name.trim() === `Player ${index + 1}`)
  );
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
  rememberAvatar(draft.name, photo);
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

function persist() {
  if (!state) return;
  if (isGameOver(state)) clearGame();
  else saveGame(state);
}

/* ========================================================================== */
/* Screens                                                                    */
/* ========================================================================== */

function showScreen(name) {
  const leavingPlay = view.screen === 'play' && name !== 'play';
  view.screen = name;
  document.body.dataset.screen = name;
  if (leavingPlay) stopAudio();
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

function savedGame() {
  const raw = loadGame();
  if (!raw) return null;
  try {
    const restored = deserialize(raw);
    if (restored.phase === 'game-over') return null;
    return restored;
  } catch {
    clearGame();
    return null;
  }
}

function renderHome() {
  const saved = savedGame();
  const button = el('btn-resume-game');
  show(button, !!saved);
  if (saved) {
    const names = saved.players.map((p) => p.name).join(', ');
    text('btn-resume-detail', `Turn ${saved.turn} - ${names}`);
  }
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

/** Rebuild the chip rows from deck.js, which is the authority on what exists. */
function buildChips() {
  const decadeBox = el('decade-chips');
  if (decadeBox) {
    replaceChildren(
      decadeBox,
      DECADES.map((decade) => {
        const chip = clone('tpl-chip');
        if (!chip) return null;
        chip.dataset.action = 'toggle-decade';
        chip.dataset.decade = String(decade);
        delete chip.dataset.genre;
        fill(chip, { label: `${String(decade).slice(2)}s` });
        return chip;
      }),
    );
  }
  const genreBox = el('genre-chips');
  if (genreBox) {
    replaceChildren(
      genreBox,
      GENRES.map((genre) => {
        const chip = clone('tpl-chip');
        if (!chip) return null;
        chip.dataset.action = 'toggle-genre';
        chip.dataset.genre = genre;
        delete chip.dataset.decade;
        fill(chip, { label: GENRE_LABELS[genre] || genre });
        return chip;
      }),
    );
  }
}

const PHOTO_STATUS = {
  none: 'Photo needed',
  photo: 'Photo added',
  skipped: 'Using their initial',
  pending: 'Shrinking the photo...',
};

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

    const person = draft.name || `player ${index + 1}`;
    if (avatar) {
      avatar.setAttribute(
        'aria-label',
        draft.photo ? `Replace the photo for ${person}` : `Add a photo for ${person}`,
      );
    }
    const skip = row.querySelector('[data-action="skip-photo"]');
    pressed(skip, stateName === 'skipped');
    if (skip) {
      skip.textContent = stateName === 'skipped' ? 'Photo skipped' : 'Skip photo';
      skip.setAttribute('aria-label', `Skip the photo for ${person}`);
    }
    const remove = row.querySelector('[data-action="remove-player"]');
    if (remove) remove.setAttribute('aria-label', `Remove ${person}`);
    disable(remove, drafts.length <= MIN_PLAYERS, 'At least two players');
  });

  text('player-count-note', `${drafts.length} player${drafts.length === 1 ? '' : 's'}`);
  disable(el('btn-add-player'), drafts.length >= MAX_PLAYERS, 'Eight players is the maximum');
}

function eligibleDeck() {
  return filterDeck(DECK, { decades: view.setup.decades, genres: view.setup.genres });
}

function renderSetup() {
  document.body.dataset.mode = view.setup.mode;
  paintPeople();
  renderPlayerRows();

  text('target-cards-value', view.setup.target);
  text('mistake-limit-value', view.setup.mistakeLimit);

  const radio = el(`mode-${view.setup.mode}`);
  if (radio) radio.checked = true;
  show(el('field-mistake-limit'), view.setup.mode === 'coop');

  for (const chip of document.querySelectorAll('#decade-chips .chip')) {
    pressed(chip, view.setup.decades.includes(Number(chip.dataset.decade)));
  }
  for (const chip of document.querySelectorAll('#genre-chips .chip')) {
    pressed(chip, view.setup.genres.includes(chip.dataset.genre));
  }

  const eligible = eligibleDeck();
  text('eligible-count-value', eligible.length);

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
    if (draft.photo) rememberAvatar(draft.name, draft.photo);
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
      seed,
    });
  } catch (error) {
    alertUser(error && error.message ? error.message : 'That game could not be set up.');
    return;
  }
  persist();
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

function showReveal() {
  view.qrAlt = false;
  showScreen('reveal');
  runFlip();
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
  clearGame();
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
  clearGame();
  showWin();
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
    audioPlayer.subscribe(paintAudio);
  }
  return audioPlayer;
}

function stopAudio() {
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
    status: !state || !state.card
      ? 'Tap play to draw the mystery song.'
      : settings.sound
        ? 'Tap play when everyone is listening.'
        : 'Sound is off. Turn it on in the menu.',
  };
  view.qrAlt = false;
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
  const p = audioPlayer;
  const playing = !!(p && p.playing);
  const duration = p && p.duration > 0 ? p.duration : PREVIEW_SECONDS;
  const elapsed = p ? Math.min(p.currentTime, duration) : 0;
  const remaining = Math.max(0, duration - elapsed);

  text('countdown-value', Math.ceil(remaining));
  const ring = el('countdown-ring');
  if (ring) ring.style.setProperty('--ring-progress', String(remaining / duration));

  const button = el('btn-play-song');
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
 * survive.
 */
function listenUrl(card, turnNumber) {
  const payload = {
    v: 1,
    t: typeof card.title === 'string' ? card.title : '',
    a: typeof card.artist === 'string' ? card.artist : '',
    n: turnNumber,
  };
  const dir = window.location.pathname.replace(/[^/]*$/, '');
  return `${window.location.origin}${dir}listen.html#${base64url(JSON.stringify(payload))}`;
}

function isLoopback() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** Kept so the file:// note can be restored after the loopback hint overwrites it. */
let fileNoteHtml = '';

function paintQr() {
  const box = el('qr-code');
  const note = el('qr-file-note');
  const altBtn = el('btn-qr-alt');
  const altWarn = el('qr-alt-warn');
  if (!box) return;
  // An empty white frame reads as a broken image, so the frame goes with the code.
  const frame = box.closest('.qr__frame');

  const card = state && state.card;
  const offline = window.location.protocol === 'file:';

  show(altBtn, offline);
  pressed(altBtn, view.qrAlt);
  show(altWarn, offline && view.qrAlt);

  // Nothing has been drawn yet. Hiding the whole block would be tidier, but it
  // also hides the single best feature of the game from anyone who has not
  // played before - they never learn they can listen on their own phone. So the
  // block stays, the frame goes (an empty white square reads as broken), and the
  // caption explains why the code is not here yet. Drawing eagerly instead is
  // not an option: it would close the buy-a-card window, which is only open
  // until the deck is touched.
  show(el('qr-block'), true);
  if (!card) {
    // Caption only: the block's own heading already says what the code is for,
    // and an extra "it will appear shortly" note just adds a boxed line that
    // lands on the scroll fold and gets sliced in half.
    box.textContent = '';
    show(frame, false);
    show(note, false);
    return;
  }

  if (offline && !view.qrAlt) {
    // A listen.html URL off the local disk is unreachable from any other phone,
    // so a code here would just be a dead end someone keeps scanning.
    box.textContent = '';
    show(frame, false);
    if (note) note.innerHTML = fileNoteHtml;
    show(note, true);
    return;
  }

  const target = offline
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${card.title || ''} ${card.artist || ''}`.trim(),
      )}`
    : listenUrl(card, state.turn);

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
    if (!offline && isLoopback()) {
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
  const pills = list.querySelectorAll('.token-pill');
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
    reasonNode.textContent = buyReason || `Costs ${BUY_COST} tokens`;
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
  // Before the draw nobody "can" challenge yet (there is no card), but the
  // button must still be live: tapping it is what draws.
  const others = state.players.filter((p) => p.id !== active.id);
  const anyCanChallenge =
    state.phase === 'turn-start'
      ? others.some((p) => tokensFor(state, p.id) >= 1)
      : others.some((p) => challengeBlockedReason(state, p.id) === null);
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

  const { verdict, message } = verdictFor(outcome);
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

function renderScoreboard() {
  const list = el('scoreboard-list');
  if (!list) return;
  const rows = scoreboard(state).map((row) => {
    const node = clone('tpl-scoreboard-row');
    if (!node) return null;
    node.dataset.playerId = row.playerId;
    // The row already says "Playing" in its own element, so the name stays the
    // name - a screen reader used to hear it twice.
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
    const mistakes = `${state.mistakes} of ${state.mistakeLimit} mistakes used`;
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
          ? `${state.mistakeLimit} mistakes reached on ${plural(cards, 'card')}.`
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
  text('win-player-name', title);
  text('win-summary', summary);
  announce(`${eyebrow}: ${title}. ${summary}`);
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
  if (id === 'menu-sheet') view.menuOpen = false;
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
  render();
}

function stepMistakes(delta) {
  view.setup.mistakeLimit = Math.min(
    MAX_MISTAKES,
    Math.max(MIN_MISTAKES, view.setup.mistakeLimit + delta),
  );
  render();
}

function toggleChip(kind, value) {
  const bucket = kind === 'decade' ? view.setup.decades : view.setup.genres;
  const index = bucket.indexOf(value);
  if (index >= 0) bucket.splice(index, 1);
  else bucket.push(value);
  render();
}

function chipsAll(target) {
  if (target === 'decade') {
    view.setup.decades =
      view.setup.decades.length === DECADES.length ? [] : DECADES.slice();
  } else {
    view.setup.genres = view.setup.genres.length === GENRES.length ? [] : GENRES.slice();
  }
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

function skipCard() {
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
}

function nextTurn() {
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
    resetCardAudio();
    restoreIdentifyVote();
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
    view.setup.players.push(playerDraft(view.setup.players.length));
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
  'toggle-decade': (node) => toggleChip('decade', Number(node.dataset.decade)),
  'toggle-genre': (node) => toggleChip('genre', node.dataset.genre),
  'chips-all': (node) => chipsAll(node.dataset.target),
  'start-game': () => startGame(),
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
  'end-game': () => endGame(),
  'toggle-audio': () => {
    toggleAudio().catch(() => failAudio('The preview could not be loaded.'));
  },
  'replay-audio': () => replayAudio(),
  'show-streaming-links': () => {
    view.audio.linksShown = !view.audio.linksShown;
    render();
  },
  'skip-card': () => skipCard(),
  'toggle-qr-alt': () => {
    view.qrAlt = !view.qrAlt;
    render();
  },
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
    if (view.confettiStop) {
      view.confettiStop();
      view.confettiStop = null;
    }
    showScreen('setup');
  },
};

function onClick(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  const node = target.closest('[data-action]');
  if (!node) return;
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') return;
  const handler = HANDLERS[node.dataset.action];
  if (!handler) return;
  event.preventDefault();
  alertUser('');
  handler(node);
}

function onInput(event) {
  const node = event.target;
  if (node.dataset && node.dataset.role === 'player-name') {
    const row = node.closest('[data-player-index]');
    if (!row) return;
    const draft = view.setup.players[Number(row.dataset.playerIndex)];
    if (!draft) return;
    draft.name = node.value;
    // The initial in the circle is the fallback avatar, so it has to keep up
    // with the name as it is typed.
    const avatar = row.querySelector('.player-row__avatar [data-field="initial"]');
    if (avatar) avatar.textContent = initialFor(node.value);
    // Two things follow from a name changing, and both are why the library is
    // keyed on the name rather than the seat: a face chosen before the name was
    // typed has to end up filed under the finished name, and a name we already
    // know should immediately offer its faces.
    if (draft.photo) rememberAvatar(draft.name, draft.photo);
    paintSavedAvatars(row, draft, Number(row.dataset.playerIndex));
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
    view.setup.mode = node.value;
    document.body.dataset.mode = node.value;
    render();
    return;
  }
  if (node.id === 'playback-source' || node.id === 'opt-playback-source') {
    updateSettings({ playbackSource: node.value });
    if (view.screen === 'play') render();
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

function onKeydown(event) {
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
  const note = el('qr-file-note');
  fileNoteHtml = note ? note.innerHTML : '';

  // Start fetching the baked previews immediately. By the time anyone reaches a
  // play button the map is in memory, which is what lets the tap handler look a
  // card up without awaiting - see the note at the top of toggleAudio().
  primeBaked();

  loadSavedSettings();
  applySettings();
  loadSavedPlayers();
  buildChips();

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);

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
