/**
 * buyin.js - pot arithmetic and the Venmo hand-off for the Timeline music game.
 *
 * The use case is a family reunion: everyone chips in $2, one phone is passed
 * around the room, and whoever wins gets the pot over Venmo afterwards.
 *
 * WHY A LINK AND NOT A PAYMENT INTEGRATION
 * Nobody is typing a card number into a party game, and this app has no server
 * at all - it is static files in public/ with localStorage behind it. Holding
 * money would mean a merchant account, a backend, PCI scope, refunds and a
 * dispute process, for a $16 pot among cousins. So this module never touches
 * money. It does arithmetic, and it builds a link that opens Venmo with the
 * fields already filled in. The humans confirm the payment in Venmo, where the
 * money and the liability already live. Nothing here can move a cent, which is
 * exactly the property we want.
 *
 * THE ONE INTERNAL REPRESENTATION: INTEGER CENTS
 * Every `amount` in and out of this module is an integer number of cents.
 * $2 is 200, never 2. The reason is that binary floating point cannot hold
 * most decimal fractions: 0.1 + 0.2 === 0.30000000000000004, and 2.1 * 3 is
 * 6.300000000000001, so a pot built out of dollars-as-floats eventually
 * renders as "$5.999999999999999" in front of the family. Integers have no
 * such failure mode: 210 * 3 is exactly 630, and the decimal point is only
 * ever inserted at the moment of display. Floats enter through exactly one
 * door, `dollarsToCents`, which rounds the drift away once, at the boundary,
 * where a human typed the number. `formatMoney` therefore takes CENTS -
 * passing it 6 gets you "$0.06", which is the trade we are making on purpose.
 *
 * THE VENMO URL SHAPE (confirmed 2026-08-07)
 * Pay link:  https://venmo.com/<handle>?txn=pay&amount=<dollars>&note=<text>
 *  - `txn` is "pay" or "charge"; "pay" pre-fills paying that handle.
 *  - `amount` is a decimal dollar value with no "$" (e.g. 8.00).
 *  - `note` is the memo and must be URL-escaped.
 * Confirmed against Venmo's long-standing web link format as documented at
 * https://splittyapp.com/learn/share-venmo-payment-link/ ("venmo.com/
 * YourUsername?txn=pay&amount=42.50&note=Dinner+split") and
 * https://goleary.com/posts/2020-07-29-venmo-deeplinking-including-from-web-apps
 * ("https://venmo.com/<USER_NAME>?txn=<charge|pay>&note=<NOTE>&amount=<AMOUNT>").
 * The in-app deeplink is a different scheme entirely
 * (venmo://paycharge?txn=pay&recipients=...), per
 * https://blog.alexbeals.com/posts/venmo-deeplinking - we deliberately emit the
 * https form, because it works from a browser on a phone with the app
 * installed AND on one without it, and it is safe to paste into a group chat.
 * Handle rules (5-30 characters, letters/numbers/"-"/"_" only, not case
 * sensitive) come from Venmo's own help page:
 * https://help.venmo.com/cs/articles/check-or-edit-your-username-vhel208
 *
 * Dependency-free ES module: it is loaded straight into the browser from
 * public/, outside the Next bundle, so it imports nothing and touches no DOM.
 */

/** Most players one shared phone will ever be passed around. */
export const MAX_PLAYERS = 100;

/** Sanity ceiling on a buy-in: $1000 a head. Above this, assume a typo. */
export const MAX_PER_PLAYER_CENTS = 100000;

/** Ceiling on any single amount we will put in a link ($100,000). */
export const MAX_CENTS = MAX_PER_PLAYER_CENTS * MAX_PLAYERS;

/** Venmo's documented memo limit. */
export const MAX_NOTE_CHARS = 2000;

/** Venmo's documented username maximum. */
const MAX_HANDLE_CHARS = 30;

/**
 * Longest raw string we will even try to read a handle out of.
 * This bounds the work only: the 30-character handle ceiling below already
 * rejects everything this would, so no test can tell the two apart (it is an
 * equivalent mutant by design). It is here so that pasting a megabyte of text
 * into the handle field does not run the scheme/path regexes over all of it.
 */
const MAX_INPUT_CHARS = 200;

/**
 * Venmo allows letters, digits, "-" and "_".
 * We do NOT enforce Venmo's 5-character minimum: it applies to new signups,
 * and refusing a real person's older, shorter handle is worse than emitting a
 * link Venmo will simply fail to resolve.
 */
const HANDLE_RE = /^[A-Za-z0-9_-]+$/;

/** Hosts we will accept a pasted profile URL from. */
const VENMO_HOSTS = new Set([
  'venmo.com',
  'www.venmo.com',
  'account.venmo.com',
  'www.account.venmo.com',
  'm.venmo.com',
]);

/**
 * Single path segments that are Venmo's own routes, never a profile. The one
 * that bites in the wild is venmo.com/code?user_id=... - the URL Venmo's own
 * share-my-QR flow puts on the clipboard - which read as the handle "@code"
 * and pointed the whole table's payments at a reserved endpoint. These are
 * rejected outright rather than resolved: the query string's user_id is not a
 * handle, and guessing would mint a confident wrong payee.
 */
const RESERVED_PATHS = new Set([
  'code',
  'u',
  'signup',
  'account',
  'pay',
  'business',
  'legal',
  'settings',
]);

/**
 * Render cents as a bare decimal dollar string ("630" -> "6.30").
 * This is the form Venmo's `amount` parameter wants: no currency symbol, no
 * thousands separators.
 * @param {number} cents integer
 * @returns {string}
 */
function decimalString(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Format an integer number of CENTS as money.
 *
 * Cents, not dollars - see the header. `formatMoney(600)` is "$6.00" and
 * `formatMoney(6)` is "$0.06". Anything that is not an integer (a float, a
 * string, NaN, Infinity) returns null rather than rendering a lie: a
 * non-integer here means a caller did dollar arithmetic somewhere upstream,
 * which is the exact defect this module exists to prevent.
 *
 * @param {*} cents integer number of cents; may be negative
 * @param {{compact?: boolean}} [options] compact drops a trailing ".00", so a
 *   whole-dollar pot reads "$8" instead of "$8.00"
 * @returns {string|null}
 */
export function formatMoney(cents, options) {
  // Number.isInteger is false for strings, NaN, Infinity and 6.5 alike.
  if (!Number.isInteger(cents)) return null;
  const value = /** @type {number} */ (cents);
  const compact = Boolean(options && options.compact);
  const negative = value < 0;
  const abs = Math.abs(value);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body =
    compact && remainder === 0
      ? `$${grouped}`
      : `$${grouped}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Convert what a human typed into integer cents. The only place a decimal is
 * allowed to become money.
 *
 * Strings are parsed as integers on both sides of the point and never go near
 * a float, so "2.50" is exactly 250. A string carrying more than two decimal
 * places ("2.005") is rejected: a person typing money does not mean that, and
 * silently rounding their input would be a guess.
 *
 * Numbers are rounded to the nearest cent, because a number reaching us is
 * usually the output of arithmetic elsewhere and carries binary drift:
 * `dollarsToCents(0.1 + 0.2)` is 30, not 30.000000000000004.
 *
 * @param {*} input a number of dollars, or a string like "2", "2.50", "$2.50"
 * @returns {number|null} integer cents, or null if it is not a money value
 */
export function dollarsToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const scaled = Math.round(input * 100);
    return Math.abs(scaled) > MAX_CENTS ? null : scaled;
  }
  if (typeof input !== 'string') return null;
  if (input.length > MAX_INPUT_CHARS) return null;
  const cleaned = input.trim().replace(/,/g, '');
  // Sign, then an optional "$", then digits: "$2.50", "-$2" and ".50" all
  // read, while "2$50" and "2.005" do not.
  const match = /^(-?)\s*\$?\s*(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  // Require at least one digit somewhere: "", "-", "." and "$" are not money.
  if (!match || (!match[2] && match[3] === undefined)) return null;
  const whole = Number(match[2] || '0');
  const fraction = Number((match[3] || '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  if (cents > MAX_CENTS) return null;
  return match[1] === '-' ? -cents : cents;
}

/**
 * Work out the pot, and everything the UI needs to describe it.
 *
 * @param {*} input `{ amount, playerCount }` where `amount` is the per-player
 *   buy-in in integer CENTS (200 for $2) and `playerCount` is a whole number
 *   of people. A zero buy-in is legal - some rounds are just for pride.
 * @returns {{
 *   playerCount: number,
 *   perPlayerCents: number,
 *   totalCents: number,
 *   perPlayer: string,
 *   total: string,
 *   label: string,
 * }|null} null if the buy-in is negative, is not whole cents, or the player
 *   count is not a sane whole number - the caller shows no pot rather than a
 *   wrong one.
 */
export function potFor(input) {
  const source = input || {};
  const amount = source.amount;
  const playerCount = source.playerCount;
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_PER_PLAYER_CENTS) return null;
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) return null;
  const perPlayerCents = /** @type {number} */ (amount);
  const players = /** @type {number} */ (playerCount);
  // Integer multiplication: 210 * 3 is 630, full stop. The float version of
  // this line (2.10 * 3) is 6.300000000000001.
  const totalCents = perPlayerCents * players;
  const total = /** @type {string} */ (formatMoney(totalCents, { compact: true }));
  return {
    playerCount: players,
    perPlayerCents,
    totalCents,
    perPlayer: /** @type {string} */ (formatMoney(perPlayerCents, { compact: true })),
    total,
    label: `Pot: ${total} with ${players} ${players === 1 ? 'player' : 'players'}`,
  };
}

/**
 * Reduce whatever someone typed or pasted to a bare Venmo handle.
 *
 * Accepts "paula", "@paula", " Paula ", "venmo.com/u/paula" and full profile
 * URLs with a query string or fragment. Case is preserved, because Venmo
 * handles are not case sensitive and mangling what a person typed buys us
 * nothing. Returns null - never a guess - for anything that cannot be a
 * handle: empty input, spaces inside, illegal characters, an over-long value,
 * or a URL on a host that is not Venmo.
 *
 * @param {*} input
 * @returns {string|null}
 */
export function normaliseHandle(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || value.length > MAX_INPUT_CHARS) return null;

  // A slash means we were handed a URL (or something pretending to be one).
  // Anything with a path has to prove it is a Venmo profile before we will
  // read a handle out of it.
  if (value.includes('/')) {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
    if (scheme) {
      if (!/^https?$/i.test(scheme[1])) return null;
      value = value.slice(scheme[0].length);
    }
    const slash = value.indexOf('/');
    if (slash === -1) return null;
    const host = value.slice(0, slash).toLowerCase();
    if (!VENMO_HOSTS.has(host)) return null;
    let path = value.slice(slash + 1);
    const cut = path.search(/[?#]/);
    if (cut !== -1) path = path.slice(0, cut);
    const parts = path.split('/').filter((part) => part.length > 0);
    // Both shapes are in the wild: venmo.com/paula and the newer
    // venmo.com/u/paula. Anything deeper is some other page, not a profile,
    // and a lone segment naming one of Venmo's own routes is a route.
    if (parts.length === 1) {
      if (RESERVED_PATHS.has(parts[0].toLowerCase())) return null;
      value = parts[0];
    } else if (parts.length === 2 && parts[0].toLowerCase() === 'u') value = parts[1];
    else return null;
  }

  if (value.startsWith('@')) value = value.slice(1);
  if (!value || value.length > MAX_HANDLE_CHARS) return null;
  if (!HANDLE_RE.test(value)) return null;
  return value;
}

/**
 * Build an https link that opens Venmo pre-filled to PAY a handle.
 *
 * @param {*} input `{ handle, amount, note }` - `handle` in any of the shapes
 *   `normaliseHandle` accepts, `amount` in integer CENTS, `note` an optional
 *   memo (trimmed, and clipped to Venmo's 2000-character limit; a blank or
 *   non-string note is simply left off the link).
 * @returns {string|null} null if the handle cannot be a handle or the amount
 *   is not a positive whole number of cents. A broken link in a group chat is
 *   worse than no link, and a $0 payment is not a thing to ask anyone for.
 */
export function venmoPayUrl(input) {
  const source = input || {};
  const handle = normaliseHandle(source.handle);
  if (!handle) return null;
  const amount = source.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) return null;

  // Every value is percent-encoded, including the handle - it is already
  // restricted to URL-safe characters, so this is belt and braces, but it
  // means no input shape can ever inject a parameter.
  const params = ['txn=pay', `amount=${encodeURIComponent(decimalString(amount))}`];
  const note = source.note;
  if (typeof note === 'string') {
    const trimmed = note.trim().slice(0, MAX_NOTE_CHARS);
    if (trimmed) params.push(`note=${encodeURIComponent(trimmed)}`);
  }
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.join('&')}`;
}
