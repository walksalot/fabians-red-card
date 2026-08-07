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

/** The three things worth surviving a reload, as unprefixed key names. */
export const KEYS = Object.freeze({
  game: 'game',
  settings: 'settings',
  players: 'players',
});

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
  try {
    const candidate = globalThis.localStorage;
    if (candidate) {
      const probe = `${PREFIX}__probe`;
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      backing = candidate;
    }
  } catch {
    // Private mode / disabled storage / sandboxed iframe: stay on memory.
    backing = null;
  }
  return backing;
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
  const ls = store();
  if (!ls) return memory.has(fullKey) ? memory.get(fullKey) : null;
  try {
    return ls.getItem(fullKey);
  } catch {
    return null;
  }
}

function writeRaw(fullKey, text) {
  const ls = store();
  if (!ls) {
    memory.set(fullKey, text);
    return true;
  }
  try {
    ls.setItem(fullKey, text);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) return false;
    // Make room by dropping caches we can rebuild, then try exactly once more.
    for (const key of SACRIFICIAL_KEYS) {
      try {
        ls.removeItem(key);
      } catch {
        // Nothing else to try for this key.
      }
    }
    try {
      ls.setItem(fullKey, text);
      return true;
    } catch {
      // Still full: keep it in memory so this session at least behaves.
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
 * Persist the in-progress game state (whatever engine.js hands us).
 * @param {object} state
 * @returns {boolean}
 */
export function saveGame(state) {
  if (!state || typeof state !== 'object') return false;
  return set(KEYS.game, state);
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
 * Remember the player names from the last setup so the next game starts with
 * the same family instead of "Player 1..4" every time.
 * @param {Array<*>} players
 * @returns {boolean}
 */
export function savePlayers(players) {
  if (!Array.isArray(players)) return false;
  return set(KEYS.players, players);
}

/** @returns {Array<*>|null} */
export function loadPlayers() {
  const value = get(KEYS.players, null);
  return Array.isArray(value) ? value : null;
}
