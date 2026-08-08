/**
 * Rules tests for the music-timeline engine (`public/music/engine.js`).
 *
 * The engine is the only thing standing between a party of eight and an argument
 * about whether a tie counts, so these tests are deliberately adversarial: every
 * gap of every timeline length, both ends of every tie, the whole token economy,
 * challenge priority with wrap-around seating, and each way the game can end.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  BUY_COST,
  COOP_TOKEN_CAP,
  DECADE_MIN_CARDS,
  DECADE_STARTS,
  MODES,
  PHASES,
  STATE_VERSION,
  STREAK_LENGTH,
  STREAK_REWARD,
  TOKEN_CAP,
  boldestCaller,
  canBuy,
  canChallenge,
  challengeBlockedReason,
  challengeFor,
  challengeWinsFor,
  correctGapsFor,
  createGame,
  currentPlayer,
  currentPlayerId,
  deckRemaining,
  decadeStrengthFor,
  decadeStrengths,
  defaultTokenCap,
  deserialize,
  gapsFor,
  hardestCard,
  insertionIndexFor,
  isGameOver,
  isGapCorrect,
  leader,
  leaderId,
  legalActions,
  missCountFor,
  mulberry32,
  nextPlayer,
  nextPlayerId,
  pendingResult,
  progressFor,
  recap,
  reduce,
  SEAT_COLORS,
  scoreboard,
  seatColor,
  seatStandings,
  serialize,
  shuffle,
  skippedCount,
  streakFor,
  timelineFor,
  tokensFor,
  winner,
  winners,
  type Action,
  type ActionType,
  type Card,
  type GameResult,
  type GameState,
  type Mode,
  type Outcome,
} from '../../public/music/engine.js';

/* -------------------------------------------------------------------------- */
/* Fixtures and helpers                                                        */
/* -------------------------------------------------------------------------- */

let cardSeq = 0;

function card(year: number, id?: string): Card {
  cardSeq += 1;
  return {
    id: id ?? `card-${cardSeq}-${year}`,
    title: `Title ${year}`,
    artist: `Artist ${year}`,
    year,
    genre: 'pop',
    decade: Math.floor(year / 10) * 10,
  };
}

function deckOf(years: number[]): Card[] {
  return years.map((y) => card(y));
}

function years(list: readonly Card[]): number[] {
  return list.map((c) => c.year);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Everything except the rejection notice, for "nothing else moved" assertions. */
function core(state: GameState): unknown {
  return JSON.parse(JSON.stringify({ ...state, lastError: null }));
}

function outcomeOf(state: GameState): Outcome {
  if (!state.outcome) throw new Error('expected an outcome on this state');
  return state.outcome;
}

function resultOf(state: GameState): GameResult {
  if (!state.result) throw new Error('expected a result on this state');
  return state.result;
}

interface SetupOptions {
  players?: string[];
  mode?: Mode;
  targetCards?: number;
  mistakeLimit?: number;
  startingTokens?: number;
  /** Left undefined the engine picks per mode: 5, or 6 in co-op. */
  tokenCap?: number;
  streakBonus?: boolean;
  /** Years for each player's timeline, in seat order. */
  timelines?: number[][];
  tokens?: number[];
  /** Upcoming cards; `deck[0]` is what DRAW hands out. */
  deck?: Card[];
  sharedTimeline?: number[];
  sharedTokens?: number;
  activeIndex?: number;
}

/**
 * Build a game and then pin the parts a scenario cares about. State is plain
 * JSON by contract, so overriding it is fair game — and far more legible than
 * playing twenty turns to arrange a specific timeline.
 */
function game(options: SetupOptions = {}): GameState {
  const names = options.players ?? ['Ann', 'Bo', 'Cy'];
  const base = createGame({
    players: names,
    deck: deckOf([1960, 1970, 1980, 1990, 2000, 2010, 1955, 1965]),
    mode: options.mode ?? 'classic',
    targetCards: options.targetCards ?? 10,
    mistakeLimit: options.mistakeLimit ?? 3,
    startingTokens: options.startingTokens ?? 2,
    tokenCap: options.tokenCap,
    streakBonus: options.streakBonus ?? false,
    seed: 7,
  });

  const players = base.players.map((p, i) => ({
    ...p,
    timeline: options.timelines
      ? options.timelines[i].map((y, k) => card(y, `${p.id}-${k}-${y}`))
      : p.timeline,
    tokens: options.tokens ? options.tokens[i] : p.tokens,
  }));

  return {
    ...base,
    players,
    deck: options.deck ?? base.deck,
    activeIndex: options.activeIndex ?? base.activeIndex,
    sharedTimeline: options.sharedTimeline
      ? options.sharedTimeline.map((y, k) => card(y, `shared-${k}-${y}`))
      : base.sharedTimeline,
    sharedTokens: options.sharedTokens ?? base.sharedTokens,
  };
}

function dispatch(state: GameState, actions: Action[]): GameState {
  return actions.reduce((acc, action) => reduce(acc, action), state);
}

/** DRAW, commit `gapIndex`, REVEAL — the spine of an ordinary turn. */
function playTo(state: GameState, gapIndex: number, extra: Action[] = []): GameState {
  return dispatch(state, [
    { type: ACTIONS.DRAW },
    { type: ACTIONS.COMMIT_PLACEMENT, gapIndex },
    ...extra,
    { type: ACTIONS.REVEAL },
  ]);
}

const SAMPLE_ACTIONS: Record<ActionType, Action> = {
  DRAW: { type: 'DRAW' },
  SELECT_GAP: { type: 'SELECT_GAP', gapIndex: 0 },
  COMMIT_PLACEMENT: { type: 'COMMIT_PLACEMENT', gapIndex: 0 },
  ADD_CHALLENGE: { type: 'ADD_CHALLENGE', playerId: 'p2', gapIndex: 0 },
  REMOVE_CHALLENGE: { type: 'REMOVE_CHALLENGE', playerId: 'p2' },
  SET_CLAIM_IDENTIFY: { type: 'SET_CLAIM_IDENTIFY', value: true },
  SET_YEAR_GUESS: { type: 'SET_YEAR_GUESS', year: 1980 },
  BUY_CARD: { type: 'BUY_CARD' },
  REVEAL: { type: 'REVEAL' },
  CONFIRM_IDENTIFY: { type: 'CONFIRM_IDENTIFY', ok: true },
  CONFIRM_TITLE_ARTIST: { type: 'CONFIRM_TITLE_ARTIST', title: true, artist: true },
  NEXT_TURN: { type: 'NEXT_TURN' },
  SKIP_CARD: { type: 'SKIP_CARD' },
  END_GAME: { type: 'END_GAME' },
};

const ALL_ACTION_TYPES = Object.keys(SAMPLE_ACTIONS) as ActionType[];

/* -------------------------------------------------------------------------- */
/* Module surface                                                              */
/* -------------------------------------------------------------------------- */

describe('module surface', () => {
  it('is a self-contained module with no clock, DOM or unseeded randomness', () => {
    const source = readFileSync(new URL('../../public/music/engine.js', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now|new Date\(/);
    expect(code).not.toMatch(/\bdocument\b|\bwindow\b|localStorage|sessionStorage/);
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/require\(/);
  });

  it('exports the four modes and the phase machine', () => {
    expect([...MODES]).toEqual(['classic', 'advanced', 'expert', 'coop']);
    expect([...PHASES]).toEqual([
      'turn-start',
      'listening',
      'placing',
      'revealed',
      'turn-end',
      'game-over',
    ]);
    expect(BUY_COST).toBe(3);
    expect(STATE_VERSION).toBe(1);
  });

  it('exports every documented action type', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(ALL_ACTION_TYPES.slice().sort());
    for (const type of ALL_ACTION_TYPES) {
      expect(ACTIONS[type]).toBe(type);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Placement correctness                                                       */
/* -------------------------------------------------------------------------- */

describe('isGapCorrect', () => {
  /** Independent oracle: a gap is right iff inserting there keeps the list sorted. */
  function keepsSorted(list: number[], gapIndex: number, year: number): boolean {
    const next = [...list.slice(0, gapIndex), year, ...list.slice(gapIndex)];
    return next.every((v, i) => i === 0 || next[i - 1] <= v);
  }

  const SPINE = [1960, 1970, 1980, 1990, 2000];

  for (let len = 1; len <= 5; len += 1) {
    it(`agrees with sorted-insert for every gap of a ${len}-card timeline`, () => {
      const timelineYears = SPINE.slice(0, len);
      const timeline = timelineYears.map((y) => card(y));
      const probes = new Set<number>([1900, 2100]);
      for (const y of timelineYears) {
        probes.add(y - 1);
        probes.add(y);
        probes.add(y + 1);
        probes.add(y + 5);
      }
      for (const probe of probes) {
        for (let gap = 0; gap <= len; gap += 1) {
          expect({ probe, gap, ok: isGapCorrect(timeline, gap, probe) }).toEqual({
            probe,
            gap,
            ok: keepsSorted(timelineYears, gap, probe),
          });
        }
      }
    });
  }

  it('accepts both sides of a tie in the middle of a timeline', () => {
    const timeline = [card(1970), card(1980), card(1990)];
    expect(correctGapsFor(timeline, 1980)).toEqual([1, 2]);
    expect(isGapCorrect(timeline, 1, 1980)).toBe(true);
    expect(isGapCorrect(timeline, 2, 1980)).toBe(true);
    expect(isGapCorrect(timeline, 0, 1980)).toBe(false);
    expect(isGapCorrect(timeline, 3, 1980)).toBe(false);
  });

  it('accepts both sides of a tie at the front', () => {
    const timeline = [card(1970), card(1980)];
    expect(correctGapsFor(timeline, 1970)).toEqual([0, 1]);
  });

  it('accepts both sides of a tie at the back', () => {
    const timeline = [card(1970), card(1980)];
    expect(correctGapsFor(timeline, 1980)).toEqual([1, 2]);
  });

  it('accepts every gap when the whole timeline ties with the card', () => {
    const timeline = [card(1980, 'a'), card(1980, 'b'), card(1980, 'c')];
    expect(correctGapsFor(timeline, 1980)).toEqual([0, 1, 2, 3]);
  });

  it('handles a run of equal years surrounded by other cards', () => {
    const timeline = [card(1970), card(1980, 'x'), card(1980, 'y'), card(1990)];
    expect(correctGapsFor(timeline, 1980)).toEqual([1, 2, 3]);
    expect(correctGapsFor(timeline, 1975)).toEqual([1]);
    expect(correctGapsFor(timeline, 1995)).toEqual([4]);
  });

  it('is empty-timeline safe and rejects out-of-range or non-integer gaps', () => {
    expect(isGapCorrect([], 0, 1980)).toBe(true);
    expect(isGapCorrect([], 1, 1980)).toBe(false);
    const timeline = [card(1980)];
    expect(isGapCorrect(timeline, -1, 1980)).toBe(false);
    expect(isGapCorrect(timeline, 2, 1980)).toBe(false);
    expect(isGapCorrect(timeline, 1.5, 1980)).toBe(false);
    expect(isGapCorrect(timeline, 0, Number.NaN)).toBe(false);
  });

  it('places an automatic insert after existing ties', () => {
    const timeline = [card(1970), card(1980, 'x'), card(1980, 'y'), card(1990)];
    expect(insertionIndexFor(timeline, 1980)).toBe(3);
    expect(insertionIndexFor(timeline, 1960)).toBe(0);
    expect(insertionIndexFor(timeline, 2000)).toBe(4);
    expect(insertionIndexFor([], 1980)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Setup                                                                       */
/* -------------------------------------------------------------------------- */

describe('createGame', () => {
  it('deals one card and the starting tokens to each player', () => {
    const state = createGame({
      players: ['Ann', 'Bo', 'Cy'],
      deck: deckOf([1960, 1970, 1980, 1990, 2000, 2010]),
      seed: 3,
    });
    expect(state.players).toHaveLength(3);
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(state.players.map((p) => p.name)).toEqual(['Ann', 'Bo', 'Cy']);
    for (const p of state.players) {
      expect(p.timeline).toHaveLength(1);
      expect(p.tokens).toBe(2);
    }
    expect(state.deck).toHaveLength(3);
    expect(state.phase).toBe('turn-start');
    expect(state.turn).toBe(1);
    expect(state.activeIndex).toBe(0);
    expect(state.mistakes).toBe(0);
    expect(state.result).toBeNull();
    // Every dealt card is unique and came out of the deck.
    const dealtIds = state.players.map((p) => p.timeline[0].id);
    expect(new Set(dealtIds).size).toBe(3);
    expect(state.deck.some((c) => dealtIds.includes(c.id))).toBe(false);
  });

  it('accepts explicit player ids and names', () => {
    const state = createGame({
      players: [{ id: 'kris', name: 'Kris' }, { id: 'fab', name: 'Fabian' }],
      deck: deckOf([1960, 1970, 1980]),
    });
    expect(state.players.map((p) => p.id)).toEqual(['kris', 'fab']);
  });

  it('clamps starting tokens to the cap', () => {
    const state = game({ startingTokens: 9, tokenCap: 5 });
    expect(state.players.every((p) => p.tokens === 5)).toBe(true);
    expect(state.startingTokens).toBe(5);
  });

  it('gives co-op one shared timeline card and one shared token pool', () => {
    const state = createGame({
      players: ['Ann', 'Bo', 'Cy'],
      deck: deckOf([1960, 1970, 1980, 1990]),
      mode: 'coop',
    });
    expect(state.sharedTimeline).toHaveLength(1);
    expect(state.sharedTokens).toBe(2);
    expect(state.deck).toHaveLength(3);
    for (const p of state.players) {
      expect(p.timeline).toEqual([]);
      expect(p.tokens).toBe(0);
      expect(timelineFor(state, p.id)).toBe(state.sharedTimeline);
      expect(tokensFor(state, p.id)).toBe(2);
    }
  });

  it('rejects nonsense setups', () => {
    const deck = deckOf([1960, 1970, 1980]);
    expect(() => createGame({ players: [], deck })).toThrow(RangeError);
    expect(() =>
      createGame({ players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], deck }),
    ).toThrow(RangeError);
    expect(() => createGame({ players: ['a', 'b'], deck, mode: 'ludicrous' as Mode })).toThrow(
      RangeError,
    );
    expect(() => createGame({ players: ['a', 'b'], deck, targetCards: 1 })).toThrow(RangeError);
    expect(() => createGame({ players: ['a', 'b'], deck, mistakeLimit: 0 })).toThrow(RangeError);
    expect(() => createGame({ players: ['a', 'b', 'c'], deck: deckOf([1960, 1970]) })).toThrow(
      RangeError,
    );
    expect(() =>
      createGame({ players: [{ id: 'x' }, { id: 'x' }], deck }),
    ).toThrow(RangeError);
    expect(() =>
      createGame({ players: ['a', 'b'], deck: [{ id: 'oops' } as unknown as Card] }),
    ).toThrow(TypeError);
  });

  it('is already over when the deal empties the deck', () => {
    const state = createGame({ players: ['Ann', 'Bo'], deck: deckOf([1960, 1990]) });
    expect(state.phase).toBe('game-over');
    expect(resultOf(state).reason).toBe('deck-exhausted');
    // One card each, two tokens each: nobody is ahead, so the win is shared.
    expect(resultOf(state).winnerIds.sort()).toEqual(['p1', 'p2']);
    expect(resultOf(state).shared).toBe(true);
    expect(winner(state)).toBeNull();
    expect(winners(state).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });
});

/* -------------------------------------------------------------------------- */
/* Player identity (photo + seat colour)                                       */
/* -------------------------------------------------------------------------- */

describe('player identity', () => {
  const PHOTO = 'data:image/jpeg;base64,AAAA';

  it('defaults every player to no photo and their seat colour', () => {
    const state = createGame({ players: ['Ann', 'Bo', 'Cy'], deck: deckOf([1960, 1970, 1980, 1990]) });
    expect(state.players.map((p) => p.photo)).toEqual([null, null, null]);
    expect(state.players.map((p) => p.color)).toEqual([
      SEAT_COLORS[0],
      SEAT_COLORS[1],
      SEAT_COLORS[2],
    ]);
  });

  it('offers at least eight distinct, wrapping seat colours', () => {
    expect(SEAT_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SEAT_COLORS).size).toBe(SEAT_COLORS.length);
    for (const colour of SEAT_COLORS) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(seatColor(0)).toBe(SEAT_COLORS[0]);
    expect(seatColor(SEAT_COLORS.length)).toBe(SEAT_COLORS[0]);
    // Total for junk, so a corrupt seat index can never render a colourless UI.
    expect(seatColor(-3)).toBe(SEAT_COLORS[0]);
    expect(seatColor(1.5 as number)).toBe(SEAT_COLORS[0]);
  });

  it('carries a photo through and accepts either spelling of colour', () => {
    const state = createGame({
      players: [
        { name: 'Ann', photo: PHOTO },
        { name: 'Bo', colour: '#123456' },
        { name: 'Cy', color: '#654321' },
      ],
      deck: deckOf([1960, 1970, 1980, 1990]),
    });
    expect(state.players[0].photo).toBe(PHOTO);
    expect(state.players[0].color).toBe(SEAT_COLORS[0]);
    expect(state.players[1].color).toBe('#123456');
    expect(state.players[2].color).toBe('#654321');
  });

  it('normalises a junk photo to null rather than undefined', () => {
    const state = createGame({
      players: [
        { name: 'Ann', photo: '' },
        { name: 'Bo', photo: 42 as unknown as string },
      ],
      deck: deckOf([1960, 1970, 1980]),
    });
    for (const p of state.players) {
      expect(p.photo).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(p, 'photo')).toBe(true);
    }
    // The whole point of null over undefined: it survives the save round trip.
    expect(deserialize(serialize(state)).players.map((p) => p.photo)).toEqual([null, null]);
  });

  it('round-trips photos and colours through serialize/deserialize', () => {
    const state = createGame({
      players: [{ name: 'Ann', photo: PHOTO }, { name: 'Bo' }],
      deck: deckOf([1960, 1970, 1980]),
    });
    const back = deserialize(serialize(state));
    expect(back.players[0].photo).toBe(PHOTO);
    expect(back.players[0].color).toBe(SEAT_COLORS[0]);
    expect(back.players[1].photo).toBeNull();
    expect(back.players[1].color).toBe(SEAT_COLORS[1]);
  });

  it('backfills a save written before avatars existed', () => {
    const state = createGame({ players: ['Ann', 'Bo'], deck: deckOf([1960, 1970, 1980]) });
    const legacy = JSON.parse(serialize(state)) as GameState;
    for (const p of legacy.players) {
      delete (p as Partial<typeof p>).photo;
      delete (p as Partial<typeof p>).color;
    }
    const back = deserialize(legacy);
    expect(back.players.map((p) => p.photo)).toEqual([null, null]);
    expect(back.players.map((p) => p.color)).toEqual([SEAT_COLORS[0], SEAT_COLORS[1]]);
    // Backfilling must not disturb anything else about the save.
    expect(back.turn).toBe(state.turn);
    expect(back.deck.map((c) => c.id)).toEqual(state.deck.map((c) => c.id));
    // ...and it must not mutate the object it was handed.
    expect((legacy.players[0] as Partial<GameState['players'][number]>).color).toBeUndefined();
  });

  it('puts the photo and the seat colour on every scoreboard row', () => {
    const state = game({
      players: ['Ann', 'Bo', 'Cy'],
      timelines: [[1960], [1960, 1970, 1980], [1960, 1970]],
    });
    const withPhoto = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, photo: PHOTO } : p)),
    };
    const rows = scoreboard(withPhoto);
    // Rows come back ranked, so the accent has to follow the seat, not the row.
    expect(rows.map((r) => r.playerId)).toEqual(['p2', 'p3', 'p1']);
    expect(rows.map((r) => r.color)).toEqual([SEAT_COLORS[1], SEAT_COLORS[2], SEAT_COLORS[0]]);
    expect(rows.map((r) => r.photo)).toEqual([null, null, PHOTO]);
  });
});

/* -------------------------------------------------------------------------- */
/* Seeded shuffle                                                              */
/* -------------------------------------------------------------------------- */

describe('seeded randomness', () => {
  it('matches the reference mulberry32 sequence', () => {
    const next = mulberry32(1);
    const seq = [next(), next(), next(), next()];
    expect(seq).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    ]);
    expect(mulberry32(1)()).toBe(seq[0]);
    expect(mulberry32(2)()).not.toBe(seq[0]);
  });

  it('shuffles to a fixed permutation for a fixed cursor', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 1).items).toEqual([3, 2, 7, 8, 5, 4, 1, 6]);
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 1).items).toEqual(
      shuffle([1, 2, 3, 4, 5, 6, 7, 8], 1).items,
    );
  });

  it('never loses or duplicates a card', () => {
    const source = deckOf([1955, 1962, 1971, 1984, 1991, 1999, 2004, 2013, 2020]);
    const out = shuffle(source, 12345);
    expect(out.items).toHaveLength(source.length);
    expect(out.items.map((c) => c.id).sort()).toEqual(source.map((c) => c.id).sort());
    // The input array is untouched.
    expect(source.map((c) => c.id)).toEqual(source.map((c) => c.id));
  });

  it('deals identically for the same seed and differently for another', () => {
    const deck = deckOf([1955, 1962, 1971, 1984, 1991, 1999, 2004, 2013, 2020, 1968, 1977, 2008]);
    const players = ['Ann', 'Bo', 'Cy', 'Dee'];
    const a = createGame({ players, deck, seed: 42 });
    const b = createGame({ players, deck, seed: 42 });
    const c = createGame({ players, deck, seed: 43 });

    expect(serialize(a)).toEqual(serialize(b));
    expect(a.deck.map((x) => x.id)).toEqual(b.deck.map((x) => x.id));
    expect(a.deck.map((x) => x.id)).not.toEqual(c.deck.map((x) => x.id));
  });
});

/* -------------------------------------------------------------------------- */
/* Turn machine                                                                */
/* -------------------------------------------------------------------------- */

describe('turn phases', () => {
  it('walks turn-start -> listening -> placing -> revealed -> turn-start', () => {
    const start = game({ timelines: [[1980], [1970], [1990]], deck: deckOf([1985, 1995]) });
    expect(start.phase).toBe('turn-start');

    const drawn = reduce(start, { type: ACTIONS.DRAW });
    expect(drawn.phase).toBe('listening');
    expect(drawn.card?.year).toBe(1985);
    expect(deckRemaining(drawn)).toBe(1);

    const selected = reduce(drawn, { type: ACTIONS.SELECT_GAP, gapIndex: 1 });
    expect(selected.phase).toBe('placing');
    expect(selected.selectedGap).toBe(1);
    expect(selected.placementCommitted).toBe(false);

    const committed = reduce(selected, { type: ACTIONS.COMMIT_PLACEMENT });
    expect(committed.placementCommitted).toBe(true);
    expect(committed.committedGap).toBe(1);

    const revealed = reduce(committed, { type: ACTIONS.REVEAL });
    expect(revealed.phase).toBe('revealed');
    expect(outcomeOf(revealed).accepted).toBe(true);
    expect(years(revealed.players[0].timeline)).toEqual([1980, 1985]);

    const next = reduce(revealed, { type: ACTIONS.NEXT_TURN });
    expect(next.phase).toBe('turn-start');
    expect(currentPlayerId(next)).toBe('p2');
    expect(next.card).toBeNull();
    expect(next.outcome).toBeNull();
    expect(next.revealBase).toBeNull();
  });

  it('rotates clockwise and increments the turn counter', () => {
    let state = game({
      timelines: [[1980], [1970], [1990]],
      deck: deckOf([1985, 1975, 1995, 2005]),
    });
    expect(currentPlayerId(state)).toBe('p1');
    for (const expected of ['p2', 'p3', 'p1']) {
      state = reduce(playTo(state, 0), { type: ACTIONS.NEXT_TURN });
      expect(currentPlayerId(state)).toBe(expected);
    }
    expect(state.turn).toBe(4);
  });

  it('locks the placement once committed', () => {
    const state = dispatch(game({ deck: [card(1985)] }), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
    ]);
    const reselect = reduce(state, { type: ACTIONS.SELECT_GAP, gapIndex: 1 });
    expect(reselect.lastError?.reason).toMatch(/already committed/);
    expect(reselect.committedGap).toBe(0);
    const recommit = reduce(state, { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 });
    expect(recommit.lastError).not.toBeNull();
    expect(recommit.committedGap).toBe(0);
  });

  it('refuses to reveal before a placement is committed', () => {
    const drawn = reduce(game({ deck: [card(1985)] }), { type: ACTIONS.DRAW });
    const early = reduce(drawn, { type: ACTIONS.REVEAL });
    expect(early.phase).toBe('listening');
    expect(early.lastError?.reason).toMatch(/commit a placement/);
  });

  it('rejects gaps outside the timeline', () => {
    const drawn = reduce(game({ timelines: [[1980], [1970], [1990]], deck: [card(1985)] }), {
      type: ACTIONS.DRAW,
    });
    for (const gapIndex of [-1, 2, 1.5]) {
      const bad = reduce(drawn, { type: ACTIONS.SELECT_GAP, gapIndex });
      expect(bad.lastError?.reason).toMatch(/outside the timeline/);
      expect(bad.selectedGap).toBeNull();
    }
  });

  it('discards a wrong placement and leaves the timeline alone', () => {
    const state = game({ timelines: [[1980], [1970], [1990]], deck: [card(1990)] });
    const revealed = playTo(state, 0);
    const outcome = outcomeOf(revealed);
    expect(outcome.placementCorrect).toBe(false);
    expect(outcome.accepted).toBe(false);
    expect(outcome.destination).toBe('discard');
    expect(years(revealed.players[0].timeline)).toEqual([1980]);
    expect(years(revealed.discard)).toEqual([1990]);
  });

  it('inserts an accepted card exactly at the chosen gap, ties included', () => {
    const state = game({ timelines: [[1970, 1980, 1990], [1970], [1990]], deck: [card(1980)] });
    const left = playTo(state, 1);
    expect(outcomeOf(left).accepted).toBe(true);
    expect(left.players[0].timeline[1].year).toBe(1980);
    expect(years(left.players[0].timeline)).toEqual([1970, 1980, 1980, 1990]);

    const right = playTo(state, 2);
    expect(outcomeOf(right).accepted).toBe(true);
    expect(years(right.players[0].timeline)).toEqual([1970, 1980, 1980, 1990]);
    // The tie went in on the far side of the existing 1980, so the ids differ.
    expect(left.players[0].timeline[1].id).not.toBe(right.players[0].timeline[1].id);
  });

  it('swaps in a replacement card on SKIP_CARD and refunds challenge tokens', () => {
    const state = game({
      timelines: [[1980], [1970], [1990]],
      deck: deckOf([1985, 1995]),
    });
    const challenged = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.SELECT_GAP, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
    ]);
    expect(tokensFor(challenged, 'p2')).toBe(1);

    const skipped = reduce(challenged, { type: ACTIONS.SKIP_CARD });
    expect(skipped.phase).toBe('listening');
    expect(skipped.card?.year).toBe(1995);
    expect(years(skipped.discard)).toEqual([1985]);
    expect(skipped.challenges).toEqual([]);
    expect(tokensFor(skipped, 'p2')).toBe(2);
    expect(skipped.claimIdentify).toBe(false);
    expect(skipped.selectedGap).toBeNull();
  });

  it('ends the turn when there is nothing left to skip to', () => {
    const state = game({ deck: [card(1985)] });
    const skipped = dispatch(state, [{ type: ACTIONS.DRAW }, { type: ACTIONS.SKIP_CARD }]);
    expect(skipped.phase).toBe('turn-end');
    expect(outcomeOf(skipped).kind).toBe('skip');
    expect(deckRemaining(skipped)).toBe(0);
    const over = reduce(skipped, { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(resultOf(over).reason).toBe('deck-exhausted');
  });
});

/* -------------------------------------------------------------------------- */
/* Token economy                                                               */
/* -------------------------------------------------------------------------- */

describe('token economy', () => {
  it('awards one token for a confirmed identify claim, whatever the placement did', () => {
    const state = game({ timelines: [[1980], [1970], [1990]], deck: [card(1990)] });
    const revealed = playTo(state, 0, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]);
    expect(outcomeOf(revealed).placementCorrect).toBe(false);

    const confirmed = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(tokensFor(confirmed, 'p1')).toBe(3);
    expect(outcomeOf(confirmed).identifyAwarded).toBe(true);
    expect(outcomeOf(confirmed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 1, reason: 'identify', pool: 'player' },
    ]);
    // The placement is still wrong; the token is not a consolation for the card.
    expect(years(confirmed.players[0].timeline)).toEqual([1980]);
  });

  it('awards nothing when the group says no', () => {
    const state = game({ deck: [card(1985)] });
    const revealed = playTo(state, 0, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]);
    const denied = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: false });
    expect(tokensFor(denied, 'p1')).toBe(2);
    expect(outcomeOf(denied).identifyAwarded).toBe(false);
  });

  it('will not confirm an identify claim that was never made', () => {
    const revealed = playTo(game({ deck: [card(1985)] }), 0);
    const bogus = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(bogus.lastError?.reason).toMatch(/did not claim/);
    expect(tokensFor(bogus, 'p1')).toBe(2);
  });

  it('holds the identify award at the cap', () => {
    const state = game({
      timelines: [[1980], [1970], [1990]],
      tokens: [5, 2, 2],
      deck: [card(1985)],
      tokenCap: 5,
    });
    const revealed = playTo(state, 1, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]);
    const confirmed = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(tokensFor(confirmed, 'p1')).toBe(5);
    expect(outcomeOf(confirmed).identifyAwarded).toBe(true);
    // The claim was honoured, but the pool did not move - and the award has to
    // say so. A reveal screen promising "+1" next to a token row that visibly
    // stayed at five reads, at a table, as the game quietly robbing somebody.
    expect(outcomeOf(confirmed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 0, reason: 'identify', pool: 'player' },
    ]);
  });

  it('reports the shared pool the same way when co-op is already at the cap', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1980],
      sharedTokens: 5,
      tokenCap: 5,
      deck: [card(1985)],
    });
    const confirmed = dispatch(
      playTo(state, 1, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]),
      [{ type: ACTIONS.CONFIRM_IDENTIFY, ok: true }],
    );
    expect(confirmed.sharedTokens).toBe(5);
    expect(outcomeOf(confirmed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 0, reason: 'identify', pool: 'shared' },
    ]);
  });

  it('still reports the full award when there is room for it', () => {
    const state = game({ tokens: [4, 2, 2], tokenCap: 5, deck: [card(1985)] });
    const confirmed = dispatch(
      playTo(state, 1, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]),
      [{ type: ACTIONS.CONFIRM_IDENTIFY, ok: true }],
    );
    expect(tokensFor(confirmed, 'p1')).toBe(5);
    expect(outcomeOf(confirmed).tokenAwards[0].delta).toBe(1);
  });

  it('buys a card at exactly three tokens and ends the turn', () => {
    const state = game({
      timelines: [[1970, 1990], [1970], [1990]],
      tokens: [3, 2, 2],
      deck: [card(1980), card(2000)],
    });
    expect(canBuy(state)).toBe(true);
    const bought = reduce(state, { type: ACTIONS.BUY_CARD });
    expect(tokensFor(bought, 'p1')).toBe(0);
    expect(years(bought.players[0].timeline)).toEqual([1970, 1980, 1990]);
    expect(bought.phase).toBe('turn-end');
    expect(outcomeOf(bought).kind).toBe('buy');
    expect(outcomeOf(bought).tokensSpent).toBe(3);
    expect(deckRemaining(bought)).toBe(1);

    const next = reduce(bought, { type: ACTIONS.NEXT_TURN });
    expect(currentPlayerId(next)).toBe('p2');
    expect(next.phase).toBe('turn-start');
  });

  it('refuses to buy at two tokens', () => {
    const state = game({ tokens: [2, 2, 2], deck: [card(1980)] });
    expect(canBuy(state)).toBe(false);
    expect(state.deck).toHaveLength(1);
    const blocked = reduce(state, { type: ACTIONS.BUY_CARD });
    expect(blocked.lastError?.reason).toMatch(/3 tokens/);
    expect(core(blocked)).toEqual(core(state));
  });

  it('refuses to buy once the card has been drawn', () => {
    const state = game({ tokens: [4, 2, 2], deck: deckOf([1980, 1990]) });
    const drawn = reduce(state, { type: ACTIONS.DRAW });
    const blocked = reduce(drawn, { type: ACTIONS.BUY_CARD });
    expect(blocked.lastError?.reason).toMatch(/start of a turn/);
    expect(tokensFor(blocked, 'p1')).toBe(4);
  });

  it('explains why the buy button is dead', () => {
    expect(canBuy(game({ tokens: [3, 2, 2], deck: [card(1980)] }))).toBe(true);
    const poor = game({ tokens: [1, 2, 2], deck: [card(1980)] });
    expect(canBuy(poor)).toBe(false);
    const empty = game({ tokens: [5, 2, 2], deck: [] });
    expect(canBuy(empty)).toBe(false);
  });

  it('spends a challenge token the moment the challenge is lodged, and refunds a retraction', () => {
    const state = game({ timelines: [[1980], [1970], [1990]], deck: [card(1985)] });
    const drawn = reduce(state, { type: ACTIONS.DRAW });
    const challenged = reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 });
    expect(tokensFor(challenged, 'p2')).toBe(1);
    expect(challengeFor(challenged, 'p2')).toEqual({ playerId: 'p2', gapIndex: 1 });

    const retracted = reduce(challenged, { type: ACTIONS.REMOVE_CHALLENGE, playerId: 'p2' });
    expect(tokensFor(retracted, 'p2')).toBe(2);
    expect(retracted.challenges).toEqual([]);
    expect(challengeFor(retracted, 'p2')).toBeNull();

    const nothingToRemove = reduce(retracted, { type: ACTIONS.REMOVE_CHALLENGE, playerId: 'p3' });
    expect(nothingToRemove.lastError?.reason).toMatch(/has not challenged/);
  });

  it('will not let a broke player challenge', () => {
    const state = game({ tokens: [2, 0, 2], deck: [card(1985)] });
    const drawn = reduce(state, { type: ACTIONS.DRAW });
    expect(canChallenge(drawn, 'p2')).toBe(false);
    expect(challengeBlockedReason(drawn, 'p2')).toMatch(/1 token/);
    const blocked = reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 });
    expect(blocked.challenges).toEqual([]);
    expect(core(blocked)).toEqual(core(drawn));
  });

  it('does not re-spend or refund challenge tokens during the reveal', () => {
    const state = game({ timelines: [[1980], [1970], [1990]], deck: [card(1985)] });
    const revealed = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(tokensFor(revealed, 'p2')).toBe(1);
    const confirmed = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(tokensFor(confirmed, 'p2')).toBe(1);
    expect(tokensFor(confirmed, 'p1')).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Challenges                                                                  */
/* -------------------------------------------------------------------------- */

describe('challenges', () => {
  const FOUR = ['Ann', 'Bo', 'Cy', 'Dee'];

  function fourPlayerGame(over: Partial<SetupOptions> = {}): GameState {
    return game({
      players: FOUR,
      timelines: [[1980], [1970], [1970], [1970]],
      deck: [card(1990)],
      ...over,
    });
  }

  it('hands the card to the earliest correct challenger clockwise from the active seat', () => {
    // Ann places 1990 before her 1980 card: wrong. Cy challenges first, but Bo
    // sits directly to Ann's left, so Bo takes the card.
    const revealed = dispatch(fourPlayerGame(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p4', gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    const outcome = outcomeOf(revealed);
    expect(outcome.placementCorrect).toBe(false);
    expect(outcome.destination).toBe('challenger');
    expect(outcome.stolenBy).toBe('p2');
    expect(years(timelineFor(revealed, 'p2'))).toEqual([1970, 1990]);
    expect(years(timelineFor(revealed, 'p3'))).toEqual([1970]);
    expect(years(timelineFor(revealed, 'p1'))).toEqual([1980]);
    expect(revealed.discard).toEqual([]);

    const byPlayer = Object.fromEntries(outcome.challenges.map((c) => [c.playerId, c]));
    expect(byPlayer.p2).toMatchObject({ seatOffset: 0, correct: true, won: true, resolved: true });
    expect(byPlayer.p3).toMatchObject({ seatOffset: 1, correct: true, won: false });
    expect(byPlayer.p4).toMatchObject({ seatOffset: 2, correct: false, won: false });
    // All three paid, win or lose.
    for (const id of ['p2', 'p3', 'p4']) expect(tokensFor(revealed, id)).toBe(1);
  });

  it('respects seat order when the active player is not seat zero', () => {
    // Cy is active, so priority runs Dee -> Ann -> Bo.
    const base = fourPlayerGame({
      timelines: [[1970], [1970], [1980], [1970]],
      activeIndex: 2,
    });
    const deeWins = dispatch(base, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p1', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p4', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(deeWins).stolenBy).toBe('p4');
    expect(years(timelineFor(deeWins, 'p4'))).toEqual([1970, 1990]);

    // With Dee out of the picture the wrap-around puts Ann ahead of Bo.
    const annWins = dispatch(base, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p1', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p4', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(annWins).stolenBy).toBe('p1');
  });

  it('discards the card when every challenger is also wrong', () => {
    const revealed = dispatch(fourPlayerGame(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(revealed).stolenBy).toBeNull();
    expect(outcomeOf(revealed).destination).toBe('discard');
    expect(years(revealed.discard)).toEqual([1990]);
    expect(tokensFor(revealed, 'p2')).toBe(1);
    expect(tokensFor(revealed, 'p3')).toBe(1);
  });

  it('burns the token of anyone who challenges a correct placement', () => {
    const revealed = dispatch(fourPlayerGame(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    const outcome = outcomeOf(revealed);
    expect(outcome.placementCorrect).toBe(true);
    expect(outcome.destination).toBe('timeline');
    expect(years(timelineFor(revealed, 'p1'))).toEqual([1980, 1990]);
    // The challenger's own guess was right, but it never got to matter.
    expect(outcome.challenges[0]).toMatchObject({ correct: true, won: false, resolved: false });
    expect(tokensFor(revealed, 'p2')).toBe(1);
    expect(years(timelineFor(revealed, 'p2'))).toEqual([1970]);
  });

  it('allows only one challenge per player', () => {
    const once = dispatch(fourPlayerGame(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
    ]);
    const twice = reduce(once, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 });
    expect(twice.lastError?.reason).toMatch(/already challenged/);
    expect(twice.challenges).toHaveLength(1);
    expect(twice.challenges[0].gapIndex).toBe(1);
    expect(tokensFor(twice, 'p2')).toBe(1);
    expect(canChallenge(once, 'p2')).toBe(false);
  });

  it('will not let the active player challenge themselves', () => {
    const drawn = reduce(fourPlayerGame(), { type: ACTIONS.DRAW });
    const bad = reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p1', gapIndex: 0 });
    expect(bad.lastError?.reason).toMatch(/own placement/);
    expect(canChallenge(drawn, 'p1')).toBe(false);
    expect(core(bad)).toEqual(core(drawn));
  });

  it('requires a real player and a real gap in that player\'s own timeline', () => {
    const drawn = reduce(fourPlayerGame(), { type: ACTIONS.DRAW });
    expect(reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'nope', gapIndex: 0 }).lastError)
      .not.toBeNull();
    // p2 has one card, so gap 2 does not exist for them.
    const outOfRange = reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 2 });
    expect(outOfRange.lastError?.reason).toMatch(/nominate a gap/);
    expect(outOfRange.challenges).toEqual([]);
    expect(tokensFor(outOfRange, 'p2')).toBe(2);
  });

  it('closes challenges once the card is revealed', () => {
    const revealed = dispatch(fourPlayerGame(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(canChallenge(revealed, 'p2')).toBe(false);
    const late = reduce(revealed, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 });
    expect(late.lastError?.reason).toMatch(/Challenges|challenges/);
    expect(late.challenges).toEqual([]);
  });

  it('lets a stolen card win the game for the challenger', () => {
    const state = game({
      players: FOUR,
      targetCards: 2,
      timelines: [[1980], [1970], [1970], [1970]],
      deck: [card(1990)],
    });
    const revealed = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(pendingResult(revealed)).toMatchObject({ reason: 'target', winnerIds: ['p2'] });
    const over = reduce(revealed, { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(winner(over)?.id).toBe('p2');
  });
});

/* -------------------------------------------------------------------------- */
/* Modes                                                                       */
/* -------------------------------------------------------------------------- */

describe('modes', () => {
  it('classic scores on the placement alone', () => {
    const state = game({ mode: 'classic', timelines: [[1980], [1970], [1990]], deck: [card(1985)] });
    const revealed = playTo(state, 1);
    expect(outcomeOf(revealed).requirementsMet).toBe(true);
    expect(outcomeOf(revealed).accepted).toBe(true);
    const noGate = reduce(revealed, { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: false, artist: false });
    expect(noGate.lastError?.reason).toMatch(/advanced and expert/);
  });

  it('advanced needs the title and the artist as well as the gap', () => {
    const state = game({
      mode: 'advanced',
      timelines: [[1980], [1970], [1990]],
      deck: [card(1985)],
    });
    const revealed = playTo(state, 1);
    // Correct gap, but nobody has confirmed the naming yet.
    expect(outcomeOf(revealed).placementCorrect).toBe(true);
    expect(outcomeOf(revealed).accepted).toBe(false);
    expect(years(revealed.discard)).toEqual([1985]);

    const halfway = reduce(revealed, { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true });
    expect(outcomeOf(halfway).accepted).toBe(false);

    const named = reduce(halfway, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: true });
    expect(outcomeOf(named).accepted).toBe(true);
    expect(years(timelineFor(named, 'p1'))).toEqual([1980, 1985]);
    expect(named.discard).toEqual([]);

    // Toggling back must not leave a duplicate behind: the reveal is recomputed,
    // not layered.
    const undone = reduce(named, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: false });
    expect(outcomeOf(undone).accepted).toBe(false);
    expect(years(timelineFor(undone, 'p1'))).toEqual([1980]);
    expect(years(undone.discard)).toEqual([1985]);
  });

  it('advanced still discards the card when the gap was wrong but the naming was right', () => {
    const state = game({
      mode: 'advanced',
      timelines: [[1980], [1970], [1990]],
      deck: [card(1990)],
    });
    const revealed = reduce(playTo(state, 0), {
      type: ACTIONS.CONFIRM_TITLE_ARTIST,
      title: true,
      artist: true,
    });
    expect(outcomeOf(revealed).requirementsMet).toBe(true);
    expect(outcomeOf(revealed).placementCorrect).toBe(false);
    expect(outcomeOf(revealed).accepted).toBe(false);
  });

  it('expert also demands the exact year', () => {
    const state = game({ mode: 'expert', timelines: [[1980], [1970], [1990]], deck: [card(1985)] });
    const named: Action[] = [{ type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true }];

    const wrongYear = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1984 }]), named);
    expect(outcomeOf(wrongYear).yearGuessCorrect).toBe(false);
    expect(outcomeOf(wrongYear).accepted).toBe(false);

    const noYear = dispatch(playTo(state, 1), named);
    expect(outcomeOf(noYear).accepted).toBe(false);

    const exact = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1985 }]), named);
    expect(outcomeOf(exact).yearGuessCorrect).toBe(true);
    expect(outcomeOf(exact).accepted).toBe(true);
    expect(years(timelineFor(exact, 'p1'))).toEqual([1980, 1985]);

    // A perfect year does not rescue a fluffed artist.
    const unnamed = playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1985 }]);
    const partial = reduce(unnamed, { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: false });
    expect(outcomeOf(partial).accepted).toBe(false);
  });

  it('says which half of expert was missed, so the reveal cannot blame the wrong one', () => {
    const state = game({ mode: 'expert', timelines: [[1980], [1970], [1990]], deck: [card(1985)] });
    const named: Action[] = [{ type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true }];

    // Right gap, right names, wrong year. The outcome has to be separable from
    // "you never named it" - they are the same `accepted: false` otherwise, and
    // the reveal screen would tell somebody who nailed the artist that they had
    // to name it too.
    const missedYear = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1984 }]), named);
    const missed = outcomeOf(missedYear);
    expect(missed.placementCorrect).toBe(true);
    expect([missed.titleOk, missed.artistOk]).toEqual([true, true]);
    expect(missed.yearGuessCorrect).toBe(false);
    expect(missed.yearGuess).toBe(1984);
    expect(missed.requirementsMet).toBe(false);

    // Right gap, right year, no names: the mirror image, and it must not look
    // like a missed year.
    const missedName = playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1985 }]);
    const unnamed = outcomeOf(missedName);
    expect(unnamed.placementCorrect).toBe(true);
    expect([unnamed.titleOk, unnamed.artistOk]).toEqual([null, null]);
    expect(unnamed.yearGuessCorrect).toBe(true);
    expect(unnamed.requirementsMet).toBe(false);
  });

  it('lets the year guess be cleared and rejects nonsense guesses', () => {
    const drawn = reduce(game({ mode: 'expert', deck: [card(1985)] }), { type: ACTIONS.DRAW });
    const guessed = reduce(drawn, { type: ACTIONS.SET_YEAR_GUESS, year: 1985 });
    expect(guessed.yearGuess).toBe(1985);
    expect(reduce(guessed, { type: ACTIONS.SET_YEAR_GUESS, year: null }).yearGuess).toBeNull();
    const bad = reduce(guessed, { type: ACTIONS.SET_YEAR_GUESS, year: 1985.5 });
    expect(bad.lastError).not.toBeNull();
    expect(bad.yearGuess).toBe(1985);
  });

  it('co-op shares one timeline, one token pool and a rotating placer', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1980],
      sharedTokens: 2,
      deck: deckOf([1985, 1975]),
    });
    expect(currentPlayerId(state)).toBe('p1');

    const first = reduce(playTo(state, 1), { type: ACTIONS.NEXT_TURN });
    expect(years(first.sharedTimeline)).toEqual([1980, 1985]);
    expect(first.players.every((p) => p.timeline.length === 0)).toBe(true);
    expect(currentPlayerId(first)).toBe('p2');
    expect(first.mistakes).toBe(0);

    // Everyone reads the same pile.
    for (const p of first.players) {
      expect(years(timelineFor(first, p.id))).toEqual([1980, 1985]);
      expect(tokensFor(first, p.id)).toBe(2);
    }

    const second = playTo(first, 0);
    expect(years(second.sharedTimeline)).toEqual([1975, 1980, 1985]);
  });

  it('co-op spends and earns from the shared pool', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1980],
      sharedTokens: 3,
      deck: deckOf([1985, 1975]),
    });
    const drawn = reduce(state, { type: ACTIONS.DRAW });
    const challenged = reduce(drawn, { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 });
    expect(challenged.sharedTokens).toBe(2);
    expect(tokensFor(challenged, 'p3')).toBe(2);

    const revealed = dispatch(challenged, [
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.REVEAL },
      { type: ACTIONS.CONFIRM_IDENTIFY, ok: true },
    ]);
    expect(revealed.sharedTokens).toBe(3);
    expect(outcomeOf(revealed).tokenAwards[0].pool).toBe('shared');

    const buyer = game({ mode: 'coop', sharedTimeline: [1980], sharedTokens: 3, deck: [card(1975)] });
    const bought = reduce(buyer, { type: ACTIONS.BUY_CARD });
    expect(bought.sharedTokens).toBe(0);
    expect(years(bought.sharedTimeline)).toEqual([1975, 1980]);
  });

  it('co-op counts a lost card as a mistake and loses at the limit', () => {
    let state = game({
      mode: 'coop',
      mistakeLimit: 2,
      sharedTimeline: [1980],
      deck: deckOf([1990, 1990]),
    });
    state = reduce(playTo(state, 0), { type: ACTIONS.NEXT_TURN });
    expect(state.mistakes).toBe(1);
    expect(state.phase).toBe('turn-start');
    expect(currentPlayerId(state)).toBe('p2');

    const second = playTo(state, 0);
    expect(second.mistakes).toBe(2);
    expect(outcomeOf(second).mistakeRecorded).toBe(true);
    expect(pendingResult(second)).toMatchObject({ reason: 'mistake-limit' });

    const over = reduce(second, { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(isGameOver(over)).toBe(true);
    expect(resultOf(over)).toEqual({
      reason: 'mistake-limit',
      winnerIds: [],
      shared: false,
      coopWon: false,
    });
    expect(winners(over)).toEqual([]);
  });

  it('co-op treats a rescued card as no mistake at all', () => {
    const state = game({
      mode: 'coop',
      mistakeLimit: 2,
      sharedTimeline: [1980],
      sharedTokens: 2,
      deck: [card(1990)],
    });
    const revealed = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(revealed).stolenBy).toBe('p2');
    expect(revealed.mistakes).toBe(0);
    expect(years(revealed.sharedTimeline)).toEqual([1980, 1990]);
    expect(revealed.sharedTokens).toBe(1);
  });

  it('co-op wins for everyone at the target', () => {
    const state = game({
      mode: 'coop',
      targetCards: 2,
      sharedTimeline: [1980],
      deck: deckOf([1985, 1975]),
    });
    const revealed = playTo(state, 1);
    expect(pendingResult(revealed)).toMatchObject({ reason: 'target', coopWon: true });
    const over = reduce(revealed, { type: ACTIONS.NEXT_TURN });
    expect(resultOf(over)).toEqual({
      reason: 'target',
      winnerIds: ['p1', 'p2', 'p3'],
      shared: true,
      coopWon: true,
    });
    expect(winner(over)).toBeNull();
    expect(winners(over).map((p) => p.name)).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('co-op running out of cards short of the target is not a win', () => {
    const state = game({
      mode: 'coop',
      targetCards: 5,
      sharedTimeline: [1980],
      deck: [card(1985)],
    });
    const over = reduce(playTo(state, 1), { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(resultOf(over)).toEqual({
      reason: 'deck-exhausted',
      winnerIds: [],
      shared: false,
      coopWon: false,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Token cap                                                                   */
/* -------------------------------------------------------------------------- */

describe('token cap', () => {
  const DECK = () => deckOf([1960, 1970, 1980, 1990]);

  it('is five, and six for the shared co-op pool', () => {
    expect(TOKEN_CAP).toBe(5);
    expect(COOP_TOKEN_CAP).toBe(6);
    for (const mode of MODES) {
      expect(defaultTokenCap(mode)).toBe(mode === 'coop' ? 6 : 5);
    }
    for (const mode of MODES) {
      const state = createGame({ players: ['Ann', 'Bo'], deck: DECK(), mode });
      expect(state.tokenCap).toBe(mode === 'coop' ? 6 : 5);
    }
  });

  it('lets an explicit cap win in either direction', () => {
    const small = createGame({ players: ['Ann', 'Bo'], deck: DECK(), mode: 'coop', tokenCap: 5 });
    expect(small.tokenCap).toBe(5);
    const big = createGame({ players: ['Ann', 'Bo'], deck: DECK(), tokenCap: 9 });
    expect(big.tokenCap).toBe(9);
  });

  it('lets the co-op pool actually reach six', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1980],
      sharedTokens: 5,
      deck: [card(1985)],
    });
    expect(state.tokenCap).toBe(6);
    const confirmed = dispatch(
      playTo(state, 1, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]),
      [{ type: ACTIONS.CONFIRM_IDENTIFY, ok: true }],
    );
    expect(confirmed.sharedTokens).toBe(6);
    expect(outcomeOf(confirmed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 1, reason: 'identify', pool: 'shared' },
    ]);
  });

  it('still holds a competitive hand at five', () => {
    const state = game({ tokens: [5, 2, 2], deck: [card(1985)] });
    expect(state.tokenCap).toBe(5);
    const confirmed = dispatch(
      playTo(state, 1, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]),
      [{ type: ACTIONS.CONFIRM_IDENTIFY, ok: true }],
    );
    expect(tokensFor(confirmed, 'p1')).toBe(5);
    expect(outcomeOf(confirmed).tokenAwards[0].delta).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Streak bonus (house rule)                                                   */
/* -------------------------------------------------------------------------- */

describe('streak bonus', () => {
  /** One player, so every turn is the same player's - the honest way to build a run. */
  function solo(over: Partial<SetupOptions> = {}): GameState {
    return game({
      players: ['Ann'],
      streakBonus: true,
      timelines: [[1980]],
      deck: deckOf([1985, 1986, 1987, 1988, 1989, 1990]),
      ...over,
    });
  }

  /** Commit the first gap that fits the card already in play, then reveal. */
  function commitRight(state: GameState): GameState {
    const activeId = currentPlayerId(state) as string;
    const gap = correctGapsFor(timelineFor(state, activeId), state.card?.year as number)[0];
    return dispatch(state, [
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: gap },
      { type: ACTIONS.REVEAL },
    ]);
  }

  function placeRight(state: GameState): GameState {
    return commitRight(reduce(state, { type: ACTIONS.DRAW }));
  }

  function placeWrong(state: GameState): GameState {
    const drawn = reduce(state, { type: ACTIONS.DRAW });
    const activeId = currentPlayerId(drawn) as string;
    const timeline = timelineFor(drawn, activeId);
    const fits = new Set(correctGapsFor(timeline, drawn.card?.year as number));
    const gap = [...Array(timeline.length + 1).keys()].find((i) => !fits.has(i));
    if (gap === undefined) throw new Error('every gap fits this card');
    return dispatch(drawn, [
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: gap },
      { type: ACTIONS.REVEAL },
    ]);
  }

  const endTurn = (state: GameState): GameState => reduce(state, { type: ACTIONS.NEXT_TURN });
  const nameIt: Action[] = [{ type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true }];

  it('is off unless the setup screen asks for it', () => {
    expect(createGame({ players: ['Ann'], deck: deckOf([1960, 1970]) }).streakBonus).toBe(false);
    expect(() =>
      createGame({
        players: ['Ann'],
        deck: deckOf([1960, 1970]),
        streakBonus: 'yes' as unknown as boolean,
      }),
    ).toThrow(TypeError);
  });

  it('counts nothing at all while it is off', () => {
    let state = solo({ streakBonus: false });
    for (let i = 0; i < 4; i += 1) state = endTurn(placeRight(state));
    expect(tokensFor(state, 'p1')).toBe(2);
    expect(state.players[0].streakRun).toBe(0);
    expect(streakFor(state, 'p1')).toEqual({
      enabled: false,
      run: 0,
      needed: STREAK_LENGTH,
      toGo: STREAK_LENGTH,
    });
  });

  it('pays on the third card kept in a row and starts the run again', () => {
    expect(STREAK_LENGTH).toBe(3);
    expect(STREAK_REWARD).toBe(1);
    let state = solo();

    const first = placeRight(state);
    expect(outcomeOf(first).streakRun).toBe(1);
    expect(outcomeOf(first).streakAwarded).toBe(false);
    expect(streakFor(first, 'p1')).toEqual({ enabled: true, run: 1, needed: 3, toGo: 2 });
    state = endTurn(first);

    const second = placeRight(state);
    expect(outcomeOf(second).streakRun).toBe(2);
    expect(tokensFor(second, 'p1')).toBe(2);
    state = endTurn(second);

    const third = placeRight(state);
    expect(outcomeOf(third).streakAwarded).toBe(true);
    expect(tokensFor(third, 'p1')).toBe(3);
    expect(outcomeOf(third).tokenAwards).toEqual([
      { playerId: 'p1', delta: 1, reason: 'streak', pool: 'player' },
    ]);
    // Reset on payout: the run means "how far into the NEXT bonus you are".
    expect(outcomeOf(third).streakRun).toBe(0);
    expect(streakFor(third, 'p1')).toEqual({ enabled: true, run: 0, needed: 3, toGo: 3 });
    state = endTurn(third);

    // ...so the fourth right card in a row pays nothing.
    const fourth = placeRight(state);
    expect(outcomeOf(fourth).streakAwarded).toBe(false);
    expect(outcomeOf(fourth).streakRun).toBe(1);
    expect(tokensFor(fourth, 'p1')).toBe(3);
  });

  it('ends the run on a wrong placement, and starts the next one from scratch', () => {
    let state = endTurn(placeRight(endTurn(placeRight(solo()))));
    expect(state.players[0].streakRun).toBe(2);

    const missed = placeWrong(state);
    expect(outcomeOf(missed).placementCorrect).toBe(false);
    expect(outcomeOf(missed).streakRun).toBe(0);
    expect(outcomeOf(missed).streakAwarded).toBe(false);
    expect(tokensFor(missed, 'p1')).toBe(2);

    state = endTurn(missed);
    const back = placeRight(state);
    expect(outcomeOf(back).streakRun).toBe(1);
    expect(tokensFor(back, 'p1')).toBe(2);
  });

  it('ends the run on a bought card - buying is a way of not guessing', () => {
    const state = endTurn(placeRight(endTurn(placeRight(solo({ tokens: [3] })))));
    expect(state.players[0].streakRun).toBe(2);

    const bought = reduce(state, { type: ACTIONS.BUY_CARD });
    expect(outcomeOf(bought).kind).toBe('buy');
    expect(outcomeOf(bought).streakAwarded).toBe(false);
    expect(outcomeOf(bought).streakRun).toBe(0);
    expect(bought.players[0].streakRun).toBe(0);
    expect(tokensFor(bought, 'p1')).toBe(0);
  });

  it('leaves the run exactly where it was on a skipped card', () => {
    const state = endTurn(placeRight(endTurn(placeRight(solo()))));
    const skipped = dispatch(state, [{ type: ACTIONS.DRAW }, { type: ACTIONS.SKIP_CARD }]);
    expect(skipped.phase).toBe('listening');
    expect(skipped.players[0].streakRun).toBe(2);

    // Neither advanced nor broken: the replacement card still completes the run.
    const third = commitRight(skipped);
    expect(outcomeOf(third).streakAwarded).toBe(true);
    expect(tokensFor(third, 'p1')).toBe(3);
  });

  it('leaves the run alone when a skip ends the turn for want of a card', () => {
    const state = endTurn(placeRight(solo({ deck: deckOf([1985, 1986]) })));
    expect(state.players[0].streakRun).toBe(1);
    const skipped = dispatch(state, [{ type: ACTIONS.DRAW }, { type: ACTIONS.SKIP_CARD }]);
    expect(skipped.phase).toBe('turn-end');
    expect(outcomeOf(skipped).kind).toBe('skip');
    expect(outcomeOf(skipped).streakRun).toBe(1);
    expect(skipped.players[0].streakRun).toBe(1);
  });

  it('counts kept cards, so advanced does not reward a lucky gap', () => {
    let state = solo({ mode: 'advanced' });
    state = endTurn(dispatch(placeRight(state), nameIt));
    state = endTurn(dispatch(placeRight(state), nameIt));
    expect(state.players[0].streakRun).toBe(2);

    // Right gap, fluffed artist: the card is lost, and so is the run. A green
    // streak note under a red verdict would be the game contradicting itself.
    const fluffed = reduce(placeRight(state), {
      type: ACTIONS.CONFIRM_TITLE_ARTIST,
      title: true,
      artist: false,
    });
    expect(outcomeOf(fluffed).placementCorrect).toBe(true);
    expect(outcomeOf(fluffed).accepted).toBe(false);
    expect(outcomeOf(fluffed).streakAwarded).toBe(false);
    expect(outcomeOf(fluffed).streakRun).toBe(0);
    expect(tokensFor(fluffed, 'p1')).toBe(2);

    // Naming it keeps the card, so the same gap does pay.
    const named = dispatch(placeRight(state), nameIt);
    expect(outcomeOf(named).streakAwarded).toBe(true);
    expect(tokensFor(named, 'p1')).toBe(3);
  });

  it('recomputes the bonus on every vote toggle instead of paying it again', () => {
    let state = solo({ mode: 'advanced' });
    state = endTurn(dispatch(placeRight(state), nameIt));
    state = endTurn(dispatch(placeRight(state), nameIt));

    const paid = dispatch(placeRight(state), [...nameIt, ...nameIt]);
    expect(tokensFor(paid, 'p1')).toBe(3);
    expect(outcomeOf(paid).streakAwarded).toBe(true);

    const undone = reduce(paid, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: false });
    expect(tokensFor(undone, 'p1')).toBe(2);
    expect(outcomeOf(undone).streakAwarded).toBe(false);
    expect(outcomeOf(undone).streakRun).toBe(0);

    const redone = reduce(undone, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: true });
    expect(tokensFor(redone, 'p1')).toBe(3);
    expect(outcomeOf(redone).streakAwarded).toBe(true);
    expect(redone.players[0].streakRun).toBe(0);
  });

  it('holds the bonus at the cap but still spends the run', () => {
    const state = endTurn(placeRight(endTurn(placeRight(solo({ tokens: [5] })))));
    const third = placeRight(state);
    expect(outcomeOf(third).streakAwarded).toBe(true);
    expect(tokensFor(third, 'p1')).toBe(5);
    // Earned, paid, worth nothing - and the award says so rather than promising
    // a token the dots refuse to draw.
    expect(outcomeOf(third).tokenAwards).toEqual([
      { playerId: 'p1', delta: 0, reason: 'streak', pool: 'player' },
    ]);
    expect(outcomeOf(third).streakRun).toBe(0);
  });

  it('stacks with the identify award in the order the tokens are actually paid', () => {
    const state = endTurn(placeRight(endTurn(placeRight(solo({ tokens: [4] })))));
    const revealed = commitRight(
      dispatch(reduce(state, { type: ACTIONS.DRAW }), [
        { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      ]),
    );
    const confirmed = reduce(revealed, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(tokensFor(confirmed, 'p1')).toBe(5);
    // One token of room and two awards: the second one has to report the truth.
    expect(outcomeOf(confirmed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 1, reason: 'identify', pool: 'player' },
      { playerId: 'p1', delta: 0, reason: 'streak', pool: 'player' },
    ]);

    const roomy = endTurn(placeRight(endTurn(placeRight(solo({ tokens: [3] })))));
    const both = reduce(
      commitRight(
        dispatch(reduce(roomy, { type: ACTIONS.DRAW }), [
          { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
        ]),
      ),
      { type: ACTIONS.CONFIRM_IDENTIFY, ok: true },
    );
    expect(tokensFor(both, 'p1')).toBe(5);
    expect(outcomeOf(both).tokenAwards.map((a) => a.delta)).toEqual([1, 1]);
  });

  it('keeps every run personal, so interleaved turns never merge', () => {
    let state = game({
      players: ['Ann', 'Bo'],
      streakBonus: true,
      timelines: [[1980], [1980]],
      deck: deckOf([1985, 1986, 1987, 1988, 1989, 1990]),
    });
    // Ann, Bo, Ann, Bo - four right cards, and nobody has three in a row yet.
    for (let i = 0; i < 4; i += 1) state = endTurn(placeRight(state));
    expect(state.players.map((p) => p.streakRun)).toEqual([2, 2]);
    expect(state.players.map((p) => p.tokens)).toEqual([2, 2]);

    const annPays = placeRight(state);
    expect(currentPlayerId(state)).toBe('p1');
    expect(outcomeOf(annPays).streakAwarded).toBe(true);
    expect(tokensFor(annPays, 'p1')).toBe(3);
    expect(annPays.players[1].streakRun).toBe(2);
    expect(tokensFor(annPays, 'p2')).toBe(2);
  });

  it('does not hand a challenger the run along with the card', () => {
    const table = game({
      players: ['Ann', 'Bo'],
      streakBonus: true,
      timelines: [[1980], [1980]],
      deck: [card(1990)],
    });
    // Bo is two cards into a run of his own when he steals Ann's card.
    const primed = {
      ...table,
      players: table.players.map((p, i) => (i === 1 ? { ...p, streakRun: 2 } : p)),
    };
    const revealed = dispatch(primed, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(revealed).stolenBy).toBe('p2');
    expect(years(timelineFor(revealed, 'p2'))).toEqual([1980, 1990]);
    // The card moved; the run did not, in either direction.
    expect(revealed.players[0].streakRun).toBe(0);
    expect(revealed.players[1].streakRun).toBe(2);
    expect(tokensFor(revealed, 'p2')).toBe(1);
    expect(outcomeOf(revealed).tokenAwards).toEqual([]);
  });

  it('pays a co-op run into the shared pool and leaves personal tokens at zero', () => {
    const table = game({
      mode: 'coop',
      sharedTimeline: [1980],
      sharedTokens: 2,
      streakBonus: true,
      deck: deckOf([1985, 1986]),
    });
    const primed = {
      ...table,
      players: table.players.map((p, i) => (i === 0 ? { ...p, streakRun: 2 } : p)),
    };
    const revealed = placeRight(primed);
    expect(outcomeOf(revealed).streakAwarded).toBe(true);
    expect(revealed.sharedTokens).toBe(3);
    expect(outcomeOf(revealed).tokenAwards).toEqual([
      { playerId: 'p1', delta: 1, reason: 'streak', pool: 'shared' },
    ]);
    expect(revealed.players.map((p) => p.tokens)).toEqual([0, 0, 0]);
    expect(revealed.players.map((p) => p.streakRun)).toEqual([0, 0, 0]);
  });

  it('shows the run on the seat rail and the scoreboard', () => {
    const state = endTurn(placeRight(solo({ players: ['Ann', 'Bo'], timelines: [[1980], [1980]] })));
    expect(state.players[0].streakRun).toBe(1);
    expect(seatStandings(state).map((r) => r.streakRun)).toEqual([1, 0]);
    expect(scoreboard(state).map((r) => r.streakRun)).toEqual([1, 0]);
  });

  it('survives the save, and a save written before the rule existed', () => {
    const state = endTurn(placeRight(solo()));
    expect(state.players[0].streakRun).toBe(1);
    const back = deserialize(serialize(state));
    expect(back.streakBonus).toBe(true);
    expect(back.players[0].streakRun).toBe(1);
    expect(back).toEqual(state);

    const legacy = JSON.parse(serialize(state)) as GameState;
    delete (legacy as Partial<GameState>).streakBonus;
    for (const p of legacy.players) delete (p as Partial<typeof p>).streakRun;
    const old = deserialize(legacy);
    expect(old.streakBonus).toBe(false);
    expect(old.players.map((p) => p.streakRun)).toEqual([0]);
    // ...and the backfill did not touch the object it was handed.
    expect((legacy.players[0] as Partial<GameState['players'][number]>).streakRun).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Per-song miss counts                                                        */
/* -------------------------------------------------------------------------- */

describe('per-song miss counts', () => {
  const FOUR = ['Ann', 'Bo', 'Cy', 'Dee'];

  function table(over: Partial<SetupOptions> = {}): GameState {
    return game({
      players: FOUR,
      timelines: [[1980], [1970], [1970], [1970]],
      deck: [card(1990)],
      ...over,
    });
  }

  it('records nothing while everybody is right', () => {
    const state = table();
    const revealed = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(revealed).placementCorrect).toBe(true);
    expect(outcomeOf(revealed).wrongGuesses).toBe(0);
    expect(revealed.missCounts).toEqual({});
    expect(hardestCard(revealed)).toBeNull();
  });

  it('counts the placement and every wrong challenge against the song', () => {
    const revealed = dispatch(table(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p4', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    const cardId = outcomeOf(revealed).card.id;
    // Ann put it before 1980 and two challengers put it before 1970: three
    // people got this song's spot wrong.
    expect(outcomeOf(revealed).wrongGuesses).toBe(3);
    expect(revealed.missCounts).toEqual({ [cardId]: 3 });
    expect(missCountFor(revealed, cardId)).toBe(3);
    expect(missCountFor(revealed, 'no-such-card')).toBe(0);
  });

  it('counts a wrong challenge even when the placement itself was right', () => {
    const revealed = dispatch(table(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    expect(outcomeOf(revealed).placementCorrect).toBe(true);
    expect(outcomeOf(revealed).wrongGuesses).toBe(1);
    expect(missCountFor(revealed, outcomeOf(revealed).card.id)).toBe(1);
  });

  it('never counts a bought or a skipped card', () => {
    const bought = reduce(table({ tokens: [3, 2, 2, 2], deck: deckOf([1990, 1995]) }), {
      type: ACTIONS.BUY_CARD,
    });
    expect(outcomeOf(bought).wrongGuesses).toBe(0);
    expect(bought.missCounts).toEqual({});

    const skipped = dispatch(table({ deck: deckOf([1990, 1995]) }), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SKIP_CARD },
    ]);
    expect(skipped.missCounts).toEqual({});
  });

  it('counts once however often the reveal is recomputed', () => {
    const state = table({ mode: 'advanced' });
    let revealed = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    const cardId = outcomeOf(revealed).card.id;
    expect(revealed.missCounts).toEqual({ [cardId]: 2 });
    for (const artist of [true, false, true]) {
      revealed = reduce(revealed, { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist });
      expect(revealed.missCounts).toEqual({ [cardId]: 2 });
    }
  });

  it('adds up across turns and finds the hardest song wherever it ended up', () => {
    let state = table({ deck: deckOf([1990, 1995]) });
    state = reduce(
      dispatch(state, [
        { type: ACTIONS.DRAW },
        { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
        { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 0 },
        { type: ACTIONS.REVEAL },
      ]),
      { type: ACTIONS.NEXT_TURN },
    );
    const firstId = state.discard[0].id;
    expect(state.missCounts).toEqual({ [firstId]: 2 });

    const second = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    const secondId = outcomeOf(second).card.id;
    expect(second.missCounts).toEqual({ [firstId]: 2, [secondId]: 1 });

    const hardest = hardestCard(second);
    expect(hardest?.cardId).toBe(firstId);
    expect(hardest?.misses).toBe(2);
    expect(hardest?.tied).toBe(false);
    // The card object comes back too, out of whichever pile it landed in.
    expect(hardest?.card?.id).toBe(firstId);
    expect(hardest?.card?.year).toBe(1990);
  });

  it('breaks a tie on the earliest miss rather than refusing to name one', () => {
    const a = card(1970, 'song-a');
    const b = card(1990, 'song-b');
    const base = game({ deck: [a, b] });
    const tied = { ...base, missCounts: { 'song-a': 2, 'song-b': 2 } };
    expect(hardestCard(tied)).toEqual({ cardId: 'song-a', card: a, misses: 2, tied: true });

    const clear = { ...base, missCounts: { 'song-a': 1, 'song-b': 4 } };
    expect(hardestCard(clear)).toEqual({ cardId: 'song-b', card: b, misses: 4, tied: false });

    // A count for a card no pile holds still reports the count, honestly.
    const orphan = { ...base, missCounts: { ghost: 3 } };
    expect(hardestCard(orphan)).toEqual({ cardId: 'ghost', card: null, misses: 3, tied: false });
  });

  it('round-trips the tally through a save', () => {
    const revealed = dispatch(table(), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.REVEAL },
    ]);
    const back = deserialize(serialize(revealed));
    expect(back.missCounts).toEqual(revealed.missCounts);
    expect(back).toEqual(revealed);

    // A save from before the tallies existed comes back empty, not undefined.
    const legacy = JSON.parse(serialize(revealed)) as GameState;
    delete (legacy as Partial<GameState>).missCounts;
    delete (legacy as Partial<GameState>).challengeWins;
    delete (legacy as Partial<GameState>).skips;
    delete (legacy.revealBase as Partial<NonNullable<GameState['revealBase']>>).missCounts;
    delete (legacy.revealBase as Partial<NonNullable<GameState['revealBase']>>).challengeWins;
    const old = deserialize(legacy);
    expect(old.missCounts).toEqual({});
    expect(old.challengeWins).toEqual({});
    expect(old.skips).toBe(0);
    expect(old.revealBase?.missCounts).toEqual({});
    // ...and the next recompute writes a real tally rather than spreading undefined.
    const toggled = reduce(old, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(toggled.lastError).not.toBeNull();
    expect(JSON.parse(serialize(old)).missCounts).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* Decade strengths                                                            */
/* -------------------------------------------------------------------------- */

describe('decade strengths', () => {
  function strengthOf(timeline: number[]): ReturnType<typeof decadeStrengthFor> {
    return decadeStrengthFor(
      game({ timelines: [timeline, [1970], [1990]] }),
      'p1',
    );
  }

  it('offers the eight buckets the histogram is drawn from', () => {
    expect([...DECADE_STARTS]).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(DECADE_MIN_CARDS).toBe(3);
  });

  it('buckets a timeline into eight counts, in order, always', () => {
    const row = strengthOf([1962, 1965, 1984, 1999, 2001]);
    expect(row.counts.map((c) => c.decade)).toEqual([...DECADE_STARTS]);
    expect(row.counts.map((c) => c.count)).toEqual([0, 2, 0, 1, 1, 1, 0, 0]);
    expect(row.cards).toBe(5);
    expect(row.total).toBe(5);
    expect(row.playerId).toBe('p1');
  });

  it('says "not enough yet" until three cards have landed', () => {
    for (const timeline of [[1984], [1962, 1984]]) {
      const row = strengthOf(timeline);
      expect(row.enough).toBe(false);
      expect(row.best).toBeNull();
      expect(row.dominant).toBe(false);
      // The bars are still real facts, so the histogram has something to draw.
      expect(row.bestCount).toBe(1);
    }
    expect(strengthOf([1962, 1984, 1999]).enough).toBe(true);
  });

  it('separates a decade somebody owns from one they are merely strongest in', () => {
    const strong = strengthOf([1962, 1965, 1971, 1988]);
    expect(strong.best).toBe(1960);
    expect(strong.bestCount).toBe(2);
    expect(strong.total).toBe(4);
    expect(strong.dominant).toBe(false);

    const owned = strengthOf([1981, 1984, 1988, 1999]);
    expect(owned.best).toBe(1980);
    expect(owned.dominant).toBe(true);
    expect(owned.tied).toBe(false);

    // Exactly half is not a majority, so it is not ownership.
    const half = strengthOf([1981, 1984, 1999, 2001]);
    expect(half.dominant).toBe(false);
  });

  it('names the earliest of a tie, and admits it was a tie', () => {
    const row = strengthOf([1962, 1965, 1971, 1974]);
    expect(row.leaders).toEqual([1960, 1970]);
    expect(row.tied).toBe(true);
    expect(row.best).toBe(1960);
    expect(row.dominant).toBe(false);
  });

  it('keeps a card from outside the eight buckets out of the bars', () => {
    const row = strengthOf([1942, 1962, 1965, 1971]);
    expect(row.cards).toBe(4);
    expect(row.total).toBe(3);
    expect(row.counts.map((c) => c.count)).toEqual([0, 2, 1, 0, 0, 0, 0, 0]);
    expect(row.best).toBe(1960);
  });

  it('has nothing to report for an empty timeline', () => {
    const row = decadeStrengthFor(game({ mode: 'coop' }), 'p1');
    expect(row.cards).toBe(1);
    const empty = decadeStrengthFor({ ...game(), players: game().players.map((p) => ({ ...p, timeline: [] })) }, 'p1');
    expect(empty.total).toBe(0);
    expect(empty.bestCount).toBe(0);
    expect(empty.leaders).toEqual([]);
    expect(empty.tied).toBe(false);
    expect(empty.best).toBeNull();
    expect(empty.enough).toBe(false);
  });

  it('reports the shared pile for every player in co-op', () => {
    const state = game({ mode: 'coop', sharedTimeline: [1981, 1984, 1988, 1999] });
    const rows = decadeStrengths(state);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.best).toBe(1980);
      expect(row.dominant).toBe(true);
      expect(row.total).toBe(4);
    }
    expect(rows.map((r) => r.playerId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('is a pure read that works on a frozen state', () => {
    const state = deepFreeze(game({ timelines: [[1962, 1965, 1971], [1970], [1990]] }));
    expect(decadeStrengthFor(state, 'p1').best).toBe(1960);
    expect(decadeStrengths(state)).toHaveLength(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Skips, challenge wins and the game recap                                    */
/* -------------------------------------------------------------------------- */

describe('skipped cards', () => {
  it('counts every skip, with or without a card to swap in', () => {
    const state = game({ deck: deckOf([1985, 1995]) });
    expect(skippedCount(state)).toBe(0);

    const once = dispatch(state, [{ type: ACTIONS.DRAW }, { type: ACTIONS.SKIP_CARD }]);
    expect(skippedCount(once)).toBe(1);
    expect(once.phase).toBe('listening');

    // The last card in the deck has no replacement, and is skipped all the same.
    const twice = reduce(once, { type: ACTIONS.SKIP_CARD });
    expect(skippedCount(twice)).toBe(2);
    expect(twice.phase).toBe('turn-end');
    expect(deserialize(serialize(twice)).skips).toBe(2);
  });
});

describe('challenge wins', () => {
  const FOUR = ['Ann', 'Bo', 'Cy', 'Dee'];

  it('credits only the challenger who actually took the card', () => {
    const revealed = dispatch(
      game({
        players: FOUR,
        timelines: [[1980], [1970], [1970], [1970]],
        deck: [card(1990)],
      }),
      [
        { type: ACTIONS.DRAW },
        { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
        { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
        { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 1 },
        { type: ACTIONS.REVEAL },
      ],
    );
    expect(outcomeOf(revealed).stolenBy).toBe('p2');
    expect(revealed.challengeWins).toEqual({ p2: 1 });
    expect(challengeWinsFor(revealed, 'p2')).toBe(1);
    // Right, but late: no card, no credit.
    expect(challengeWinsFor(revealed, 'p3')).toBe(0);
    expect(deserialize(serialize(revealed)).challengeWins).toEqual({ p2: 1 });
  });

  it('names the boldest caller only when one player is strictly ahead', () => {
    const base = game({ players: FOUR });
    expect(boldestCaller(base)).toBeNull();
    expect(boldestCaller({ ...base, challengeWins: { p2: 2, p3: 2 } })).toBeNull();
    expect(boldestCaller({ ...base, challengeWins: { p2: 2, p3: 1 } })).toEqual({
      playerId: 'p2',
      name: 'Bo',
      color: SEAT_COLORS[1],
      seat: 1,
      wins: 2,
    });
  });
});

describe('game recap', () => {
  it('has nothing to say about a game nobody has played yet', () => {
    const fresh = createGame({
      players: ['Ann', 'Bo'],
      deck: deckOf([1960, 1970, 1980, 1990]),
    });
    expect(recap(fresh)).toEqual({
      hardestSong: null,
      bestDecades: null,
      boldestCall: null,
      skipped: null,
    });
  });

  it('omits each row until it has earned itself', () => {
    const state = game({
      players: ['Ann', 'Bo'],
      timelines: [[1962, 1965, 1971], [1970]],
    });
    const rows = recap(state);
    // One player has enough cards for a decade; nobody has missed, challenged
    // or skipped anything, so those three rows must not exist.
    expect(rows.hardestSong).toBeNull();
    expect(rows.boldestCall).toBeNull();
    expect(rows.skipped).toBeNull();
    expect(rows.bestDecades).toEqual([
      {
        playerId: 'p1',
        name: 'Ann',
        color: SEAT_COLORS[0],
        seat: 0,
        decade: 1960,
        count: 2,
        total: 3,
        dominant: true,
      },
    ]);
  });

  it('reports null rather than an empty list when no decade qualifies', () => {
    const state = game({ players: ['Ann', 'Bo'], timelines: [[1962], [1970]] });
    expect(recap(state).bestDecades).toBeNull();
  });

  it('collapses co-op to a single unowned row', () => {
    const state = game({ mode: 'coop', sharedTimeline: [1981, 1984, 1988] });
    const rows = recap(state).bestDecades;
    expect(rows).toEqual([
      {
        playerId: null,
        name: null,
        color: null,
        seat: null,
        decade: 1980,
        count: 3,
        total: 3,
        dominant: true,
      },
    ]);
  });

  it('fills in every row for a game that earned them all', () => {
    const hard = card(1990, 'hard-song');
    let state = game({
      players: ['Ann', 'Bo', 'Cy'],
      timelines: [[1962, 1965, 1971], [1970], [2005]],
      deck: [hard, card(1995), card(2005)],
    });
    // Ann places it wrong, Cy challenges wrong, Bo challenges right and takes it.
    state = reduce(
      dispatch(state, [
        { type: ACTIONS.DRAW },
        { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
        { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
        { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 1 },
        { type: ACTIONS.REVEAL },
      ]),
      { type: ACTIONS.NEXT_TURN },
    );
    state = dispatch(state, [{ type: ACTIONS.DRAW }, { type: ACTIONS.SKIP_CARD }]);
    const over = reduce(state, { type: ACTIONS.END_GAME });

    const rows = recap(over);
    expect(rows.hardestSong).toEqual({
      cardId: 'hard-song',
      card: hard,
      misses: 2,
      tied: false,
    });
    expect(rows.boldestCall).toMatchObject({ playerId: 'p2', name: 'Bo', wins: 1 });
    expect(rows.skipped).toBe(1);
    expect(rows.bestDecades?.map((r) => r.playerId)).toEqual(['p1']);
    expect(rows.bestDecades?.[0]).toMatchObject({ decade: 1960, count: 2, dominant: true });
    // The recap is a read: it says the same thing before and after the save.
    expect(recap(deserialize(serialize(over)))).toEqual(rows);
  });
});

/* -------------------------------------------------------------------------- */
/* Winning and ending                                                          */
/* -------------------------------------------------------------------------- */

describe('winning', () => {
  it('fires at exactly the target and not one card earlier', () => {
    const short = game({
      targetCards: 3,
      timelines: [[1970], [1970], [1990]],
      deck: deckOf([1980, 1985]),
    });
    const two = playTo(short, 1);
    expect(timelineFor(two, 'p1')).toHaveLength(2);
    expect(pendingResult(two)).toBeNull();
    const rotated = reduce(two, { type: ACTIONS.NEXT_TURN });
    expect(rotated.phase).toBe('turn-start');
    expect(currentPlayerId(rotated)).toBe('p2');

    const atTarget = game({
      targetCards: 3,
      timelines: [[1970, 1990], [1970], [1990]],
      deck: [card(1980)],
    });
    const three = playTo(atTarget, 1);
    expect(timelineFor(three, 'p1')).toHaveLength(3);
    expect(pendingResult(three)).toMatchObject({ reason: 'target', winnerIds: ['p1'] });
    const over = reduce(three, { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(resultOf(over)).toEqual({
      reason: 'target',
      winnerIds: ['p1'],
      shared: false,
      coopWon: null,
    });
    expect(winner(over)?.name).toBe('Ann');
  });

  it('does not fire when the target-1 placement was wrong', () => {
    const state = game({
      targetCards: 3,
      timelines: [[1970, 1990], [1970], [1990]],
      deck: deckOf([1980, 1975]),
    });
    const missed = playTo(state, 0);
    expect(timelineFor(missed, 'p1')).toHaveLength(2);
    expect(pendingResult(missed)).toBeNull();
  });

  it('can be won by buying the last card', () => {
    const state = game({
      targetCards: 2,
      timelines: [[1970], [1970], [1990]],
      tokens: [3, 2, 2],
      deck: deckOf([1980, 1985]),
    });
    const bought = reduce(state, { type: ACTIONS.BUY_CARD });
    expect(timelineFor(bought, 'p1')).toHaveLength(2);
    const over = reduce(bought, { type: ACTIONS.NEXT_TURN });
    expect(resultOf(over).reason).toBe('target');
    expect(winner(over)?.id).toBe('p1');
  });

  it('gives the longest timeline the win when the deck runs dry', () => {
    // Ann places wrong, so the configured lengths stand: 3 / 2 / 2.
    const state = game({
      timelines: [[1960, 1970, 1980], [1970, 1990], [1990, 2000]],
      deck: [card(2010)],
    });
    const over = reduce(playTo(state, 0), { type: ACTIONS.NEXT_TURN });
    expect(over.phase).toBe('game-over');
    expect(resultOf(over)).toEqual({
      reason: 'deck-exhausted',
      winnerIds: ['p1'],
      shared: false,
      coopWon: null,
    });
  });

  it('breaks a length tie on tokens', () => {
    const state = game({
      timelines: [[1960, 1970, 1980], [1970, 1980, 1990], [1990]],
      tokens: [1, 4, 5],
      deck: [card(2010)],
    });
    const over = reduce(playTo(state, 0), { type: ACTIONS.NEXT_TURN });
    expect(resultOf(over)).toEqual({
      reason: 'deck-exhausted',
      winnerIds: ['p2'],
      shared: false,
      coopWon: null,
    });
    expect(winner(over)?.id).toBe('p2');
  });

  it('shares the win when length and tokens are both level', () => {
    const state = game({
      timelines: [[1960, 1970, 1980], [1970, 1980, 1990], [1990]],
      tokens: [2, 2, 5],
      deck: [card(2010)],
    });
    const over = reduce(playTo(state, 0), { type: ACTIONS.NEXT_TURN });
    expect(resultOf(over)).toEqual({
      reason: 'deck-exhausted',
      winnerIds: ['p1', 'p2'],
      shared: true,
      coopWon: null,
    });
    expect(winner(over)).toBeNull();
    expect(winners(over).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('calls the last card a target win, not deck exhaustion', () => {
    const state = game({
      targetCards: 2,
      timelines: [[1970], [1970], [1990]],
      deck: [card(1980)],
    });
    const revealed = playTo(state, 1);
    expect(deckRemaining(revealed)).toBe(0);
    const over = reduce(revealed, { type: ACTIONS.NEXT_TURN });
    expect(resultOf(over).reason).toBe('target');
    expect(resultOf(over).winnerIds).toEqual(['p1']);
    expect(resultOf(over).shared).toBe(false);
  });

  it('ends on demand and freezes the game', () => {
    const state = game({
      timelines: [[1960, 1970], [1970], [1990]],
      deck: deckOf([1980, 1985]),
    });
    const over = reduce(state, { type: ACTIONS.END_GAME });
    expect(over.phase).toBe('game-over');
    expect(resultOf(over)).toEqual({
      reason: 'ended',
      winnerIds: ['p1'],
      shared: false,
      coopWon: null,
    });
    for (const type of ALL_ACTION_TYPES) {
      const blocked = reduce(over, SAMPLE_ACTIONS[type]);
      expect(blocked.lastError?.reason).toMatch(/game is over/);
      expect(core(blocked)).toEqual(core(over));
    }
    expect(legalActions(over)).toEqual([]);
  });

  it('calls a co-op END_GAME an early stop, never a dry deck or a mistake limit', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1970, 1980],
      targetCards: 10,
      mistakeLimit: 3,
      deck: deckOf([1990, 1995]),
    });
    const over = reduce(state, { type: ACTIONS.END_GAME });
    // The win screen picks its wording off `reason`. There are cards left and
    // mistakes left, so anything but 'ended' invents a defeat nobody had.
    expect(resultOf(over)).toEqual({
      reason: 'ended',
      winnerIds: [],
      shared: false,
      coopWon: false,
    });
    expect(over.mistakes).toBeLessThan(over.mistakeLimit);
    expect(deckRemaining(over)).toBeGreaterThan(0);
  });

  it('does not turn an already-won co-op game into an early stop', () => {
    const state = game({
      mode: 'coop',
      sharedTimeline: [1960, 1970, 1980],
      targetCards: 3,
      deck: deckOf([1990, 1995]),
    });
    const over = reduce(state, { type: ACTIONS.END_GAME });
    expect(resultOf(over).reason).toBe('target');
    expect(resultOf(over).coopWon).toBe(true);
    expect(resultOf(over).winnerIds).toEqual(['p1', 'p2', 'p3']);
  });
});

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

describe('selectors', () => {
  it('describes every gap around a timeline', () => {
    const state = game({ timelines: [[1970, 1990], [1970], [1990]] });
    const gaps = gapsFor(state, 'p1');
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toMatchObject({ index: 0, left: null });
    expect(gaps[0].right?.year).toBe(1970);
    expect(gaps[1].left?.year).toBe(1970);
    expect(gaps[1].right?.year).toBe(1990);
    expect(gaps[2]).toMatchObject({ index: 2, right: null });
    expect(gaps[2].left?.year).toBe(1990);
  });

  it('ranks the scoreboard by cards, then tokens, then seat', () => {
    const state = game({
      timelines: [[1970], [1970, 1980], [1990]],
      tokens: [4, 1, 4],
    });
    const rows = scoreboard(state);
    expect(rows.map((r) => r.playerId)).toEqual(['p2', 'p1', 'p3']);
    expect(rows[0]).toMatchObject({ cards: 2, tokens: 1, isActive: false });
    expect(rows[1]).toMatchObject({ playerId: 'p1', isActive: true, cardsToGo: 9 });
    expect(progressFor(state, 'p2')).toEqual({ cards: 2, target: 10, cardsToGo: 8 });
    expect(currentPlayer(state)?.name).toBe('Ann');
  });

  it('lists the legal actions for each phase', () => {
    const start = game({ tokens: [3, 2, 2], deck: deckOf([1985, 1990]) });
    expect(legalActions(start)).toEqual(['DRAW', 'BUY_CARD', 'END_GAME']);

    const listening = reduce(start, { type: ACTIONS.DRAW });
    expect(legalActions(listening)).toContain('SELECT_GAP');
    expect(legalActions(listening)).not.toContain('REVEAL');

    const committed = reduce(listening, { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 });
    expect(legalActions(committed)).toContain('REVEAL');
    expect(legalActions(committed)).not.toContain('SELECT_GAP');

    const revealed = reduce(committed, { type: ACTIONS.REVEAL });
    expect(legalActions(revealed)).toEqual(['NEXT_TURN', 'END_GAME']);

    const advanced = game({ mode: 'advanced', deck: [card(1985)] });
    const advRevealed = playTo(advanced, 0, [{ type: ACTIONS.SET_CLAIM_IDENTIFY, value: true }]);
    expect(legalActions(advRevealed)).toEqual([
      'CONFIRM_IDENTIFY',
      'CONFIRM_TITLE_ARTIST',
      'NEXT_TURN',
      'END_GAME',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Turn order and the seat rail                                                */
/* -------------------------------------------------------------------------- */

describe('turn order', () => {
  it('names the player after the active one, wrapping round the table', () => {
    const state = game({ players: ['Ann', 'Bo', 'Cy'] });
    expect(nextPlayer(state)?.name).toBe('Bo');
    expect(nextPlayerId(state)).toBe('p2');

    const last = { ...state, activeIndex: 2 };
    expect(nextPlayer(last)?.name).toBe('Ann');
    expect(nextPlayerId(last)).toBe('p1');
  });

  it('keeps up with NEXT_TURN', () => {
    const start = game({ players: ['Ann', 'Bo'], deck: deckOf([1985, 1995, 2005]) });
    expect(nextPlayerId(start)).toBe('p2');
    const second = reduce(playTo(start, 0), { type: ACTIONS.NEXT_TURN });
    expect(currentPlayerId(second)).toBe('p2');
    expect(nextPlayerId(second)).toBe('p1');
  });

  it('has nobody up next in a one-player game', () => {
    const solo = createGame({ players: ['Ann'], deck: deckOf([1970, 1980, 1990]) });
    expect(nextPlayer(solo)).toBeNull();
    expect(nextPlayerId(solo)).toBeNull();
  });

  it('rotates seats in co-op too - only the timeline is shared', () => {
    const state = game({ mode: 'coop', players: ['Ann', 'Bo', 'Cy'] });
    expect(nextPlayer(state)?.name).toBe('Bo');
  });
});

describe('leader', () => {
  it('is nobody while the table is level', () => {
    const state = game({ timelines: [[1970], [1980], [1990]] });
    expect(leader(state)).toBeNull();
    expect(leaderId(state)).toBeNull();
  });

  it('is the one player strictly ahead on cards', () => {
    const state = game({ timelines: [[1970], [1970, 1980, 1990], [1990]] });
    expect(leader(state)?.name).toBe('Bo');
    expect(leaderId(state)).toBe('p2');
  });

  it('is nobody when two players share the top count, tokens or not', () => {
    const state = game({
      timelines: [[1970, 1980], [1970, 1980], [1990]],
      tokens: [5, 0, 2],
    });
    expect(leader(state)).toBeNull();
  });

  it('is nobody in co-op, however big the shared pile gets', () => {
    const state = game({ mode: 'coop', sharedTimeline: [1960, 1970, 1980] });
    expect(leader(state)).toBeNull();
    expect(leaderId(state)).toBeNull();
  });
});

describe('seatStandings', () => {
  it('stays in seat order however the scores move', () => {
    const state = game({
      timelines: [[1970], [1970, 1980, 1990], [1990, 2000]],
      tokens: [2, 1, 4],
    });
    const rows = seatStandings(state);
    expect(rows.map((r) => r.playerId)).toEqual(['p1', 'p2', 'p3']);
    // The scoreboard ranks the same players; the rail deliberately does not.
    expect(scoreboard(state).map((r) => r.playerId)).toEqual(['p2', 'p3', 'p1']);
    expect(rows.map((r) => r.name)).toEqual(['Ann', 'Bo', 'Cy']);
    expect(rows.map((r) => r.cards)).toEqual([1, 3, 2]);
    expect(rows.map((r) => r.tokens)).toEqual([2, 1, 4]);
    expect(rows.map((r) => r.cardsToGo)).toEqual([9, 7, 8]);
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.color)).toEqual(SEAT_COLORS.slice(0, 3));
  });

  it('flags exactly one active, one next and at most one leader', () => {
    const state = game({ timelines: [[1970], [1970, 1980], [1990]], activeIndex: 2 });
    const rows = seatStandings(state);
    expect(rows.map((r) => r.isActive)).toEqual([false, false, true]);
    expect(rows.map((r) => r.isNext)).toEqual([true, false, false]);
    expect(rows.map((r) => r.isLeader)).toEqual([false, true, false]);
  });

  it('crowns nobody while everyone is tied', () => {
    const rows = seatStandings(game({ timelines: [[1970], [1980], [1990]] }));
    expect(rows.some((r) => r.isLeader)).toBe(false);
  });

  it('reports the shared pile and pool on every co-op row, and no leader', () => {
    const state = game({
      mode: 'coop',
      players: ['Ann', 'Bo', 'Cy'],
      sharedTimeline: [1960, 1970, 1980],
      sharedTokens: 4,
      targetCards: 10,
    });
    const rows = seatStandings(state);
    expect(rows.map((r) => r.cards)).toEqual([3, 3, 3]);
    expect(rows.map((r) => r.tokens)).toEqual([4, 4, 4]);
    expect(rows.map((r) => r.cardsToGo)).toEqual([7, 7, 7]);
    expect(rows.some((r) => r.isLeader)).toBe(false);
    expect(rows.map((r) => r.isActive)).toEqual([true, false, false]);
    expect(rows.map((r) => r.isNext)).toEqual([false, true, false]);
  });

  it('carries the face and accent so a chip can be drawn from one row', () => {
    const state = createGame({
      players: [
        { name: 'Ann', photo: 'data:image/jpeg;base64,AAA' },
        { name: 'Bo' },
      ],
      deck: deckOf([1970, 1980, 1990]),
    });
    const rows = seatStandings(state);
    expect(rows[0].photo).toBe('data:image/jpeg;base64,AAA');
    expect(rows[1].photo).toBeNull();
    expect(rows[1].color).toBe(SEAT_COLORS[1]);
  });

  it('is a pure read - it works on a frozen state and hands back live timelines', () => {
    const state = deepFreeze(game({ timelines: [[1970], [1980, 1990], [2000]] }));
    const rows = seatStandings(state);
    expect(rows.map((r) => years(r.timeline))).toEqual([[1970], [1980, 1990], [2000]]);
    expect(nextPlayerId(state)).toBe('p2');
    expect(leaderId(state)).toBe('p2');
  });
});

/* -------------------------------------------------------------------------- */
/* Purity, rejection and persistence                                           */
/* -------------------------------------------------------------------------- */

describe('reducer purity', () => {
  /** A representative state for each phase, all sharing one setup. */
  function statesByPhase(): Record<string, GameState> {
    const start = game({
      players: ['Ann', 'Bo', 'Cy', 'Dee'],
      mode: 'advanced',
      timelines: [[1980], [1970], [1970], [1970]],
      tokens: [3, 2, 2, 2],
      deck: deckOf([1985, 1995, 2005]),
    });
    const listening = dispatch(start, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
    ]);
    const placing = reduce(listening, { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 });
    const revealed = reduce(placing, { type: ACTIONS.REVEAL });
    const turnEnd = reduce(game({ tokens: [3, 2, 2], deck: deckOf([1985, 1995]) }), {
      type: ACTIONS.BUY_CARD,
    });
    const gameOver = reduce(start, { type: ACTIONS.END_GAME });
    return {
      'turn-start': start,
      listening,
      placing,
      revealed,
      'turn-end': turnEnd,
      'game-over': gameOver,
    };
  }

  it('never mutates the state it is handed', () => {
    for (const [phase, state] of Object.entries(statesByPhase())) {
      const snapshot = serialize(state);
      deepFreeze(state);
      for (const type of ALL_ACTION_TYPES) {
        const next = reduce(state, SAMPLE_ACTIONS[type]);
        expect(next).not.toBe(state);
        expect(serialize(state), `${phase} / ${type} mutated the input`).toEqual(snapshot);
      }
      // Malformed actions must be just as harmless.
      expect(reduce(state, { type: 'NOPE' }).lastError).not.toBeNull();
      expect(serialize(state)).toEqual(snapshot);
    }
  });

  it('rejects, rather than half-applies, everything illegal in the current phase', () => {
    for (const [phase, state] of Object.entries(statesByPhase())) {
      const allowed = new Set<string>(legalActions(state));
      for (const type of ALL_ACTION_TYPES) {
        if (allowed.has(type)) continue;
        const next = reduce(state, SAMPLE_ACTIONS[type]);
        expect(next.lastError, `${phase} allowed ${type}`).not.toBeNull();
        expect(core(next), `${phase} / ${type} changed state`).toEqual(core(state));
      }
    }
  });

  it('rejects an unknown action type outright', () => {
    const state = game({ deck: [card(1985)] });
    const next = reduce(state, { type: 'FLY_ME_TO_THE_MOON' });
    expect(next.lastError?.reason).toMatch(/unknown action/);
    expect(core(next)).toEqual(core(state));
  });

  it('clears a stale rejection notice on the next good action', () => {
    const state = game({ deck: [card(1985)] });
    const rejected = reduce(state, { type: ACTIONS.REVEAL });
    expect(rejected.lastError).not.toBeNull();
    expect(reduce(rejected, { type: ACTIONS.DRAW }).lastError).toBeNull();
  });

  it('throws only for a state that is not a state', () => {
    expect(() => reduce(null as unknown as GameState, { type: 'DRAW' })).toThrow(TypeError);
    const state = game();
    expect(reduce(state, null as unknown as Action).lastError?.reason).toMatch(/malformed/);
  });
});

describe('serialize / deserialize', () => {
  function midGame(): GameState {
    const start = game({
      players: ['Ann', 'Bo', 'Cy', 'Dee'],
      mode: 'expert',
      timelines: [[1980], [1970], [1970], [1970]],
      deck: deckOf([1990, 1995]),
    });
    return dispatch(start, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.SET_YEAR_GUESS, year: 1990 },
      { type: ACTIONS.SELECT_GAP, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p2', gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 0 },
      { type: ACTIONS.COMMIT_PLACEMENT },
      { type: ACTIONS.REVEAL },
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
    ]);
  }

  it('round-trips a mid-game state through JSON without loss', () => {
    const state = midGame();
    expect(state.phase).toBe('revealed');
    expect(state.revealBase).not.toBeNull();
    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
    // Nothing in the state is a Map, a Set or `undefined`.
    expect(JSON.parse(serialize(state))).toEqual(state);
  });

  it('carries on identically from a restored save', () => {
    const state = midGame();
    const restored = deserialize(serialize(state));
    const direct = reduce(state, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: false });
    const fromSave = reduce(restored, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: false });
    expect(fromSave).toEqual(direct);

    const nextDirect = reduce(direct, { type: ACTIONS.NEXT_TURN });
    const nextSaved = reduce(fromSave, { type: ACTIONS.NEXT_TURN });
    expect(nextSaved).toEqual(nextDirect);
  });

  it('accepts an already-parsed object as well as a string', () => {
    const state = game();
    expect(deserialize(JSON.parse(serialize(state)))).toEqual(state);
  });

  it('backfills identity into the reveal snapshot, not only the live players', () => {
    const state = midGame();
    expect(state.revealBase).not.toBeNull();
    // A save written before avatars existed, caught mid-reveal.
    const legacy = JSON.parse(serialize(state)) as GameState;
    for (const p of [...legacy.players, ...(legacy.revealBase?.players ?? [])]) {
      delete (p as Partial<typeof p>).photo;
      delete (p as Partial<typeof p>).color;
    }
    const back = deserialize(legacy);
    expect(back.revealBase?.players.map((p) => p.color)).toEqual([
      SEAT_COLORS[0],
      SEAT_COLORS[1],
      SEAT_COLORS[2],
      SEAT_COLORS[3],
    ]);
    expect(back.revealBase?.players.map((p) => p.photo)).toEqual([null, null, null, null]);
    expect((legacy.revealBase?.players[0] as Partial<GameState['players'][number]>).color)
      .toBeUndefined();
  });

  it('survives a confirmation toggle after a legacy save is resumed mid-reveal', () => {
    // Every confirmation replays the turn from `revealBase` and writes its
    // players back over the live ones. Backfilling only the live list means the
    // first tap on Title wipes every seat colour and every photo for the rest of
    // the game - and `undefined` does not even survive the next save.
    const face = 'data:image/jpeg;base64,AAAA';
    const state = {
      ...midGame(),
      players: midGame().players.map((p, i) => (i === 0 ? { ...p, photo: face } : p)),
    };
    const withPhotoBase = {
      ...state,
      revealBase: state.revealBase && { ...state.revealBase, players: state.players },
    };
    const legacy = JSON.parse(serialize(withPhotoBase)) as GameState;
    for (const p of [...legacy.players, ...(legacy.revealBase?.players ?? [])]) {
      delete (p as Partial<typeof p>).color;
    }
    const back = deserialize(legacy);
    const toggled = reduce(back, { type: ACTIONS.CONFIRM_TITLE_ARTIST, artist: false });
    expect(toggled.players.map((p) => p.color)).toEqual([
      SEAT_COLORS[0],
      SEAT_COLORS[1],
      SEAT_COLORS[2],
      SEAT_COLORS[3],
    ]);
    expect(toggled.players[0].photo).toBe(face);
    expect(seatStandings(toggled).map((r) => r.color)).toEqual(
      toggled.players.map((p) => p.color),
    );
    // ...and it is still plain JSON, with no `undefined` to lose on the way out.
    expect(JSON.parse(serialize(toggled)).players).toEqual(toggled.players);
  });

  it('re-derives a confirmed identify claim from a restored save', () => {
    // The classic/co-op reveal keeps its Title+Artist vote in the UI, not in the
    // state; all the engine records is the verdict the pair added up to. A
    // reload therefore has to be able to read that verdict back, or the next tap
    // sends `ok: false` and takes back a token the group already awarded.
    const state = dispatch(game({ tokens: [2, 2, 2], deck: [card(1985)] }), [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.SET_CLAIM_IDENTIFY, value: true },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.REVEAL },
      { type: ACTIONS.CONFIRM_IDENTIFY, ok: true },
    ]);
    expect(tokensFor(state, 'p1')).toBe(3);
    const back = deserialize(serialize(state));
    expect(back.claimIdentify).toBe(true);
    expect(back.confirmations.identify).toBe(true);
    expect(tokensFor(back, 'p1')).toBe(3);
    // Re-affirming what the group already said must be a no-op, not a re-award.
    const again = reduce(back, { type: ACTIONS.CONFIRM_IDENTIFY, ok: true });
    expect(tokensFor(again, 'p1')).toBe(3);
    expect(core(again)).toEqual(core(back));
  });

  it('refuses saves it cannot trust', () => {
    const state = game();
    expect(() => deserialize('{')).toThrow();
    expect(() => deserialize('null')).toThrow(TypeError);
    expect(() => deserialize(JSON.stringify({ ...state, version: 99 }))).toThrow(RangeError);
    expect(() => deserialize(JSON.stringify({ ...state, mode: 'nope' }))).toThrow(RangeError);
    expect(() => deserialize(JSON.stringify({ ...state, phase: 'nope' }))).toThrow(RangeError);
    expect(() => deserialize(JSON.stringify({ ...state, players: [] }))).toThrow(TypeError);
  });
});

/* -------------------------------------------------------------------------- */
/* Full games                                                                  */
/* -------------------------------------------------------------------------- */

describe('full games', () => {
  it('plays a classic game out to a winner without leaking or losing cards', () => {
    const deck = deckOf([
      1955, 1962, 1971, 1984, 1991, 1999, 2004, 2013, 1968, 1977, 2008, 1996, 1959, 1988,
    ]);
    let state = createGame({ players: ['Ann', 'Bo', 'Cy'], deck, targetCards: 4, seed: 11 });
    const totalCards = deck.length;

    let guard = 0;
    while (!isGameOver(state) && guard < 200) {
      guard += 1;
      const activeId = currentPlayerId(state) as string;
      state = reduce(state, { type: ACTIONS.DRAW });
      const drawnYear = state.card?.year as number;
      // Play perfectly: pick the first gap that actually fits.
      const gap = correctGapsFor(timelineFor(state, activeId), drawnYear)[0];
      state = dispatch(state, [
        { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: gap },
        { type: ACTIONS.REVEAL },
        { type: ACTIONS.NEXT_TURN },
      ]);

      const placed = state.players.reduce((n, p) => n + p.timeline.length, 0);
      expect(placed + state.deck.length + state.discard.length).toBe(totalCards);
    }

    expect(isGameOver(state)).toBe(true);
    expect(resultOf(state).reason).toBe('target');
    expect(winner(state)).not.toBeNull();
    expect(timelineFor(state, resultOf(state).winnerIds[0])).toHaveLength(4);
    // Perfect play keeps every timeline sorted.
    for (const p of state.players) {
      expect(years(p.timeline)).toEqual(years(p.timeline).slice().sort((a, b) => a - b));
    }
  });

  it('plays an advanced game where the naming gate decides every card', () => {
    let state = game({
      mode: 'advanced',
      targetCards: 3,
      timelines: [[1980], [1970], [1990]],
      deck: deckOf([1985, 1975, 1995, 1965, 2005]),
    });

    // Ann: right gap, named it. Card and no token (she never claimed identify).
    state = dispatch(playTo(state, 1), [
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
      { type: ACTIONS.NEXT_TURN },
    ]);
    expect(years(timelineFor(state, 'p1'))).toEqual([1980, 1985]);
    expect(tokensFor(state, 'p1')).toBe(2);

    // Bo: right gap, but only got the title. No card — and a challenger cannot
    // pick it up, because the placement itself was correct.
    state = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 1 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p3', gapIndex: 0 },
      { type: ACTIONS.REVEAL },
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: false },
    ]);
    expect(outcomeOf(state).placementCorrect).toBe(true);
    expect(outcomeOf(state).accepted).toBe(false);
    expect(outcomeOf(state).destination).toBe('discard');
    expect(tokensFor(state, 'p3')).toBe(1);
    state = reduce(state, { type: ACTIONS.NEXT_TURN });
    expect(timelineFor(state, 'p2')).toHaveLength(1);

    // Cy: wrong gap but names it perfectly, and Ann challenges correctly and
    // takes the card even though she is not the one who named it.
    state = dispatch(state, [
      { type: ACTIONS.DRAW },
      { type: ACTIONS.COMMIT_PLACEMENT, gapIndex: 0 },
      { type: ACTIONS.ADD_CHALLENGE, playerId: 'p1', gapIndex: 2 },
      { type: ACTIONS.REVEAL },
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
    ]);
    expect(outcomeOf(state).stolenBy).toBe('p1');
    state = reduce(state, { type: ACTIONS.NEXT_TURN });
    expect(years(timelineFor(state, 'p1'))).toEqual([1980, 1985, 1995]);

    // That was Ann's third card, so the game is already decided.
    expect(state.phase).toBe('game-over');
    expect(winner(state)?.id).toBe('p1');
  });

  it('plays an expert game where only a fully correct answer scores', () => {
    let state = game({
      mode: 'expert',
      targetCards: 3,
      timelines: [[1980], [1970], [1990]],
      deck: deckOf([1985, 1975, 1995, 1965]),
    });

    // Ann nails everything.
    state = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1985 }]), [
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
      { type: ACTIONS.NEXT_TURN },
    ]);
    expect(timelineFor(state, 'p1')).toHaveLength(2);

    // Bo places right but guesses the year wrong: no card.
    state = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1976 }]), [
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
      { type: ACTIONS.NEXT_TURN },
    ]);
    expect(timelineFor(state, 'p2')).toHaveLength(1);
    expect(years(state.discard)).toEqual([1975]);

    // Cy is right about everything but the artist: no card.
    state = dispatch(playTo(state, 1, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1995 }]), [
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: false },
      { type: ACTIONS.NEXT_TURN },
    ]);
    expect(timelineFor(state, 'p3')).toHaveLength(1);

    // Back to Ann for the win.
    state = dispatch(playTo(state, 0, [{ type: ACTIONS.SET_YEAR_GUESS, year: 1965 }]), [
      { type: ACTIONS.CONFIRM_TITLE_ARTIST, title: true, artist: true },
      { type: ACTIONS.NEXT_TURN },
    ]);
    expect(state.phase).toBe('game-over');
    expect(winner(state)?.id).toBe('p1');
    expect(years(timelineFor(state, 'p1'))).toEqual([1965, 1980, 1985]);
  });
});
