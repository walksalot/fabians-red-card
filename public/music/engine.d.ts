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
  /** Always empty in co-op — the group builds `state.sharedTimeline` instead. */
  timeline: Card[];
  /** Always 0 in co-op — the group spends `state.sharedTokens` instead. */
  tokens: number;
}

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
  delta: number;
  reason: 'identify' | 'buy';
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
  tokenAwards: TokenAward[];
  challenges: ChallengeResult[];
  stolenBy: string | null;
  destination: 'timeline' | 'challenger' | 'discard';
  mistakeRecorded: boolean;
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

export interface CreateGameOptions {
  players: ReadonlyArray<string | { id?: string; name?: string }>;
  deck: ReadonlyArray<Card>;
  targetCards?: number;
  mode?: Mode;
  mistakeLimit?: number;
  startingTokens?: number;
  tokenCap?: number;
  seed?: number;
}

export interface Gap {
  index: number;
  left: Card | null;
  right: Card | null;
}

export interface ScoreRow {
  playerId: string;
  name: string;
  seat: number;
  timeline: Card[];
  cards: number;
  tokens: number;
  cardsToGo: number;
  isActive: boolean;
}

export interface Progress {
  cards: number;
  target: number;
  cardsToGo: number;
}

export declare const PHASES: readonly Phase[];
export declare const MODES: readonly Mode[];
export declare const ACTIONS: Readonly<Record<ActionType, ActionType>>;
export declare const BUY_COST: number;
export declare const STATE_VERSION: number;

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
export declare function scoreboard(state: GameState): ScoreRow[];
export declare function isGameOver(state: GameState): boolean;
export declare function result(state: GameState): GameResult | null;
export declare function winners(state: GameState): Player[];
export declare function winner(state: GameState): Player | null;
export declare function pendingResult(state: GameState): GameResult | null;
export declare function legalActions(state: GameState): ActionType[];

export declare function serialize(state: GameState): string;
export declare function deserialize(json: string | object): GameState;
