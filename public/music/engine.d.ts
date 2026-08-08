/**
 * Hand-written types for `engine.js`.
 *
 * The engine ships as plain ES modules the browser loads directly (no build
 * step), so there is nothing to generate declarations from — but the vitest
 * suite is TypeScript and `tsc --noEmit` covers it. This file is the bridge, and
 * it doubles as the readable contract the UI is written against.
 */

export type Mode = 'classic' | 'advanced' | 'expert' | 'coop';

export type Phase = 'turn-start' | 'listening' | 'placing' | 'revealed' | 'turn-end' | 'game-over';

export type ActionType =
  | 'DRAW'
  | 'SELECT_GAP'
  | 'COMMIT_PLACEMENT'
  | 'ADD_CHALLENGE'
  | 'REMOVE_CHALLENGE'
  | 'SET_CLAIM_IDENTIFY'
  | 'SET_YEAR_GUESS'
  | 'BUY_CARD'
  | 'REVEAL'
  | 'CONFIRM_IDENTIFY'
  | 'CONFIRM_TITLE_ARTIST'
  | 'NEXT_TURN'
  | 'SKIP_CARD'
  | 'END_GAME';

/** Anything with a release year can be placed; the deck adds the trimmings. */
export interface YearCard {
  year: number;
}

export interface Card extends YearCard {
  id: string;
  title?: string;
  artist?: string;
  genre?: string;
  decade?: number;
}

export interface Player {
  id: string;
  name: string;
  /** A square JPEG data URL, or null when this player uses the generated initial. */
  photo: string | null;
  /** Accent for this seat, from SEAT_COLORS unless createGame was given one. */
  color: string;
  /** Always empty in co-op — the group builds `state.sharedTimeline` instead. */
  timeline: Card[];
  /** Always 0 in co-op — the group spends `state.sharedTokens` instead. */
  tokens: number;
  /**
   * Cards kept in a row towards the streak bonus. Personal in every mode, co-op
   * included; held at 0 for everybody while `streakBonus` is off.
   */
  streakRun: number;
}

/** A JSON-safe running total, keyed by card id or player id. */
export type Tally = Record<string, number>;

export interface Challenge {
  playerId: string;
  gapIndex: number;
}

export interface ChallengeResult extends Challenge {
  /** Seats clockwise from the seat left of the active player; 0 goes first. */
  seatOffset: number;
  correct: boolean;
  won: boolean;
  /** False when the active player placed correctly, so no challenge could pay out. */
  resolved: boolean;
  tokenSpent: number;
}

export interface TokenAward {
  playerId: string;
  /** What the pool actually moved by - 0 for an award that hit `tokenCap`. */
  delta: number;
  reason: 'identify' | 'buy' | 'streak';
  pool: 'player' | 'shared';
}

export interface Confirmations {
  identify: boolean | null;
  title: boolean | null;
  artist: boolean | null;
}

/**
 * One shape for every kind of turn ending, with the inapplicable fields set to
 * null, so the reveal screen can render without narrowing a union first.
 */
export interface Outcome {
  kind: 'placement' | 'buy' | 'skip';
  card: Card;
  year: number;
  playerId: string;
  gapIndex: number | null;
  placementCorrect: boolean | null;
  titleOk: boolean | null;
  artistOk: boolean | null;
  yearGuess: number | null;
  yearGuessCorrect: boolean | null;
  requirementsMet: boolean | null;
  accepted: boolean;
  claimedIdentify: boolean;
  identifyConfirmed: boolean | null;
  identifyAwarded: boolean;
  /** True when this card completed a run of `STREAK_LENGTH` and paid the bonus. */
  streakAwarded: boolean;
  /** The active player's run AFTER this card - already back to 0 if it paid. */
  streakRun: number;
  tokenAwards: TokenAward[];
  challenges: ChallengeResult[];
  stolenBy: string | null;
  destination: 'timeline' | 'challenger' | 'discard';
  mistakeRecorded: boolean;
  /** Wrong gaps this card drew: the placement plus every wrong challenge. */
  wrongGuesses: number;
  tokensSpent: number;
  replaced: boolean | null;
}

export interface GameResult {
  reason: 'target' | 'deck-exhausted' | 'mistake-limit' | 'ended';
  winnerIds: string[];
  /** True when several players tie for the win. */
  shared: boolean;
  /** Co-op only: did the group make it? null in the competitive modes. */
  coopWon: boolean | null;
}

export interface RevealBase {
  players: Player[];
  sharedTimeline: Card[];
  sharedTokens: number;
  discard: Card[];
  mistakes: number;
  /** Snapshotted so a replayed reveal re-derives the tallies instead of adding to them. */
  missCounts: Tally;
  challengeWins: Tally;
}

export interface RejectedAction {
  action: string | null;
  reason: string;
}

export interface GameState {
  version: number;
  mode: Mode;
  targetCards: number;
  mistakeLimit: number;
  startingTokens: number;
  tokenCap: number;
  /** The house rule: three cards kept in a row pays a token. Off unless asked for. */
  streakBonus: boolean;
  seed: number;
  rngState: number;
  players: Player[];
  sharedTimeline: Card[];
  sharedTokens: number;
  activeIndex: number;
  turn: number;
  phase: Phase;
  deck: Card[];
  discard: Card[];
  mistakes: number;
  /** Wrong guesses per card id. Sparse: a card nobody missed has no entry. */
  missCounts: Tally;
  /** Cards stolen with a challenge, per player id. Sparse in the same way. */
  challengeWins: Tally;
  /** Cards the table waved away. */
  skips: number;
  result: GameResult | null;
  lastError: RejectedAction | null;
  card: Card | null;
  selectedGap: number | null;
  placementCommitted: boolean;
  committedGap: number | null;
  claimIdentify: boolean;
  yearGuess: number | null;
  challenges: Challenge[];
  confirmations: Confirmations;
  revealBase: RevealBase | null;
  outcome: Outcome | null;
}

/** Payload fields are optional so malformed actions stay expressible (and testable). */
export interface Action {
  type: ActionType | string;
  gapIndex?: number;
  playerId?: string;
  value?: boolean;
  year?: number | null;
  ok?: boolean;
  title?: boolean;
  artist?: boolean;
}

export interface PlayerSeed {
  id?: string;
  name?: string;
  /** Data URL. Anything else (including undefined) becomes null. */
  photo?: string | null;
  /** Either spelling is accepted; the state always ends up with `color`. */
  color?: string;
  colour?: string;
}

export interface CreateGameOptions {
  players: ReadonlyArray<string | PlayerSeed>;
  deck: ReadonlyArray<Card>;
  targetCards?: number;
  mode?: Mode;
  mistakeLimit?: number;
  startingTokens?: number;
  /** Defaults to `defaultTokenCap(mode)`: 5, or 6 in co-op. */
  tokenCap?: number;
  seed?: number;
  /** The optional house rule. Defaults to false. */
  streakBonus?: boolean;
}

export interface Gap {
  index: number;
  left: Card | null;
  right: Card | null;
}

export interface ScoreRow {
  playerId: string;
  name: string;
  photo: string | null;
  color: string;
  seat: number;
  timeline: Card[];
  cards: number;
  tokens: number;
  /** Cards kept in a row; always 0 while `streakBonus` is off. */
  streakRun: number;
  cardsToGo: number;
  isActive: boolean;
}

/** A ScoreRow in fixed seat order, with the turn-order flags the rail needs. */
export interface SeatRow extends ScoreRow {
  /** True for the player who plays after the active one. */
  isNext: boolean;
  /** True only when this player is STRICTLY ahead on cards. Never true in co-op. */
  isLeader: boolean;
}

export interface Progress {
  cards: number;
  target: number;
  cardsToGo: number;
}

export interface Streak {
  /** False while the house rule is off - draw nothing, `run` will be 0. */
  enabled: boolean;
  run: number;
  /** Always STREAK_LENGTH, so a dot row can be sized from this object alone. */
  needed: number;
  toGo: number;
}

export interface DecadeCount {
  /** The decade's first year: 1950, 1960, ... 2020. */
  decade: number;
  count: number;
}

export interface DecadeStrength {
  playerId: string;
  /** Cards in the timeline, including any outside the eight buckets. */
  cards: number;
  /** Cards that landed in one of the eight buckets - the sum of `counts`. */
  total: number;
  /** Always eight entries, in DECADE_STARTS order. */
  counts: DecadeCount[];
  /** The tallest bar's height. 0 for an empty timeline. */
  bestCount: number;
  /** Every decade at `bestCount` - draw them all solid. */
  leaders: number[];
  tied: boolean;
  /** The decade worth naming, or null when `enough` is false. */
  best: number | null;
  /** A strict majority of the counted cards sit in `best`: "owns the 80s". */
  dominant: boolean;
  /** False until DECADE_MIN_CARDS cards have landed: "warming up". */
  enough: boolean;
}

export interface HardestCard {
  cardId: string;
  /** The card itself, or null if a save no longer holds it anywhere. */
  card: Card | null;
  misses: number;
  /** True when other cards were missed just as often. */
  tied: boolean;
}

export interface BoldestCall {
  playerId: string;
  name: string;
  color: string;
  seat: number;
  wins: number;
}

/** Co-op reports one row for the shared pile, with a null `playerId`. */
export interface RecapDecade {
  playerId: string | null;
  name: string | null;
  color: string | null;
  seat: number | null;
  decade: number;
  count: number;
  total: number;
  dominant: boolean;
}

/** Every field is null unless it earned itself; draw a row per non-null field. */
export interface Recap {
  hardestSong: HardestCard | null;
  bestDecades: RecapDecade[] | null;
  boldestCall: BoldestCall | null;
  skipped: number | null;
}

export declare const PHASES: readonly Phase[];
export declare const MODES: readonly Mode[];
export declare const ACTIONS: Readonly<Record<ActionType, ActionType>>;
export declare const BUY_COST: number;
export declare const TOKEN_CAP: number;
export declare const COOP_TOKEN_CAP: number;
export declare const STREAK_LENGTH: number;
export declare const STREAK_REWARD: number;
/** Named around `deck.js`, which already exports a `DECADES` the UI imports. */
export declare const DECADE_STARTS: readonly number[];
export declare const DECADE_MIN_CARDS: number;
export declare const STATE_VERSION: number;
export declare const SEAT_COLORS: readonly string[];

export declare function seatColor(index: number): string;
export declare function defaultTokenCap(mode: Mode | string): number;

export declare function mulberry32(seed: number): () => number;
export declare function shuffle<T>(items: readonly T[], cursor: number): { items: T[]; cursor: number };

export declare function createGame(options: CreateGameOptions): GameState;
export declare function reduce(state: GameState, action: Action): GameState;

export declare function isGapCorrect(
  timeline: readonly YearCard[],
  gapIndex: number,
  year: number,
): boolean;
export declare function correctGapsFor(timeline: readonly YearCard[], year: number): number[];
export declare function insertionIndexFor(timeline: readonly YearCard[], year: number): number;

export declare function currentPlayer(state: GameState): Player | null;
export declare function currentPlayerId(state: GameState): string | null;
export declare function timelineFor(state: GameState, playerId: string): Card[];
export declare function tokensFor(state: GameState, playerId: string): number;
export declare function gapsFor(state: GameState, playerId: string): Gap[];
export declare function buyBlockedReason(state: GameState): string | null;
export declare function canBuy(state: GameState): boolean;
export declare function challengeBlockedReason(state: GameState, playerId: string): string | null;
export declare function canChallenge(state: GameState, playerId: string): boolean;
export declare function challengeFor(state: GameState, playerId: string): Challenge | null;
export declare function deckRemaining(state: GameState): number;
export declare function progressFor(state: GameState, playerId: string): Progress;
export declare function streakFor(state: GameState, playerId: string): Streak;
export declare function missCountFor(state: GameState, cardId: string): number;
export declare function challengeWinsFor(state: GameState, playerId: string): number;
export declare function skippedCount(state: GameState): number;
export declare function hardestCard(state: GameState): HardestCard | null;
export declare function boldestCaller(state: GameState): BoldestCall | null;
export declare function decadeStrengthFor(state: GameState, playerId: string): DecadeStrength;
export declare function decadeStrengths(state: GameState): DecadeStrength[];
export declare function recap(state: GameState): Recap;
export declare function scoreboard(state: GameState): ScoreRow[];
export declare function nextPlayer(state: GameState): Player | null;
export declare function nextPlayerId(state: GameState): string | null;
export declare function leader(state: GameState): Player | null;
export declare function leaderId(state: GameState): string | null;
export declare function seatStandings(state: GameState): SeatRow[];
export declare function isGameOver(state: GameState): boolean;
export declare function result(state: GameState): GameResult | null;
export declare function winners(state: GameState): Player[];
export declare function winner(state: GameState): Player | null;
export declare function pendingResult(state: GameState): GameResult | null;
export declare function legalActions(state: GameState): ActionType[];

export declare function serialize(state: GameState): string;
export declare function deserialize(json: string | object): GameState;
