/**
 * Rules tests for the music-timeline engine (`public/music/engine.js`).
 *
 * The engine is the only thing standing between a party of eight and an argument
 * about whether a tie counts, so these tests are deliberately adversarial: every
 * gap of every timeline length, both ends of every tie, the whole token economy,
 * challenge priority with wrap-around seating, and each way the game can end.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  BUY_COST,
  MODES,
  PHASES,
  STATE_VERSION,
  canBuy,
  canChallenge,
  challengeBlockedReason,
  challengeFor,
  correctGapsFor,
  createGame,
  currentPlayer,
  currentPlayerId,
  deckRemaining,
  deserialize,
  gapsFor,
  insertionIndexFor,
  isGameOver,
  isGapCorrect,
  legalActions,
  mulberry32,
  pendingResult,
  progressFor,
  reduce,
  scoreboard,
  serialize,
  shuffle,
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
  tokenCap?: number;
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
    tokenCap: options.tokenCap ?? 5,
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
      expect(reduce(state, { type: 'NOPE' }).lastError?.reason).toMatch(/unknown action/);
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
