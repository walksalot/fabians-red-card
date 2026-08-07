// Persistence for the Timeline music game.
//
// Everything the game keeps between sessions goes through this module for two
// reasons. First, one namespace + version prefix owns all of our keys
// (`music-timeline:v1:*`), so bumping VERSION silently retires every old
// payload instead of feeding a half-understood shape back into the reducer.
// Second, storage is not something a browser guarantees: Safari private mode
// throws on the first setItem, some in-app webviews throw on plain access, and
// a full quota throws mid-game. A prediction pool losing a saved game is
// annoying; a game that crashes on turn six because localStorage said no is
// unforgivable, so every read and every write is wrapped and the module falls
// back to an in-memory map. Callers get null / false, never an exception.

/** Key namespace shared by every persisted value. */
export const NAMESPACE = 'music-timeline';

/** Payload version. Bump this whenever a saved shape changes incompatibly. */
export const VERSION = 1;

const PREFIX = `${NAMESPACE}:v${VERSION}:`;

/** The four things worth surviving a reload, as unprefixed key names. */
export const KEYS = Object.freeze({
  game: 'game',
  settings: 'settings',
  players: 'players',
  avatars: 'avatars',
  people: 'people',
});

/** How many faces to keep per name, and how many names to remember at all. */
const AVATARS_PER_NAME = 3;
const AVATAR_NAMES = 24;

/** How many past players to offer at setup. */
const PEOPLE_LIMIT = 24;

// audio.js owns this key and its eviction policy; storage.js only knows about
// it because it is the one payload we are happy to sacrifice to make room when
// a write hits the quota. It is a pure cache - dropping it costs a refetch.
const SACRIFICIAL_KEYS = [`${NAMESPACE}:preview:v1`];

/** Session-scoped stand-in used when the real localStorage is unusable. */
const memory = new Map();

/** @type {Storage|null|undefined} undefined = not probed yet, null = unusable. */
let backing;

/**
 * Resolve (once) whether this browser will actually let us store anything.
 * The probe writes and removes a key because merely reading `localStorage` can
 * succeed in private mode while every write throws.
 * @returns {Storage|null}
 */
function store() {
  if (backing !== undefined) return backing;
  backing = null;
  let candidate = null;
  try {
    candidate = globalThis.localStorage || null;
  } catch {
    // Reaching for the property is itself enough to throw in a sandboxed
    // iframe or with third-party storage blocked.
    return backing;
  }
  if (!candidate) return backing;
  const probe = `${PREFIX}__probe`;
  try {
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    backing = candidate;
    return backing;
  } catch (error) {
    // Anything other than a full quota (private mode, storage disabled by
    // policy) will never accept a write: go straight to memory.
    if (!isQuotaError(error)) return backing;
  }
  // Full, but maybe only because of our own preview cache. Free it and ask
  // again - that is the difference between "this browser said no" and "this
  // origin needs a tidy-up", and only the first should cost us persistence.
  freeSpace(candidate);
  try {
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    backing = candidate;
  } catch {
    // Genuinely unusable (old Safari private mode throws quota on every
    // write). Memory it is.
    backing = null;
  }
  return backing;
}

/** Drop the caches we are happy to rebuild. Never touches another app's keys. */
function freeSpace(ls) {
  for (const key of SACRIFICIAL_KEYS) {
    try {
      ls.removeItem(key);
    } catch {
      // Nothing else to try for this key.
    }
  }
}

/**
 * True when values will outlive the tab. The UI can use this to explain why
 * "Resume game" is missing rather than silently losing progress.
 * @returns {boolean}
 */
export function isPersistent() {
  return store() !== null;
}

/** @returns {boolean} whether a thrown storage error was a quota failure. */
function isQuotaError(error) {
  if (!error || typeof error !== 'object') return false;
  const name = /** @type {{name?:string, code?:number}} */ (error).name;
  const code = /** @type {{name?:string, code?:number}} */ (error).code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function readRaw(fullKey) {
  // Memory first, and only ever a fallback in appearance: a key is in this map
  // exactly when its most recent write could NOT be persisted (every successful
  // write deletes it again), so a value here is always newer than whatever
  // localStorage still holds. Reading localStorage first was a quiet trap - a
  // save that hit the quota mid-game left the previous, smaller save on disk,
  // and the game read that stale copy back for the rest of the session.
  if (memory.has(fullKey)) return memory.get(fullKey);
  const ls = store();
  if (ls) {
    try {
      const value = ls.getItem(fullKey);
      if (value !== null && value !== undefined) return value;
    } catch {
      // Unreadable storage and nothing stranded in memory: treat as absent.
    }
  }
  return null;
}

function writeRaw(fullKey, text) {
  const ls = store();
  if (!ls) {
    memory.set(fullKey, text);
    return true;
  }
  try {
    ls.setItem(fullKey, text);
    memory.delete(fullKey);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) return false;
    // Make room by dropping caches we can rebuild, then try exactly once more.
    freeSpace(ls);
    try {
      ls.setItem(fullKey, text);
      memory.delete(fullKey);
      return true;
    } catch {
      // Still full: keep it in memory so this session at least behaves, and
      // tell the caller the truth - this will not survive a reload.
      memory.set(fullKey, text);
      return false;
    }
  }
}

function removeRaw(fullKey) {
  memory.delete(fullKey);
  const ls = store();
  if (!ls) return true;
  try {
    ls.removeItem(fullKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap a value with its version + timestamp. The envelope is what lets a stale
 * payload be recognised and discarded instead of being handed to the game.
 */
function envelope(value) {
  return JSON.stringify({ v: VERSION, t: Date.now(), d: value });
}

/**
 * Unwrap an envelope. Anything unexpected - unparseable JSON, a payload from an
 * older VERSION, a hand-edited value - is treated as "not there".
 * @returns {unknown}
 */
function unwrap(text) {
  if (typeof text !== 'string' || text === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const box = /** @type {{v?:unknown, d?:unknown}} */ (parsed);
  if (box.v !== VERSION) return null;
  return box.d === undefined ? null : box.d;
}

/**
 * Read a namespaced value.
 * @param {string} key unprefixed key, e.g. 'settings'
 * @param {*} [fallback] returned when missing, corrupt or from an old version
 * @returns {*}
 */
export function get(key, fallback = null) {
  if (typeof key !== 'string' || key === '') return fallback;
  const value = unwrap(readRaw(PREFIX + key));
  return value === null ? fallback : value;
}

/**
 * Write a namespaced value.
 * @param {string} key unprefixed key
 * @param {*} value anything JSON-serialisable
 * @returns {boolean} false when the value could not be persisted
 */
export function set(key, value) {
  if (typeof key !== 'string' || key === '') return false;
  if (value === undefined) return removeRaw(PREFIX + key);
  let text;
  try {
    text = envelope(value);
  } catch {
    // Circular structure or a BigInt somewhere: refuse rather than throw.
    return false;
  }
  return writeRaw(PREFIX + key, text);
}

/**
 * Delete a namespaced value.
 * @param {string} key unprefixed key
 * @returns {boolean}
 */
export function remove(key) {
  if (typeof key !== 'string' || key === '') return false;
  return removeRaw(PREFIX + key);
}

/**
 * Drop every key this module owns (current version only). Used by a "reset
 * everything" affordance; it never touches keys outside our namespace.
 * @returns {boolean}
 */
export function clearAll() {
  for (const key of Object.values(KEYS)) removeRaw(PREFIX + key);
  const ls = store();
  if (!ls) {
    for (const key of [...memory.keys()]) {
      if (key.startsWith(PREFIX)) memory.delete(key);
    }
    return true;
  }
  try {
    const doomed = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && key.startsWith(PREFIX)) doomed.push(key);
    }
    for (const key of doomed) ls.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip the player photos out of anything holding a `players` array.
 *
 * Photos are far and away the biggest thing we store - a handful of base64
 * JPEGs dwarfs the entire rest of a save - and they are also the only part we
 * can lose without wrecking the evening. So when the quota says no, they are
 * what goes. Returns null when there was nothing to drop, which lets callers
 * skip a pointless second write.
 */
function stripPhotoList(players) {
  if (!Array.isArray(players)) return players;
  return players.map((p) => (p && typeof p === 'object' ? { ...p, photo: null } : p));
}

function hasPhoto(players) {
  return Array.isArray(players) && players.some((p) => p && typeof p === 'object' && p.photo);
}

function withoutPhotos(value) {
  if (!value || typeof value !== 'object') return null;
  // revealBase carries its own copy of the players: the engine replays every
  // confirmation from that snapshot. Missing it meant the "lean" save was barely
  // leaner (a second full set of photos rode along), and that a confirmation
  // after a resume copied the photos straight back over the stripped ones - so
  // the save we shed them from grew them again on the next write.
  const base = value.revealBase && typeof value.revealBase === 'object' ? value.revealBase : null;
  if (!hasPhoto(value.players) && !hasPhoto(base && base.players)) return null;
  const lean = { ...value, players: stripPhotoList(value.players) };
  if (base) lean.revealBase = { ...base, players: stripPhotoList(base.players) };
  return lean;
}

/**
 * Persist the in-progress game state (whatever engine.js hands us).
 * @param {object} state
 * @returns {boolean}
 */
export function saveGame(state) {
  if (!state || typeof state !== 'object') return false;
  if (set(KEYS.game, state)) return true;
  // Losing the avatars is survivable. Losing the game is not - so try again
  // without the faces before we accept a memory-only save.
  const lean = withoutPhotos(state);
  return lean ? set(KEYS.game, lean) : false;
}

/**
 * @returns {object|null} the saved game, or null if absent/corrupt/outdated
 */
export function loadGame() {
  const value = get(KEYS.game, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return /** @type {object} */ (value);
}

/** @returns {boolean} */
export function clearGame() {
  return remove(KEYS.game);
}

/**
 * Persist UI settings (sound, skip pass-the-phone, playback source, ...).
 * The caller owns the shape; we only guarantee it comes back or comes back null.
 * @param {object} settings
 * @returns {boolean}
 */
export function saveSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  return set(KEYS.settings, settings);
}

/** @returns {object|null} */
export function loadSettings() {
  const value = get(KEYS.settings, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return /** @type {object} */ (value);
}

/**
 * Remember the last setup's roster - names, and the photo taken for each one -
 * so a regular group does not re-shoot the whole family every week.
 *
 * The photos live here and in the saved game and nowhere else. They are never
 * uploaded, never sent anywhere and never go in the QR payload; this is a
 * private, on-device record of who was playing. If the quota bites, the names
 * are written on their own rather than losing the roster entirely.
 * @param {Array<*>} players
 * @returns {boolean}
 */
export function savePlayers(players) {
  if (!Array.isArray(players)) return false;
  if (set(KEYS.players, players)) return true;
  const lean = withoutPhotos({ players });
  return lean ? set(KEYS.players, lean.players) : false;
}

/** @returns {Array<*>|null} */
export function loadPlayers() {
  const value = get(KEYS.players, null);
  return Array.isArray(value) ? value : null;
}

/* ---------------------------------------------------------------------------
 * The avatar library
 * ------------------------------------------------------------------------ */

/**
 * Faces remembered by NAME, which is the only thing about a player that stays
 * put. The roster above records the last line-up, so it loses somebody's photo
 * the moment they are renamed, reordered or dropped for one game - and then
 * that person has to go and find a picture of themselves again. Keyed by name,
 * a returning Paula is offered the Paulas we already have.
 *
 * Shape: { "paula": ["data:image/jpeg;base64,...", ...] }, newest first.
 * Private and on-device, exactly like every other photo in this app.
 */
const foldName = (name) => String(name == null ? '' : name).trim().toLowerCase();

/** @returns {Record<string, string[]>} */
export function loadAvatars() {
  const value = get(KEYS.avatars, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [name, photos] of Object.entries(value)) {
    if (!Array.isArray(photos)) continue;
    const clean = photos.filter((p) => typeof p === 'string' && p.startsWith('data:image/'));
    if (clean.length) out[name] = clean.slice(0, AVATARS_PER_NAME);
  }
  return out;
}

/**
 * File one face under one name. Newest first, de-duplicated, and bounded on both
 * axes so a group that plays every week cannot slowly fill the origin's quota.
 * @param {string} name
 * @param {string} photo a data: URL
 * @returns {boolean}
 */
export function rememberAvatar(name, photo) {
  const key = foldName(name);
  if (!key || typeof photo !== 'string' || !photo.startsWith('data:image/')) return false;

  const library = loadAvatars();
  const existing = (library[key] || []).filter((p) => p !== photo);
  library[key] = [photo, ...existing].slice(0, AVATARS_PER_NAME);

  // Oldest names go first when there are too many. Object key order is
  // insertion order, and re-filing a name does not move it, so the ordering is
  // "first seen" rather than "last used" - close enough for a party game, and
  // it never evicts the name somebody just typed.
  let names = Object.keys(library);
  while (names.length > AVATAR_NAMES) {
    delete library[names[0]];
    names = Object.keys(library);
  }

  if (set(KEYS.avatars, library)) return true;
  // Out of room: keep only the newest face per name and try once more. The
  // library is a convenience, so it yields before anything else does.
  const thin = {};
  for (const [n, photos] of Object.entries(library)) thin[n] = photos.slice(0, 1);
  return set(KEYS.avatars, thin);
}

/**
 * Faces we already hold for this name, newest first.
 * @param {string} name
 * @returns {string[]}
 */
export function avatarsFor(name) {
  const key = foldName(name);
  if (!key) return [];
  const photos = loadAvatars()[key];
  return Array.isArray(photos) ? photos : [];
}

/** Forget every saved face (offered in Settings alongside the other resets). */
export function clearAvatars() {
  return remove(KEYS.avatars);
}

/* ---------------------------------------------------------------------------
 * Everybody who has ever played
 * ------------------------------------------------------------------------ */

/**
 * The people, as opposed to the line-up.
 *
 * `players` above is one game's seating; this is the guest list, so setting up
 * next week is tapping four faces instead of typing four names and hunting for
 * four photos. Most recently played first, since that is the group most likely
 * to be in the room.
 *
 * Shape: [{ name, photo|null, skipped }]. Private and on-device like every
 * other photo here.
 * @returns {Array<{name: string, photo: string|null, skipped: boolean}>}
 */
export function loadPeople() {
  const value = get(KEYS.people, null);
  if (!Array.isArray(value)) return [];
  return value
    .filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      photo: typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? p.photo : null,
      skipped: !!p.skipped,
    }))
    .slice(0, PEOPLE_LIMIT);
}

/**
 * File one player on the guest list, or move them to the front if they are
 * already on it. Matching is on the folded name, so "paula" and "Paula" are one
 * person - but the casing they last typed is what gets shown back to them.
 * @param {{name: string, photo?: string|null, skipped?: boolean}} person
 * @returns {boolean}
 */
export function rememberPerson(person) {
  const name = person && typeof person.name === 'string' ? person.name.trim() : '';
  if (!name) return false;
  // "Player 3" is the placeholder this app puts in an empty row, not somebody's
  // name. Remembering it would clutter the list with people who do not exist.
  if (/^player\s*\d+$/i.test(name)) return false;

  const key = foldName(name);
  const rest = loadPeople().filter((p) => foldName(p.name) !== key);
  const entry = {
    name,
    photo: typeof person.photo === 'string' && person.photo.startsWith('data:image/')
      ? person.photo
      : null,
    skipped: !!person.skipped,
  };
  const next = [entry, ...rest].slice(0, PEOPLE_LIMIT);

  if (set(KEYS.people, next)) return true;
  // Out of room: the names are the expensive-to-retype part, the faces are the
  // big part. Keep the list, drop the pictures - avatarsFor() can still put a
  // face back once the name is on a row.
  return set(KEYS.people, next.map((p) => ({ ...p, photo: null })));
}

/**
 * Take one person off the list - a typo, or somebody who is not playing again.
 * @param {string} name
 * @returns {boolean}
 */
export function forgetPerson(name) {
  const key = foldName(name);
  if (!key) return false;
  const next = loadPeople().filter((p) => foldName(p.name) !== key);
  const library = loadAvatars();
  if (library[key]) {
    delete library[key];
    set(KEYS.avatars, library);
  }
  return set(KEYS.people, next);
}
