/**
 * Pure rules engine for the phone-based "Timeline" music game.
 *
 * This is the only file that knows how the game works. `ui.js` owns pixels and
 * nothing else — it dispatches actions and re-renders whatever comes back — so a
 * rules bug can never hide inside an event handler. Everything here is therefore
 * deterministic and side-effect free: no DOM, no storage, no `Date.now()`, no
 * `Math.random()`. Shuffles run off a seeded PRNG whose cursor lives *in* the
 * state, which is what makes a game reproducible from its seed alone and lets the
 * whole thing round-trip through `localStorage` as plain JSON.
 *
 * `reduce(state, action)` is pure: it never mutates its input and always returns a
 * new object. Illegal actions are rejected (they come back as `state.lastError`)
 * rather than half-applied, because a phone game gets double-tapped constantly and
 * a corrupt timeline is unrecoverable mid-party.
 *
 * ---------------------------------------------------------------------------
 * The rules, stated once so the code below can stay terse
 * ---------------------------------------------------------------------------
 * Identity   Every player carries a `photo` (a data URL, or null when they chose
 *            the generated fallback) and a `color` taken from SEAT_COLORS by
 *            seat index. Neither is a rule - they are here so the UI can read a
 *            player's face and accent straight off the state it already has,
 *            instead of maintaining a second map that can drift out of sync with
 *            a save file. The engine never looks at either.
 * Setup      Every player starts with one random card in their timeline and
 *            `startingTokens` (2) tokens. In co-op there is ONE shared timeline
 *            with one starting card and ONE shared token pool of `startingTokens`
 *            (the cap is a pool-sized number, so the pool is not multiplied by
 *            the head count - it is one bigger instead: 5 normally, 6 in co-op,
 *            see `defaultTokenCap`).
 * Placement  A timeline is year-sorted. Gap `i` (0..len) is correct for `year`
 *            iff (i === 0 or year >= timeline[i-1].year) AND
 *                (i === len or year <= timeline[i].year).
 *            Equal years are ALWAYS acceptable on either side — a tie is never
 *            punished. Accepted cards are inserted at the chosen gap, which keeps
 *            the timeline sorted and lets ties keep their insertion order.
 * Challenge  Before the reveal any OTHER player may spend 1 token to nominate a
 *            gap in their OWN timeline (the shared one in co-op). The token is
 *            gone the moment they challenge; retracting before the reveal refunds
 *            it. One challenge per player. Challenges only pay out when the active
 *            player's PLACEMENT was wrong; if it was right, every challenger
 *            simply loses the token. Among correct challengers the earliest in
 *            clockwise seat order starting from the seat left of the active player
 *            wins the card; the rest just lose their token.
 * Identify   The active player may claim they can name title AND artist. If the
 *            group confirms it: +1 token (capped), awarded whatever the placement
 *            did.
 * Streak     An optional house rule (`streakBonus`, off unless the setup screen
 *            turns it on). Every player carries a `streakRun`; keeping three
 *            cards in a row pays +1 token (capped) and puts the run back to 0.
 *            See "The streak, precisely" below - it is the one rule here with
 *            enough edges to be worth spelling out twice.
 * Buy        3 tokens, only at the start of a turn: the top card is inserted at a
 *            correct position automatically and the turn ends.
 * Modes      classic  placement only.
 *            advanced placement only counts if title AND artist were also named.
 *            expert   advanced plus an exact year guess.
 *            co-op    one shared timeline and token pool, `mistakeLimit` mistakes
 *                     loses the game, reaching the target wins it for everyone.
 *                     A mistake is a card the group failed to keep — a challenger
 *                     who rescues the card prevents it. Seat rotation is unchanged.
 * Ending     Reaching `targetCards` wins immediately. If the deck runs out the
 *            longest timeline wins, ties broken by tokens, and a still-tied field
 *            is a shared win. Co-op has no consolation win: an exhausted deck
 *            short of the target is simply not a win.
 * Records    Three running counts exist only so the scoreboard and the winner
 *            screen can say something true about the game that was just played:
 *            `missCounts` (wrong guesses per card id), `challengeWins` (cards
 *            stolen per player id) and `skips` (a plain total). They are
 *            counters, never inputs - no rule above reads one, so no record can
 *            change who wins.
 *
 * ---------------------------------------------------------------------------
 * The streak, precisely
 * ---------------------------------------------------------------------------
 * A house rule with four edges, all of which come up at a real table, so each one
 * is decided here rather than in whichever screen asks first.
 *
 *  - It counts KEPT CARDS, not correct gaps. In classic and co-op those are the
 *    same thing; in advanced and expert a right gap with a fluffed artist loses
 *    the card, and a green streak note under a red verdict pill would be the
 *    game contradicting itself out loud. The run follows the verdict the table
 *    can see.
 *  - A wrong placement ends the run. So does a bought card: buying is a way of
 *    not guessing, and "three RIGHT in a row" cannot be threaded through a turn
 *    nobody got right. It costs 3 tokens precisely so it is a trade.
 *  - A skipped card leaves the run alone - it neither advances nor breaks it.
 *    A skip un-plays the card (the challenge tokens are refunded, the card is
 *    never placed), and the engine already treats it as a turn that did not
 *    happen; the run follows that.
 *  - Paying out puts the run back to 0, so it pays on the 3rd, 6th, 9th... card.
 *    The alternative - keep counting, pay on every multiple - reads the same at
 *    the table but leaves the UI a number it has to take modulo before it can
 *    draw three dots. Resetting means `streakRun` always means exactly "how far
 *    into the next bonus you are". Earning the token while already at the cap
 *    still spends the run: the bonus was earned and paid, and a run that could
 *    be banked against a full pocket would be a different rule from the one on
 *    the setup screen. (Identify already works this way; see `identifyDelta`.)
 *
 * Only the active player's run moves. A challenger who steals a card did not
 * place one on their own turn, and the run is per player even in co-op, where
 * the token it pays lands in the shared pool like every other co-op token.
 */

/** Turn phases, in the order a normal turn walks through them. */
export const PHASES = Object.freeze([
  'turn-start',
  'listening',
  'placing',
  'revealed',
  'turn-end',
  'game-over',
]);

/** @type {readonly string[]} */
export const MODES = Object.freeze(['classic', 'advanced', 'expert', 'coop']);

/** Every action `reduce` understands. Exported so the UI cannot typo one. */
export const ACTIONS = Object.freeze({
  DRAW: 'DRAW',
  SELECT_GAP: 'SELECT_GAP',
  COMMIT_PLACEMENT: 'COMMIT_PLACEMENT',
  ADD_CHALLENGE: 'ADD_CHALLENGE',
  REMOVE_CHALLENGE: 'REMOVE_CHALLENGE',
  SET_CLAIM_IDENTIFY: 'SET_CLAIM_IDENTIFY',
  SET_YEAR_GUESS: 'SET_YEAR_GUESS',
  BUY_CARD: 'BUY_CARD',
  REVEAL: 'REVEAL',
  CONFIRM_IDENTIFY: 'CONFIRM_IDENTIFY',
  CONFIRM_TITLE_ARTIST: 'CONFIRM_TITLE_ARTIST',
  NEXT_TURN: 'NEXT_TURN',
  SKIP_CARD: 'SKIP_CARD',
  END_GAME: 'END_GAME',
});

/** Cost of `BUY_CARD`, in tokens. */
export const BUY_COST = 3;

/** How many tokens a hand may hold at once. */
export const TOKEN_CAP = 5;

/**
 * Co-op's cap. One bigger, deliberately: the co-op pool is shared by the whole
 * table, so every player who wants to challenge is drawing on the same five,
 * and a sixth is what stops "everybody hold still, we are saving for a buy"
 * from being the only sane co-op strategy.
 */
export const COOP_TOKEN_CAP = 6;

/**
 * The cap a mode plays with unless `createGame` is told otherwise. Exported so
 * the setup screen can draw the right number of token dots before a game exists.
 * @param {string} mode
 * @returns {number}
 */
export function defaultTokenCap(mode) {
  return mode === 'coop' ? COOP_TOKEN_CAP : TOKEN_CAP;
}

/** Cards kept in a row that earn the streak bonus, and what it pays. */
export const STREAK_LENGTH = 3;
export const STREAK_REWARD = 1;

/**
 * The eight decade buckets the strength histogram is drawn from.
 *
 * Named `DECADE_STARTS` rather than the obvious `DECADES` because `deck.js`
 * already exports a `DECADES` for the setup filter chips and the UI imports
 * both modules into one scope; a clash there is a rename in a file this module
 * does not own.
 * @type {readonly number[]}
 */
export const DECADE_STARTS = Object.freeze([
  1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
]);

/**
 * Cards a player needs before "strongest decade" means anything.
 *
 * Everybody is dealt one card, and a lone 1984 would otherwise make every player
 * an eighties specialist before the first turn is over.
 */
export const DECADE_MIN_CARDS = 3;

/** Bumped whenever the state shape changes so stale saves are rejected loudly. */
export const STATE_VERSION = 1;

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 8;

/* -------------------------------------------------------------------------- */
/* Seat colours                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One accent per seat, hand-picked rather than generated.
 *
 * Why hand-picked: a hashed hue lands on mud, on the token gold, or on the
 * verdict red often enough to matter, and "whose turn is it" is the one question
 * this app has to answer at a glance across a dim room. These eight are spread
 * around the wheel, every one of them clears 7:1 against the near-black
 * background, and none of them is the token gold (#ffc247), the correct green
 * (#3ce6a0) or the wrong red (#ff5a76) - those three keep meaning what they
 * mean. Neighbouring seats are deliberately far apart in hue, because the people
 * most likely to be compared are the ones sitting next to each other.
 * @type {readonly string[]}
 */
export const SEAT_COLORS = Object.freeze([
  '#a97cff', // violet
  '#45e0a8', // jade
  '#ff6bb5', // pink
  '#4fc3ff', // sky
  '#ffb03a', // amber
  '#c6ee5a', // lime
  '#ff7a5c', // coral
  '#8b9bff', // periwinkle
]);

/**
 * The accent for a seat. Wraps, so it is total for any index.
 * @param {number} index seat index, 0-based
 * @returns {string} a hex colour
 */
export function seatColor(index) {
  const seat = Number.isInteger(index) && index >= 0 ? index : 0;
  return SEAT_COLORS[seat % SEAT_COLORS.length];
}

/* -------------------------------------------------------------------------- */
/* Seeded randomness                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One mulberry32 step. Kept in this "value + next cursor" shape rather than as a
 * closure so the cursor can live in the serialisable game state.
 * @param {number} cursor
 * @returns {{ value: number, cursor: number }}
 */
function randomStep(cursor) {
  const next = (cursor + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, cursor: next };
}

/**
 * Classic closure-style mulberry32, for callers that just want numbers.
 * @param {number} seed
 * @returns {() => number} successive floats in [0, 1)
 */
export function mulberry32(seed) {
  let cursor = seed >>> 0;
  return function next() {
    const step = randomStep(cursor);
    cursor = step.cursor;
    return step.value;
  };
}

/**
 * Fisher-Yates over a *copy* of `items`, driven by the seeded cursor.
 * @template T
 * @param {readonly T[]} items
 * @param {number} cursor
 * @returns {{ items: T[], cursor: number }}
 */
export function shuffle(items, cursor) {
  const out = items.slice();
  let c = cursor >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const step = randomStep(c);
    c = step.cursor;
    const j = Math.floor(step.value * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return { items: out, cursor: c };
}

/* -------------------------------------------------------------------------- */
/* Small pure helpers                                                          */
/* -------------------------------------------------------------------------- */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function insertAt(list, index, item) {
  return list.slice(0, index).concat([item], list.slice(index));
}

function isPlainYear(year) {
  return typeof year === 'number' && Number.isFinite(year);
}

/** A tally is a plain `{ key: count }` object, so it survives JSON untouched. */
function isTally(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tallyOf(tally, key) {
  if (!isTally(tally) || typeof key !== 'string') return 0;
  const n = Object.prototype.hasOwnProperty.call(tally, key) ? tally[key] : 0;
  return Number.isFinite(n) ? n : 0;
}

/** `tally` with `key` raised by `by`. Returns the original when there is nothing to add. */
function addTally(tally, key, by) {
  if (!by || typeof key !== 'string') return tally;
  return { ...tally, [key]: tallyOf(tally, key) + by };
}

/**
 * The highest-counted key, or null when nothing was ever counted.
 *
 * `key` is the FIRST key to reach that count - object key order is insertion
 * order and JSON preserves it, so "first" means "earliest in the game" on a
 * restored save too. `tied` says whether anything else matched it, which is the
 * whole reason this returns a shape instead of a string: naming one of two
 * equal players is a slur, naming one of two equally hard songs is a headline.
 * @param {Record<string, number>} tally
 * @returns {{key:string, count:number, tied:boolean}|null}
 */
function topOfTally(tally) {
  if (!isTally(tally)) return null;
  let best = null;
  let bestCount = 0;
  let tied = false;
  for (const key of Object.keys(tally)) {
    const count = tallyOf(tally, key);
    if (count > bestCount) {
      best = key;
      bestCount = count;
      tied = false;
    } else if (count === bestCount && count > 0) {
      tied = true;
    }
  }
  return bestCount === 0 ? null : { key: best, count: bestCount, tied };
}

/** Fresh per-turn scratch fields. A function, not a constant, so no two states share arrays. */
function turnReset() {
  return {
    card: null,
    selectedGap: null,
    placementCommitted: false,
    committedGap: null,
    claimIdentify: false,
    yearGuess: null,
    challenges: [],
    confirmations: { identify: null, title: null, artist: null },
    revealBase: null,
    outcome: null,
  };
}

/** Successful transition: merge a patch and clear any stale rejection notice. */
function ok(state, patch) {
  return { ...state, ...patch, lastError: null };
}

/** Rejected transition: state is untouched apart from an explanation the UI can surface. */
function reject(state, action, reason) {
  const type = action && typeof action.type === 'string' ? action.type : null;
  return { ...state, lastError: { action: type, reason } };
}

/* -------------------------------------------------------------------------- */
/* Reading and writing the two possible "holders" (per-player vs shared)        */
/* -------------------------------------------------------------------------- */
/* A holder is anything with `players`, `sharedTimeline` and `sharedTokens` —   */
/* the live state during a turn, or the pre-reveal snapshot we recompute from.  */

function findPlayer(holder, playerId) {
  return holder.players.find((p) => p.id === playerId) || null;
}

function readTimeline(mode, holder, playerId) {
  if (mode === 'coop') return holder.sharedTimeline;
  const player = findPlayer(holder, playerId);
  return player ? player.timeline : [];
}

function readTokens(mode, holder, playerId) {
  if (mode === 'coop') return holder.sharedTokens;
  const player = findPlayer(holder, playerId);
  return player ? player.tokens : 0;
}

function writeTimeline(mode, holder, playerId, timeline) {
  if (mode === 'coop') return { ...holder, sharedTimeline: timeline };
  return {
    ...holder,
    players: holder.players.map((p) => (p.id === playerId ? { ...p, timeline } : p)),
  };
}

/**
 * The streak run is the one number that is ALWAYS personal - co-op shares the
 * pile and the pool, but "three in a row" is something a person does, so these
 * two never consult `mode` the way their timeline and token cousins do.
 */
function readStreakRun(holder, playerId) {
  const player = findPlayer(holder, playerId);
  return player && Number.isFinite(player.streakRun) ? player.streakRun : 0;
}

function writeStreakRun(holder, playerId, run) {
  return {
    ...holder,
    players: holder.players.map((p) => (p.id === playerId ? { ...p, streakRun: run } : p)),
  };
}

function addTokens(mode, holder, playerId, delta, cap) {
  if (mode === 'coop') {
    return { ...holder, sharedTokens: clamp(holder.sharedTokens + delta, 0, cap) };
  }
  return {
    ...holder,
    players: holder.players.map((p) =>
      p.id === playerId ? { ...p, tokens: clamp(p.tokens + delta, 0, cap) } : p,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Placement maths                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Is gap `gapIndex` a legal home for a card released in `year`?
 * Equal years pass on BOTH sides — a tie is never a wrong answer.
 * @param {readonly {year:number}[]} timeline year-sorted
 * @param {number} gapIndex 0..timeline.length
 * @param {number} year
 * @returns {boolean}
 */
export function isGapCorrect(timeline, gapIndex, year) {
  if (!Array.isArray(timeline)) return false;
  if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > timeline.length) return false;
  if (!isPlainYear(year)) return false;
  const leftOk = gapIndex === 0 || year >= timeline[gapIndex - 1].year;
  const rightOk = gapIndex === timeline.length || year <= timeline[gapIndex].year;
  return leftOk && rightOk;
}

/**
 * Every gap that would accept `year`. With ties this is more than one index,
 * which is exactly why the UI must not assume a single "right answer".
 * @param {readonly {year:number}[]} timeline
 * @param {number} year
 * @returns {number[]}
 */
export function correctGapsFor(timeline, year) {
  const out = [];
  for (let i = 0; i <= timeline.length; i += 1) {
    if (isGapCorrect(timeline, i, year)) out.push(i);
  }
  return out;
}

/**
 * Where an automatic insert (a bought card) goes: after every card with an
 * earlier-or-equal year, so newcomers sit behind existing ties.
 * @param {readonly {year:number}[]} timeline
 * @param {number} year
 * @returns {number}
 */
export function insertionIndexFor(timeline, year) {
  let i = 0;
  while (i < timeline.length && timeline[i].year <= year) i += 1;
  return i;
}

/* -------------------------------------------------------------------------- */
/* Game construction                                                           */
/* -------------------------------------------------------------------------- */

function normalisePlayers(players) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RangeError(`createGame: players must be an array of ${MIN_PLAYERS}-${MAX_PLAYERS}`);
  }
  const seen = new Set();
  return players.map((entry, index) => {
    const raw = typeof entry === 'string' ? { name: entry } : entry;
    if (!raw || typeof raw !== 'object') {
      throw new TypeError('createGame: each player must be a name or a { id, name } object');
    }
    const id = typeof raw.id === 'string' && raw.id ? raw.id : `p${index + 1}`;
    if (seen.has(id)) throw new RangeError(`createGame: duplicate player id "${id}"`);
    seen.add(id);
    const name = typeof raw.name === 'string' && raw.name ? raw.name : `Player ${index + 1}`;
    // `photo` is null, never undefined: the state has to survive JSON.stringify
    // and an undefined would silently vanish from a save. `colour` is accepted
    // alongside `color` because the rest of the repo is written in British
    // English and the mismatch is otherwise a five-minute bug.
    const photo = typeof raw.photo === 'string' && raw.photo ? raw.photo : null;
    const given = typeof raw.color === 'string' && raw.color ? raw.color : raw.colour;
    const color = typeof given === 'string' && given ? given : seatColor(index);
    return { id, name, photo, color, timeline: [], tokens: 0, streakRun: 0 };
  });
}

function normaliseDeck(deck) {
  if (!Array.isArray(deck)) throw new TypeError('createGame: deck must be an array of cards');
  return deck.map((card, index) => {
    if (!card || typeof card !== 'object') {
      throw new TypeError(`createGame: deck[${index}] is not a card object`);
    }
    if (!isPlainYear(card.year)) {
      throw new TypeError(`createGame: deck[${index}] has no numeric year`);
    }
    return { ...card, id: typeof card.id === 'string' ? card.id : `card-${index + 1}` };
  });
}

/**
 * Build a fresh game. Deterministic: the same `{ deck, players, seed }` always
 * produces the same deal.
 *
 * @param {{
 *   players: readonly (string | {id?:string, name?:string})[],
 *   deck: readonly object[],
 *   targetCards?: number, mode?: string, mistakeLimit?: number,
 *   startingTokens?: number, tokenCap?: number, seed?: number,
 *   streakBonus?: boolean
 * }} options
 */
export function createGame(options) {
  const {
    players,
    deck,
    targetCards = 10,
    mode = 'classic',
    mistakeLimit = 3,
    startingTokens = 2,
    // Defaults off a mode bound earlier in the same pattern, so co-op gets its
    // bigger pool without the caller having to know the number - and an explicit
    // `tokenCap` still wins, in either direction.
    tokenCap = defaultTokenCap(mode),
    seed = 1,
    streakBonus = false,
  } = options || {};

  if (!MODES.includes(mode)) {
    throw new RangeError(`createGame: unknown mode "${mode}"`);
  }
  if (typeof streakBonus !== 'boolean') {
    throw new TypeError('createGame: streakBonus must be a boolean');
  }
  if (!Number.isInteger(targetCards) || targetCards < 2) {
    throw new RangeError('createGame: targetCards must be an integer >= 2');
  }
  if (!Number.isInteger(mistakeLimit) || mistakeLimit < 1) {
    throw new RangeError('createGame: mistakeLimit must be an integer >= 1');
  }
  if (!Number.isInteger(tokenCap) || tokenCap < 1) {
    throw new RangeError('createGame: tokenCap must be an integer >= 1');
  }
  if (!Number.isInteger(startingTokens) || startingTokens < 0) {
    throw new RangeError('createGame: startingTokens must be an integer >= 0');
  }
  if (!Number.isInteger(seed)) {
    throw new RangeError('createGame: seed must be an integer');
  }

  const roster = normalisePlayers(players);
  const cards = normaliseDeck(deck);
  const dealt = mode === 'coop' ? 1 : roster.length;
  if (cards.length < dealt) {
    throw new RangeError(
      `createGame: deck needs at least ${dealt} card(s) to deal the starting timeline(s)`,
    );
  }

  const shuffled = shuffle(cards, seed >>> 0);
  const openingTokens = clamp(startingTokens, 0, tokenCap);

  let people;
  let sharedTimeline;
  let sharedTokens;
  if (mode === 'coop') {
    people = roster.map((p) => ({ ...p, timeline: [], tokens: 0 }));
    sharedTimeline = [shuffled.items[0]];
    sharedTokens = openingTokens;
  } else {
    people = roster.map((p, i) => ({ ...p, timeline: [shuffled.items[i]], tokens: openingTokens }));
    sharedTimeline = [];
    sharedTokens = 0;
  }

  const state = {
    version: STATE_VERSION,
    mode,
    targetCards,
    mistakeLimit,
    startingTokens: openingTokens,
    tokenCap,
    streakBonus,
    seed: seed >>> 0,
    rngState: shuffled.cursor,
    players: people,
    sharedTimeline,
    sharedTokens,
    activeIndex: 0,
    turn: 1,
    phase: 'turn-start',
    deck: shuffled.items.slice(dealt),
    discard: [],
    mistakes: 0,
    // Tallies for the scoreboard and the winner screen. Plain `{}` rather than a
    // Map so a save is still a straight stringify, and sparse rather than
    // pre-zeroed so "nothing was ever missed" is just an empty object.
    missCounts: {},
    challengeWins: {},
    skips: 0,
    result: null,
    lastError: null,
    ...turnReset(),
  };

  // A deck that is empty before anyone has played is already a finished game;
  // say so now rather than letting the UI offer an impossible DRAW.
  const end = endStateFor(state);
  if (end) return { ...state, phase: 'game-over', result: end, ...turnReset() };
  return state;
}

/* -------------------------------------------------------------------------- */
/* Ending the game                                                             */
/* -------------------------------------------------------------------------- */

/** Longest timeline, then most tokens, then a shared win. */
function standings(state) {
  const rows = state.players.map((p) => ({
    id: p.id,
    cards: readTimeline(state.mode, state, p.id).length,
    tokens: readTokens(state.mode, state, p.id),
  }));
  const bestCards = Math.max(...rows.map((r) => r.cards));
  let leaders = rows.filter((r) => r.cards === bestCards);
  if (leaders.length > 1) {
    const bestTokens = Math.max(...leaders.map((r) => r.tokens));
    leaders = leaders.filter((r) => r.tokens === bestTokens);
  }
  return leaders.map((r) => r.id);
}

/**
 * What would end the game right now, or null if play continues.
 * @returns {{reason:string, winnerIds:string[], shared:boolean, coopWon:boolean|null}|null}
 */
function endStateFor(state) {
  if (state.mode === 'coop') {
    if (state.sharedTimeline.length >= state.targetCards) {
      return {
        reason: 'target',
        winnerIds: state.players.map((p) => p.id),
        shared: true,
        coopWon: true,
      };
    }
    if (state.mistakes >= state.mistakeLimit) {
      return { reason: 'mistake-limit', winnerIds: [], shared: false, coopWon: false };
    }
    if (state.deck.length === 0) {
      return { reason: 'deck-exhausted', winnerIds: [], shared: false, coopWon: false };
    }
    return null;
  }

  const reached = state.players.filter((p) => p.timeline.length >= state.targetCards);
  if (reached.length > 0) {
    return {
      reason: 'target',
      winnerIds: reached.map((p) => p.id),
      shared: reached.length > 1,
      coopWon: null,
    };
  }
  if (state.deck.length === 0) {
    const winnerIds = standings(state);
    return {
      reason: 'deck-exhausted',
      winnerIds,
      shared: winnerIds.length > 1,
      coopWon: null,
    };
  }
  return null;
}

/** The result a manual `END_GAME` produces: whatever is true right now. */
function forcedEndState(state) {
  const natural = endStateFor(state);
  if (natural) return { ...natural, reason: natural.reason === 'target' ? 'target' : 'ended' };
  if (state.mode === 'coop') {
    return { reason: 'ended', winnerIds: [], shared: false, coopWon: false };
  }
  const winnerIds = standings(state);
  return { reason: 'ended', winnerIds, shared: winnerIds.length > 1, coopWon: null };
}

/* -------------------------------------------------------------------------- */
/* Reveal resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Work out what the reveal means, without touching state. Recomputed from the
 * pre-reveal snapshot every time the group toggles a confirmation, so the
 * advanced/expert "you also had to name it" gate can flip the outcome after the
 * card has already been flipped.
 */
function resolveReveal(state, base) {
  const card = state.card;
  const year = card.year;
  const active = state.players[state.activeIndex];
  const activeTimeline = readTimeline(state.mode, base, active.id);
  const placementCorrect = isGapCorrect(activeTimeline, state.committedGap, year);

  const titleOk = state.confirmations.title;
  const artistOk = state.confirmations.artist;
  const yearGuess = state.yearGuess;
  const needsYear = state.mode === 'expert';
  const yearGuessCorrect = needsYear ? yearGuess === year : null;

  let requirementsMet = true;
  if (state.mode === 'advanced' || state.mode === 'expert') {
    requirementsMet = titleOk === true && artistOk === true;
    if (needsYear) requirementsMet = requirementsMet && yearGuessCorrect === true;
  }
  const accepted = placementCorrect && requirementsMet;

  // Challenges only pay out when the PLACEMENT itself was wrong. A challenger who
  // bet against a correct placement — or against a player who placed correctly but
  // fluffed the title in advanced mode — simply loses the spent token.
  const seatCount = state.players.length;
  const challenges = state.challenges.map((ch) => {
    const index = state.players.findIndex((p) => p.id === ch.playerId);
    const seatOffset = (index - state.activeIndex - 1 + seatCount) % seatCount;
    const correct = isGapCorrect(readTimeline(state.mode, base, ch.playerId), ch.gapIndex, year);
    return {
      playerId: ch.playerId,
      gapIndex: ch.gapIndex,
      seatOffset,
      correct,
      won: false,
      resolved: !placementCorrect,
      tokenSpent: 1,
    };
  });

  let stolenBy = null;
  if (!placementCorrect) {
    const eligible = challenges
      .filter((c) => c.correct)
      .sort((a, b) => a.seatOffset - b.seatOffset);
    if (eligible.length > 0) stolenBy = eligible[0].playerId;
  }
  const challengeResults = challenges.map((c) =>
    c.playerId === stolenBy ? { ...c, won: true } : c,
  );

  const identifyConfirmed = state.confirmations.identify;
  const identifyAwarded = state.claimIdentify && identifyConfirmed === true;

  // The streak counts KEPT cards, so it is decided by `accepted` and not by
  // `placementCorrect` - see "The streak, precisely" at the top of the file.
  // Everything here is computed from `base`, never from the live state, because
  // every confirmation toggle on the reveal screen replays this function; an
  // increment would pay the bonus again on every tap.
  const runBefore = state.streakBonus ? readStreakRun(base, active.id) : 0;
  // `streakBonus` gates the increment as well as the payout: with the rule off
  // the run has to stay at 0 for everybody, or `streakRun` starts meaning
  // "cards kept in a row under a rule nobody is playing" and the seat rail draws
  // progress towards a token that will never arrive.
  const runReached = state.streakBonus && accepted ? runBefore + 1 : 0;
  const streakAwarded = state.streakBonus && runReached >= STREAK_LENGTH;
  const streakRun = streakAwarded ? 0 : runReached;

  // What the player ACTUALLY receives, not what the rule nominally pays. At the
  // token cap a confirmed claim is still confirmed, but it is worth nothing -
  // and a reveal screen promising "+1" while the pills refuse to move is read at
  // a table as the game cheating somebody, so the award has to tell the truth.
  // The two awards are stacked in the order `applyOutcome` pays them, so a hand
  // one short of the cap reports +1 and +0 rather than +1 and +1.
  const tokensBefore = readTokens(state.mode, base, active.id);
  const afterIdentify = clamp(tokensBefore + (identifyAwarded ? 1 : 0), 0, state.tokenCap);
  const identifyDelta = afterIdentify - tokensBefore;
  const afterStreak = clamp(
    afterIdentify + (streakAwarded ? STREAK_REWARD : 0),
    0,
    state.tokenCap,
  );
  const streakDelta = afterStreak - afterIdentify;

  let destination = 'discard';
  if (accepted) destination = 'timeline';
  else if (stolenBy) destination = 'challenger';

  // How hard this song turned out to be: every gap nominated for it and missed,
  // the active player's and each challenger's alike. A challenger nominating a
  // gap IS placing the card, and counting only the one placement would leave
  // "hardest song" picking between a dozen cards that were each missed once.
  const wrongGuesses =
    (placementCorrect ? 0 : 1) + challengeResults.filter((c) => !c.correct).length;

  const tokenPool = state.mode === 'coop' ? 'shared' : 'player';
  const tokenAwards = [];
  if (identifyAwarded) {
    tokenAwards.push({
      playerId: active.id,
      delta: identifyDelta,
      reason: 'identify',
      pool: tokenPool,
    });
  }
  if (streakAwarded) {
    tokenAwards.push({
      playerId: active.id,
      delta: streakDelta,
      reason: 'streak',
      pool: tokenPool,
    });
  }

  return {
    kind: 'placement',
    card,
    year,
    playerId: active.id,
    gapIndex: state.committedGap,
    placementCorrect,
    titleOk,
    artistOk,
    yearGuess,
    yearGuessCorrect,
    requirementsMet,
    accepted,
    claimedIdentify: state.claimIdentify,
    identifyConfirmed,
    identifyAwarded,
    streakAwarded,
    /** The active player's run AFTER this card - already back to 0 if it paid. */
    streakRun,
    tokenAwards,
    challenges: challengeResults,
    stolenBy,
    destination,
    mistakeRecorded: state.mode === 'coop' && destination === 'discard',
    wrongGuesses,
    tokensSpent: 0,
    replaced: null,
  };
}

/** Replay the snapshot forward through an outcome. Idempotent by construction. */
function applyOutcome(state, base, outcome) {
  let holder = {
    players: base.players,
    sharedTimeline: base.sharedTimeline,
    sharedTokens: base.sharedTokens,
  };
  let discard = base.discard;

  if (outcome.destination === 'timeline') {
    const timeline = readTimeline(state.mode, holder, outcome.playerId);
    holder = writeTimeline(
      state.mode,
      holder,
      outcome.playerId,
      insertAt(timeline, outcome.gapIndex, outcome.card),
    );
  } else if (outcome.destination === 'challenger') {
    const winner = outcome.challenges.find((c) => c.won);
    const timeline = readTimeline(state.mode, holder, winner.playerId);
    holder = writeTimeline(
      state.mode,
      holder,
      winner.playerId,
      insertAt(timeline, winner.gapIndex, outcome.card),
    );
  } else {
    discard = discard.concat([outcome.card]);
  }

  if (outcome.identifyAwarded) {
    holder = addTokens(state.mode, holder, outcome.playerId, 1, state.tokenCap);
  }
  if (outcome.streakAwarded) {
    holder = addTokens(state.mode, holder, outcome.playerId, STREAK_REWARD, state.tokenCap);
  }
  // Assigned, not incremented: `resolveReveal` worked the run out from `base`,
  // so replaying this after a confirmation toggle lands on the same number.
  holder = writeStreakRun(holder, outcome.playerId, outcome.streakRun);

  return ok(state, {
    players: holder.players,
    sharedTimeline: holder.sharedTimeline,
    sharedTokens: holder.sharedTokens,
    discard,
    mistakes: base.mistakes + (outcome.mistakeRecorded ? 1 : 0),
    // Both tallies are rebuilt from the snapshot for the same reason, which is
    // why `revealBase` carries them at all.
    missCounts: addTally(base.missCounts, outcome.card.id, outcome.wrongGuesses),
    challengeWins: outcome.stolenBy
      ? addTally(base.challengeWins, outcome.stolenBy, 1)
      : base.challengeWins,
    outcome,
  });
}

/** REVEAL and every later confirmation funnel through here. */
function recomputeReveal(state, base) {
  const outcome = resolveReveal(state, base);
  return applyOutcome(state, base, outcome);
}

/* -------------------------------------------------------------------------- */
/* Action handlers                                                             */
/* -------------------------------------------------------------------------- */

function inTurn(state) {
  return state.phase === 'listening' || state.phase === 'placing';
}

function doDraw(state, action) {
  if (state.phase !== 'turn-start') {
    return reject(state, action, 'a card can only be drawn at the start of a turn');
  }
  if (state.deck.length === 0) return reject(state, action, 'the deck is empty');
  return ok(state, {
    deck: state.deck.slice(1),
    card: state.deck[0],
    phase: 'listening',
    outcome: null,
  });
}

function doBuyCard(state, action) {
  if (state.phase !== 'turn-start') {
    return reject(state, action, 'a card can only be bought at the start of a turn');
  }
  if (state.deck.length === 0) return reject(state, action, 'the deck is empty');
  const active = state.players[state.activeIndex];
  if (readTokens(state.mode, state, active.id) < BUY_COST) {
    return reject(state, action, `buying a card costs ${BUY_COST} tokens`);
  }

  const card = state.deck[0];
  let holder = addTokens(state.mode, state, active.id, -BUY_COST, state.tokenCap);
  const timeline = readTimeline(state.mode, holder, active.id);
  const gapIndex = insertionIndexFor(timeline, card.year);
  holder = writeTimeline(state.mode, holder, active.id, insertAt(timeline, gapIndex, card));
  // A bought card is a turn nobody got right, so it ends the run rather than
  // being threaded through it.
  holder = writeStreakRun(holder, active.id, 0);

  return ok(state, {
    players: holder.players,
    sharedTimeline: holder.sharedTimeline,
    sharedTokens: holder.sharedTokens,
    deck: state.deck.slice(1),
    card,
    phase: 'turn-end',
    outcome: {
      kind: 'buy',
      card,
      year: card.year,
      playerId: active.id,
      gapIndex,
      placementCorrect: true,
      titleOk: null,
      artistOk: null,
      yearGuess: null,
      yearGuessCorrect: null,
      requirementsMet: true,
      accepted: true,
      claimedIdentify: false,
      identifyConfirmed: null,
      identifyAwarded: false,
      streakAwarded: false,
      streakRun: 0,
      tokenAwards: [
        {
          playerId: active.id,
          delta: -BUY_COST,
          reason: 'buy',
          pool: state.mode === 'coop' ? 'shared' : 'player',
        },
      ],
      challenges: [],
      stolenBy: null,
      destination: 'timeline',
      mistakeRecorded: false,
      wrongGuesses: 0,
      tokensSpent: BUY_COST,
      replaced: null,
    },
  });
}

function doSelectGap(state, action) {
  if (!inTurn(state)) return reject(state, action, 'no card is in play');
  if (state.placementCommitted) return reject(state, action, 'the placement is already committed');
  const active = state.players[state.activeIndex];
  const timeline = readTimeline(state.mode, state, active.id);
  if (!Number.isInteger(action.gapIndex) || action.gapIndex < 0 || action.gapIndex > timeline.length) {
    return reject(state, action, 'gapIndex is outside the timeline');
  }
  return ok(state, { selectedGap: action.gapIndex, phase: 'placing' });
}

function doCommitPlacement(state, action) {
  if (!inTurn(state)) return reject(state, action, 'no card is in play');
  if (state.placementCommitted) return reject(state, action, 'the placement is already committed');
  const gapIndex = Number.isInteger(action.gapIndex) ? action.gapIndex : state.selectedGap;
  if (!Number.isInteger(gapIndex)) return reject(state, action, 'choose a gap first');
  const active = state.players[state.activeIndex];
  const timeline = readTimeline(state.mode, state, active.id);
  if (gapIndex < 0 || gapIndex > timeline.length) {
    return reject(state, action, 'gapIndex is outside the timeline');
  }
  return ok(state, {
    selectedGap: gapIndex,
    committedGap: gapIndex,
    placementCommitted: true,
    phase: 'placing',
  });
}

function doAddChallenge(state, action) {
  if (!inTurn(state)) return reject(state, action, 'challenges are only open while a card is in play');
  const active = state.players[state.activeIndex];
  if (typeof action.playerId !== 'string') return reject(state, action, 'playerId is required');
  if (action.playerId === active.id) {
    return reject(state, action, 'the active player cannot challenge their own placement');
  }
  if (!findPlayer(state, action.playerId)) return reject(state, action, 'unknown player');
  if (state.challenges.some((c) => c.playerId === action.playerId)) {
    return reject(state, action, 'that player has already challenged this card');
  }
  if (readTokens(state.mode, state, action.playerId) < 1) {
    return reject(state, action, 'challenging costs 1 token');
  }
  const timeline = readTimeline(state.mode, state, action.playerId);
  if (!Number.isInteger(action.gapIndex) || action.gapIndex < 0 || action.gapIndex > timeline.length) {
    return reject(state, action, 'a challenger must nominate a gap in their own timeline');
  }
  const holder = addTokens(state.mode, state, action.playerId, -1, state.tokenCap);
  return ok(state, {
    players: holder.players,
    sharedTokens: holder.sharedTokens,
    challenges: state.challenges.concat([
      { playerId: action.playerId, gapIndex: action.gapIndex },
    ]),
  });
}

function doRemoveChallenge(state, action) {
  if (!inTurn(state)) return reject(state, action, 'challenges are only open while a card is in play');
  if (!state.challenges.some((c) => c.playerId === action.playerId)) {
    return reject(state, action, 'that player has not challenged this card');
  }
  const holder = addTokens(state.mode, state, action.playerId, 1, state.tokenCap);
  return ok(state, {
    players: holder.players,
    sharedTokens: holder.sharedTokens,
    challenges: state.challenges.filter((c) => c.playerId !== action.playerId),
  });
}

function doSetClaimIdentify(state, action) {
  if (!inTurn(state)) return reject(state, action, 'no card is in play');
  const value = action.value === undefined ? true : action.value;
  if (typeof value !== 'boolean') return reject(state, action, 'value must be a boolean');
  return ok(state, { claimIdentify: value });
}

function doSetYearGuess(state, action) {
  if (!inTurn(state)) return reject(state, action, 'no card is in play');
  if (action.year === null) return ok(state, { yearGuess: null });
  if (!Number.isInteger(action.year)) return reject(state, action, 'year must be an integer or null');
  return ok(state, { yearGuess: action.year });
}

function doReveal(state, action) {
  if (state.phase !== 'placing' || !state.placementCommitted) {
    return reject(state, action, 'commit a placement before revealing');
  }
  const base = {
    players: state.players,
    sharedTimeline: state.sharedTimeline,
    sharedTokens: state.sharedTokens,
    discard: state.discard,
    mistakes: state.mistakes,
    missCounts: state.missCounts,
    challengeWins: state.challengeWins,
  };
  const revealed = recomputeReveal({ ...state, revealBase: base, phase: 'revealed' }, base);
  return revealed;
}

function doConfirmIdentify(state, action) {
  if (state.phase !== 'revealed' || !state.outcome || state.outcome.kind !== 'placement') {
    return reject(state, action, 'nothing to confirm right now');
  }
  if (!state.claimIdentify) {
    return reject(state, action, 'the active player did not claim they could name it');
  }
  const value = action.ok === undefined ? true : action.ok;
  if (typeof value !== 'boolean') return reject(state, action, 'ok must be a boolean');
  const next = { ...state, confirmations: { ...state.confirmations, identify: value } };
  return recomputeReveal(next, state.revealBase);
}

function doConfirmTitleArtist(state, action) {
  if (state.phase !== 'revealed' || !state.outcome || state.outcome.kind !== 'placement') {
    return reject(state, action, 'nothing to confirm right now');
  }
  if (state.mode !== 'advanced' && state.mode !== 'expert') {
    return reject(state, action, 'title/artist only gate the placement in advanced and expert');
  }
  const hasTitle = typeof action.title === 'boolean';
  const hasArtist = typeof action.artist === 'boolean';
  if (!hasTitle && !hasArtist) {
    return reject(state, action, 'pass title and/or artist as booleans');
  }
  const next = {
    ...state,
    confirmations: {
      ...state.confirmations,
      title: hasTitle ? action.title : state.confirmations.title,
      artist: hasArtist ? action.artist : state.confirmations.artist,
    },
  };
  return recomputeReveal(next, state.revealBase);
}

function doSkipCard(state, action) {
  if (!inTurn(state)) return reject(state, action, 'no card is in play');
  // Refund every challenge: those tokens were spent against a card nobody is
  // going to hear, which would be daylight robbery.
  let holder = { players: state.players, sharedTimeline: state.sharedTimeline, sharedTokens: state.sharedTokens };
  for (const ch of state.challenges) {
    holder = addTokens(state.mode, holder, ch.playerId, 1, state.tokenCap);
  }
  const discard = state.discard.concat([state.card]);
  const replacement = state.deck.length > 0 ? state.deck[0] : null;
  const skipped = state.card;
  const activeId = state.players[state.activeIndex].id;

  return ok(state, {
    ...turnReset(),
    players: holder.players,
    sharedTimeline: holder.sharedTimeline,
    sharedTokens: holder.sharedTokens,
    discard,
    // Counted whether or not another card follows: a song the table waved away
    // was skipped either way, and the scoreboard's "N skipped" would otherwise
    // quietly under-report the last card in the deck.
    skips: state.skips + 1,
    deck: replacement ? state.deck.slice(1) : state.deck,
    card: replacement,
    phase: replacement ? 'listening' : 'turn-end',
    outcome: replacement
      ? null
      : {
          kind: 'skip',
          card: skipped,
          year: skipped.year,
          playerId: activeId,
          gapIndex: null,
          placementCorrect: null,
          titleOk: null,
          artistOk: null,
          yearGuess: null,
          yearGuessCorrect: null,
          requirementsMet: null,
          accepted: false,
          claimedIdentify: false,
          identifyConfirmed: null,
          identifyAwarded: false,
          streakAwarded: false,
          // Unchanged: a skipped card was never placed, so it neither advances
          // the run nor breaks it.
          streakRun: readStreakRun(state, activeId),
          tokenAwards: [],
          challenges: [],
          stolenBy: null,
          destination: 'discard',
          mistakeRecorded: false,
          wrongGuesses: 0,
          tokensSpent: 0,
          replaced: false,
        },
  });
}

function doNextTurn(state, action) {
  if (state.phase !== 'revealed' && state.phase !== 'turn-end') {
    return reject(state, action, 'the turn is not over yet');
  }
  const end = endStateFor(state);
  if (end) {
    return ok(state, { ...turnReset(), phase: 'game-over', result: end });
  }
  return ok(state, {
    ...turnReset(),
    activeIndex: (state.activeIndex + 1) % state.players.length,
    turn: state.turn + 1,
    phase: 'turn-start',
  });
}

function doEndGame(state) {
  return ok(state, { ...turnReset(), phase: 'game-over', result: forcedEndState(state) });
}

/* -------------------------------------------------------------------------- */
/* The reducer                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Apply `action` to `state`. Pure: `state` is never mutated and a brand new
 * object always comes back — rejected actions return a copy carrying
 * `lastError`, so the UI can render the reason without any out-of-band channel.
 * @param {object} state
 * @param {{type:string}} action
 */
export function reduce(state, action) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('reduce: state must be a game state object');
  }
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return reject(state, action, 'malformed action');
  }
  if (state.phase === 'game-over') {
    return reject(state, action, 'the game is over');
  }

  switch (action.type) {
    case ACTIONS.DRAW:
      return doDraw(state, action);
    case ACTIONS.BUY_CARD:
      return doBuyCard(state, action);
    case ACTIONS.SELECT_GAP:
      return doSelectGap(state, action);
    case ACTIONS.COMMIT_PLACEMENT:
      return doCommitPlacement(state, action);
    case ACTIONS.ADD_CHALLENGE:
      return doAddChallenge(state, action);
    case ACTIONS.REMOVE_CHALLENGE:
      return doRemoveChallenge(state, action);
    case ACTIONS.SET_CLAIM_IDENTIFY:
      return doSetClaimIdentify(state, action);
    case ACTIONS.SET_YEAR_GUESS:
      return doSetYearGuess(state, action);
    case ACTIONS.REVEAL:
      return doReveal(state, action);
    case ACTIONS.CONFIRM_IDENTIFY:
      return doConfirmIdentify(state, action);
    case ACTIONS.CONFIRM_TITLE_ARTIST:
      return doConfirmTitleArtist(state, action);
    case ACTIONS.SKIP_CARD:
      return doSkipCard(state, action);
    case ACTIONS.NEXT_TURN:
      return doNextTurn(state, action);
    case ACTIONS.END_GAME:
      return doEndGame(state, action);
    default:
      return reject(state, action, `unknown action "${action.type}"`);
  }
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

/** The player whose turn it is. */
export function currentPlayer(state) {
  return state.players[state.activeIndex] || null;
}

export function currentPlayerId(state) {
  const player = currentPlayer(state);
  return player ? player.id : null;
}

/** The timeline a player is building — the shared one in co-op. */
export function timelineFor(state, playerId) {
  return readTimeline(state.mode, state, playerId);
}

/** A player's tokens — the shared pool in co-op. */
export function tokensFor(state, playerId) {
  return readTokens(state.mode, state, playerId);
}

/**
 * Every tappable gap in a player's timeline, in render order.
 * @returns {{index:number, left:object|null, right:object|null}[]}
 */
export function gapsFor(state, playerId) {
  const timeline = timelineFor(state, playerId);
  const gaps = [];
  for (let i = 0; i <= timeline.length; i += 1) {
    gaps.push({
      index: i,
      left: i > 0 ? timeline[i - 1] : null,
      right: i < timeline.length ? timeline[i] : null,
    });
  }
  return gaps;
}

/** Why the buy button is disabled, or null when it is live. */
export function buyBlockedReason(state) {
  if (state.phase !== 'turn-start') return 'Only at the start of your turn';
  if (state.deck.length === 0) return 'The deck is empty';
  const active = currentPlayer(state);
  if (!active) return 'No active player';
  const tokens = tokensFor(state, active.id);
  if (tokens < BUY_COST) return `Needs ${BUY_COST} tokens (you have ${tokens})`;
  return null;
}

export function canBuy(state) {
  return buyBlockedReason(state) === null;
}

/** Why `playerId` cannot challenge right now, or null when they can. */
export function challengeBlockedReason(state, playerId) {
  if (!inTurn(state)) return 'Challenges close once the card is revealed';
  const active = currentPlayer(state);
  if (active && active.id === playerId) return 'You are placing this card';
  if (!findPlayer(state, playerId)) return 'Unknown player';
  if (state.challenges.some((c) => c.playerId === playerId)) return 'Already challenged this card';
  if (tokensFor(state, playerId) < 1) return 'Needs 1 token';
  return null;
}

export function canChallenge(state, playerId) {
  return challengeBlockedReason(state, playerId) === null;
}

/** The challenge `playerId` has lodged against the current card, if any. */
export function challengeFor(state, playerId) {
  return state.challenges.find((c) => c.playerId === playerId) || null;
}

export function deckRemaining(state) {
  return state.deck.length;
}

/** Cards placed / cards needed, for the progress pill. */
export function progressFor(state, playerId) {
  const cards = timelineFor(state, playerId).length;
  return { cards, target: state.targetCards, cardsToGo: Math.max(0, state.targetCards - cards) };
}

/**
 * How far into the streak bonus a player is.
 *
 * `enabled` is the only thing the UI has to check before drawing anything: the
 * run is held at 0 for everybody while the house rule is off, so `run` always
 * means "cards kept in a row towards the next token" and never a number left
 * over from a rule nobody is playing.
 * @returns {{enabled:boolean, run:number, needed:number, toGo:number}}
 */
export function streakFor(state, playerId) {
  const enabled = state.streakBonus === true;
  const run = enabled ? readStreakRun(state, playerId) : 0;
  return {
    enabled,
    run,
    needed: STREAK_LENGTH,
    toGo: Math.max(0, STREAK_LENGTH - run),
  };
}

/** How many wrong guesses a card has drawn this game. */
export function missCountFor(state, cardId) {
  return tallyOf(state.missCounts, cardId);
}

/** How many cards a player has taken off somebody else with a challenge. */
export function challengeWinsFor(state, playerId) {
  return tallyOf(state.challengeWins, playerId);
}

/** Cards the table waved away. */
export function skippedCount(state) {
  return Number.isFinite(state.skips) ? state.skips : 0;
}

/** Every pile a card can be sitting in, so an id can always be resolved back. */
function cardPiles(state) {
  const piles = [state.deck, state.discard, state.sharedTimeline];
  for (const player of state.players) piles.push(player.timeline);
  if (state.card) piles.push([state.card]);
  return piles;
}

function findCard(state, cardId) {
  for (const pile of cardPiles(state)) {
    if (!Array.isArray(pile)) continue;
    const hit = pile.find((c) => c && c.id === cardId);
    if (hit) return hit;
  }
  return null;
}

/**
 * The song the table got wrong most often, or null when nobody missed anything.
 *
 * Ties go to the card that was missed first. Unlike `boldestCaller` this does
 * NOT bail out on a tie: "hardest song" is a headline about a song, and a
 * three-way tie at one miss each still makes one of them a fair thing to print,
 * whereas crowning one of two equally bold players would be picking a side.
 * @returns {{cardId:string, card:object|null, misses:number, tied:boolean}|null}
 */
export function hardestCard(state) {
  const top = topOfTally(state.missCounts);
  if (!top) return null;
  return { cardId: top.key, card: findCard(state, top.key), misses: top.count, tied: top.tied };
}

/**
 * The player who has stolen the most cards, or null when nobody has stolen one
 * outright.
 *
 * Strictly ahead, like `leader` and for the same reason: this drives a named
 * row on the winner screen, and a badge shared by two people is worse than no
 * badge at all.
 * @returns {{playerId:string, name:string, color:string, seat:number, wins:number}|null}
 */
export function boldestCaller(state) {
  const top = topOfTally(state.challengeWins);
  if (!top || top.tied) return null;
  const seat = state.players.findIndex((p) => p.id === top.key);
  if (seat < 0) return null;
  const player = state.players[seat];
  return {
    playerId: player.id,
    name: player.name,
    color: typeof player.color === 'string' && player.color ? player.color : seatColor(seat),
    seat,
    wins: top.count,
  };
}

/**
 * Which decades a player's timeline is made of.
 *
 * The eight `counts` are raw facts and always present, in `DECADE_STARTS` order,
 * so an eight-bar histogram can be drawn straight off them with `bestCount` as
 * the tallest bar. The verdict fields are the ones with an opinion:
 *
 *   `enough`    false until `DECADE_MIN_CARDS` cards have landed in the buckets.
 *               This is the "not enough cards yet" signal the caption needs -
 *               everybody is dealt a card, and one 1984 is not a specialism.
 *   `best`      the decade worth naming, or null while `enough` is false. Ties
 *               resolve to the earliest decade so there is always something to
 *               name; `tied` says whether that choice was forced.
 *   `dominant`  a strict majority of the counted cards sit in `best`. The
 *               difference between "owns the 80s" and "strong: 60s", decided
 *               here rather than in a template, because it is a rule about the
 *               numbers and not a fact about the words.
 *
 * `cards` can exceed `total` if the deck reaches outside 1950-2029; such a card
 * is in the timeline but in none of the eight bars.
 */
export function decadeStrengthFor(state, playerId) {
  const timeline = timelineFor(state, playerId);
  const buckets = DECADE_STARTS.map((decade) => ({ decade, count: 0 }));
  let total = 0;
  for (const song of timeline) {
    if (!song || !isPlainYear(song.year)) continue;
    const start = Math.floor(song.year / 10) * 10;
    const slot = buckets.find((b) => b.decade === start);
    if (!slot) continue;
    slot.count += 1;
    total += 1;
  }

  let bestCount = 0;
  for (const bucket of buckets) bestCount = Math.max(bestCount, bucket.count);
  const leaders = bestCount > 0 ? buckets.filter((b) => b.count === bestCount).map((b) => b.decade) : [];
  const enough = total >= DECADE_MIN_CARDS;

  return {
    playerId,
    cards: timeline.length,
    total,
    counts: buckets,
    bestCount,
    leaders,
    tied: leaders.length > 1,
    best: enough && leaders.length > 0 ? leaders[0] : null,
    dominant: enough && bestCount * 2 > total,
    enough,
  };
}

/** One `decadeStrengthFor` row per player, in seat order. */
export function decadeStrengths(state) {
  return state.players.map((p) => decadeStrengthFor(state, p.id));
}

/**
 * The player who plays after the active one, or null when there is nobody else.
 *
 * Seat rotation is the same in every mode, co-op included: only the timeline is
 * shared, never the turn order.
 */
export function nextPlayer(state) {
  const people = state.players;
  if (!Array.isArray(people) || people.length < 2) return null;
  return people[(state.activeIndex + 1) % people.length] || null;
}

export function nextPlayerId(state) {
  const player = nextPlayer(state);
  return player ? player.id : null;
}

/**
 * The player who is STRICTLY ahead on cards, or null when nobody is.
 *
 * Strictly, and on cards alone, because this drives a crown in the UI: at the
 * start of a game everybody holds one card, and a crown on all eight faces is
 * noise rather than information. Tokens deliberately do not break the tie - they
 * settle a finished game (see `standings`), they do not make somebody "ahead".
 * Co-op has one shared pile, so nobody can be ahead of anybody: always null.
 */
export function leader(state) {
  if (state.mode === 'coop') return null;
  if (!Array.isArray(state.players) || state.players.length < 2) return null;
  let best = null;
  let bestCards = -1;
  let tied = false;
  for (const player of state.players) {
    const cards = timelineFor(state, player.id).length;
    if (cards > bestCards) {
      bestCards = cards;
      best = player;
      tied = false;
    } else if (cards === bestCards) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export function leaderId(state) {
  const player = leader(state);
  return player ? player.id : null;
}

/**
 * One row per player in FIXED SEAT ORDER, with the three things a table needs
 * to know at a glance: who is playing, who is next, and who is ahead.
 *
 * Seat order, not score order: people sit in a fixed order and re-sorting the
 * faces every turn destroys the map they already have in their heads. Use
 * `scoreboard()` when you actually want a ranking.
 * In co-op every row reports the shared pile and the shared pool, and `isLeader`
 * is false for everyone - there is no race to lead.
 */
export function seatStandings(state) {
  const activeId = currentPlayerId(state);
  const upNextId = nextPlayerId(state);
  const aheadId = leaderId(state);
  return state.players.map((p, seat) => {
    const timeline = timelineFor(state, p.id);
    return {
      playerId: p.id,
      name: p.name,
      photo: p.photo === undefined ? null : p.photo,
      color: typeof p.color === 'string' && p.color ? p.color : seatColor(seat),
      seat,
      timeline,
      cards: timeline.length,
      tokens: tokensFor(state, p.id),
      streakRun: streakFor(state, p.id).run,
      cardsToGo: Math.max(0, state.targetCards - timeline.length),
      isActive: p.id === activeId,
      isNext: p.id === upNextId,
      isLeader: p.id === aheadId,
    };
  });
}

/** Leaderboard rows, best first. In co-op every row shows the shared pile. */
export function scoreboard(state) {
  const activeId = currentPlayerId(state);
  return state.players
    .map((p, seat) => {
      const timeline = timelineFor(state, p.id);
      return {
        playerId: p.id,
        name: p.name,
        // Carried so a row can be drawn from this one object. Rows are sorted by
        // score, so `seat` is the only honest source for the accent - the array
        // index here is a ranking, not a seat.
        photo: p.photo === undefined ? null : p.photo,
        color: typeof p.color === 'string' && p.color ? p.color : seatColor(seat),
        seat,
        timeline,
        cards: timeline.length,
        tokens: tokensFor(state, p.id),
        // Personal even in co-op, and 0 for everybody while the house rule is
        // off - see `streakFor`, which is the honest way to ask.
        streakRun: streakFor(state, p.id).run,
        cardsToGo: Math.max(0, state.targetCards - timeline.length),
        isActive: p.id === activeId,
      };
    })
    .sort((a, b) => b.cards - a.cards || b.tokens - a.tokens || a.seat - b.seat);
}

export function isGameOver(state) {
  return state.phase === 'game-over';
}

/** The recorded result, or null while the game is live. */
export function result(state) {
  return state.result;
}

/** Winning player objects (empty when the game is unfinished or was lost). */
export function winners(state) {
  if (!state.result) return [];
  return state.result.winnerIds
    .map((id) => findPlayer(state, id))
    .filter((p) => p !== null);
}

/** The single winner, or null for "no winner yet" and for shared wins. */
export function winner(state) {
  const all = winners(state);
  return all.length === 1 ? all[0] : null;
}

/**
 * The four facts the winner screen can close a game with.
 *
 * Every field is null unless it earned itself, and that is the whole contract:
 * the screen draws a row per non-null field and nothing else, so a game where
 * nobody challenged has no boldest call, a game where every placement landed has
 * no hardest song, and a game nobody skipped through has no skip row. Null
 * rather than a missing key, because the rest of this module never produces
 * `undefined` and a caller should not have to tell the two apart.
 *
 * `bestDecades` is a row per player who has ENOUGH cards to have a decade at
 * all, so it thins out rather than lying, and it is null - not [] - when that
 * leaves nobody, so the "is there a row here" test is the same for all four.
 * Co-op collapses to ONE row for the shared pile, marked by a null `playerId`:
 * eight identical rows would be the same fact printed eight times.
 *
 * Safe to call at any point in a game; the winner screen is simply where it
 * stops changing.
 */
export function recap(state) {
  const hardest = hardestCard(state);
  const rows = state.mode === 'coop' && state.players.length > 0
    ? decadeStrengths(state).slice(0, 1)
    : decadeStrengths(state);
  const decades = rows
    .filter((row) => row.enough && row.best !== null)
    .map((row) => {
      const seat = state.mode === 'coop' ? -1 : state.players.findIndex((p) => p.id === row.playerId);
      const player = seat >= 0 ? state.players[seat] : null;
      const own = player && typeof player.color === 'string' && player.color ? player.color : null;
      return {
        playerId: player ? player.id : null,
        name: player ? player.name : null,
        color: player ? own || seatColor(seat) : null,
        seat: player ? seat : null,
        decade: row.best,
        count: row.bestCount,
        total: row.total,
        dominant: row.dominant,
      };
    });
  const skipped = skippedCount(state);

  return {
    hardestSong: hardest,
    bestDecades: decades.length > 0 ? decades : null,
    boldestCall: boldestCaller(state),
    skipped: skipped > 0 ? skipped : null,
  };
}

/**
 * What the result WILL be if the turn is ended now — lets the reveal screen say
 * "and that wins it" before the player taps Next.
 */
export function pendingResult(state) {
  if (state.phase === 'game-over') return state.result;
  return endStateFor(state);
}

/** Action types that would currently be accepted (payload validity aside). */
export function legalActions(state) {
  switch (state.phase) {
    case 'turn-start': {
      const list = [];
      if (state.deck.length > 0) list.push(ACTIONS.DRAW);
      if (canBuy(state)) list.push(ACTIONS.BUY_CARD);
      list.push(ACTIONS.END_GAME);
      return list;
    }
    case 'listening':
    case 'placing': {
      const list = [
        ACTIONS.SET_CLAIM_IDENTIFY,
        ACTIONS.SET_YEAR_GUESS,
        ACTIONS.ADD_CHALLENGE,
        ACTIONS.REMOVE_CHALLENGE,
        ACTIONS.SKIP_CARD,
      ];
      if (!state.placementCommitted) {
        list.unshift(ACTIONS.SELECT_GAP, ACTIONS.COMMIT_PLACEMENT);
      } else {
        list.push(ACTIONS.REVEAL);
      }
      list.push(ACTIONS.END_GAME);
      return list;
    }
    case 'revealed': {
      const list = [];
      if (state.claimIdentify) list.push(ACTIONS.CONFIRM_IDENTIFY);
      if (state.mode === 'advanced' || state.mode === 'expert') {
        list.push(ACTIONS.CONFIRM_TITLE_ARTIST);
      }
      list.push(ACTIONS.NEXT_TURN, ACTIONS.END_GAME);
      return list;
    }
    case 'turn-end':
      return [ACTIONS.NEXT_TURN, ACTIONS.END_GAME];
    default:
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * State is deliberately plain JSON — no Maps, no Sets, no undefined — so this is
 * a straight stringify and the round trip is lossless.
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * Give a saved player list the fields it was written too early to have: the
 * `photo`/`color` pair from the avatar release, and the `streakRun` from the
 * house-rule release.
 */
function withIdentity(players) {
  return players.map((p, index) => ({
    ...p,
    photo: typeof p.photo === 'string' && p.photo ? p.photo : null,
    color: typeof p.color === 'string' && p.color ? p.color : seatColor(index),
    streakRun: Number.isFinite(p.streakRun) ? p.streakRun : 0,
  }));
}

/**
 * @param {string|object} json
 * @returns {object} the restored state
 */
export function deserialize(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  if (!state || typeof state !== 'object') throw new TypeError('deserialize: not a game state');
  if (state.version !== STATE_VERSION) {
    throw new RangeError(`deserialize: unsupported save version ${String(state.version)}`);
  }
  if (!Array.isArray(state.players) || state.players.length === 0) {
    throw new TypeError('deserialize: save has no players');
  }
  if (!MODES.includes(state.mode)) throw new RangeError('deserialize: unknown mode');
  if (!PHASES.includes(state.phase)) throw new RangeError('deserialize: unknown phase');
  if (!Array.isArray(state.deck) || !Array.isArray(state.discard)) {
    throw new TypeError('deserialize: save has no deck');
  }
  // Photos and seat colours arrived after the first saves did, and the streak
  // run, the two tallies and the skip count after that. Backfilling is cheaper
  // than bumping STATE_VERSION, which would throw away a game that is mid-party
  // on somebody's phone - and a missing `color` would leave the play screen with
  // no accent at all.
  //
  // `revealBase` gets exactly the same treatment, and that is not belt and
  // braces: every confirmation toggle on the reveal screen replays the turn from
  // that snapshot and writes its `players` straight back over the live ones (see
  // `applyOutcome`). Backfilling only the live list means the first tap on
  // Title after resuming mid-reveal silently undoes the backfill - every seat
  // colour and every photo gone for the rest of the game, and a `missCounts` of
  // `undefined` spread into the next tally.
  const needsIdentity = (list) =>
    Array.isArray(list) &&
    list.some(
      (p) => !p || typeof p.color !== 'string' || p.photo === undefined || !Number.isFinite(p.streakRun),
    );
  const patch = {};
  if (typeof state.streakBonus !== 'boolean') patch.streakBonus = false;
  if (!isTally(state.missCounts)) patch.missCounts = {};
  if (!isTally(state.challengeWins)) patch.challengeWins = {};
  if (!Number.isFinite(state.skips)) patch.skips = 0;
  if (needsIdentity(state.players)) patch.players = withIdentity(state.players);

  const base = state.revealBase;
  const hasBase = !!base && typeof base === 'object';
  if (
    hasBase &&
    (needsIdentity(base.players) || !isTally(base.missCounts) || !isTally(base.challengeWins))
  ) {
    patch.revealBase = {
      ...base,
      players: needsIdentity(base.players) ? withIdentity(base.players) : base.players,
      missCounts: isTally(base.missCounts) ? base.missCounts : {},
      challengeWins: isTally(base.challengeWins) ? base.challengeWins : {},
    };
  }

  if (Object.keys(patch).length === 0) return state;
  return { ...state, ...patch };
}
