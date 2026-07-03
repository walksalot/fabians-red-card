/**
 * Serializable view models passed from server pages to client components.
 * These mirror (subsets of) the frozen shapes in CONTRACTS.md — pages map raw
 * service/db rows into these so client components never touch db types.
 */

export type FirstTeam = 'home' | 'away' | 'none';

export interface PickView {
  predHome: number;
  predAway: number;
  predScorer: string | null;
  /** The pick as stored (pre-canonicalization) — what the scoring engine will
      actually compare at full time. Only serialized where a live hit/miss
      verdict is rendered (Today's sweat line); display uses predScorer. */
  predScorerRaw?: string | null;
  predFirstTeam: FirstTeam | null;
}

/** Mirrors PointsBreakdown from @/lib/scoring (stored as JSON in matchPoints.breakdown). */
export interface BreakdownView {
  exact: number;
  outcome: number;
  scorer: number;
  firstTeam: number;
  underdog: number;
  base: number;
  roundMultiplier: number;
  boosterMultiplier: number;
  total: number;
}

export interface TodayMatchView {
  matchId: number;
  matchday: string;
  kickoffUtc: string;
  stage: string;
  homeName: string;
  awayName: string;
  /** FIFA 3-letter codes (null for TBD/placeholder teams) — drive flag emoji. */
  homeCode: string | null;
  awayCode: string | null;
  venue: string;
  city: string;
  status: 'scheduled' | 'finished';
  locked: boolean;
  homeScore: number | null;
  awayScore: number | null;
  firstScorer: string | null;
  /** Live in-progress score from the feed (display only); liveStatus 'in' while playing. */
  liveHome: number | null;
  liveAway: number | null;
  liveStatus: string | null;
  /** Feed's match clock ("55'", "HT") — minutes accrued, soccer counts up. */
  liveClock: string | null;
  /** First-goal facts as they stand mid-match (canonical squad spelling). */
  liveFirstScorer: string | null;
  /** The feed's raw spelling — the string the engine will score against at
      full time; the sweat line's verdict compares raw vs raw. */
  liveFirstScorerRaw: string | null;
  liveFirstScoringTeam: FirstTeam | null;
  /** Epoch ms of the last live-feed write — drives the freshness stamp. */
  liveUpdatedAt: number | null;
  /**
   * Which side is the flagged underdog (display-only; null = no flag). Only
   * serialized while the card is open — the flag freezes with the picks.
   */
  underdogSide: 'home' | 'away' | null;
  /**
   * Squad names for the scorer picker. `null` = team unknown (knockout TBD —
   * the server rejects picks on such matches outright with a 409);
   * an empty array = team known but no squad data (validation fails open).
   */
  homeSquad: string[] | null;
  awaySquad: string[] | null;
  /** Both team slots known? Knockout placeholders render a pending note. */
  teamsTbd: boolean;
  /** Betting cheat sheet (null when absent/stale); MatchOdds from '@/lib/odds'. */
  odds: import('@/lib/odds').MatchOdds | null;
  /** First-goalscorer odds by player name (american strings); empty when none. */
  scorerOdds: Record<string, string>;
  myPick: PickView | null;
  boosted: boolean;
  /** True when the booster cannot be placed on / moved to this match right now. */
  boosterDisabled: boolean;
  points: { total: number; breakdown: BreakdownView | null } | null;
}

/**
 * One LOCKED or FINISHED match on the current matchday with an entry's pick —
 * the leaderboard's "what did they put on it" reveal. Open (unkicked) picks
 * are never serialized into this shape; the server helper filters them out.
 */
export interface LockedPickView {
  matchId: number;
  /** Kickoff instant — drives the jackpot freshness window client-side. */
  kickoffUtc: string;
  /** YYYY-MM-DD — names the matchday in the reveal header (it is often
      yesterday's, so "today's picks" would be a lie the morning after). */
  matchday: string;
  homeName: string;
  awayName: string;
  homeCode: string | null;
  awayCode: string | null;
  status: 'scheduled' | 'finished';
  homeScore: number | null;
  awayScore: number | null;
  liveHome: number | null;
  liveAway: number | null;
  liveStatus: string | null;
  pick: PickView | null;
  points: { total: number; breakdown: BreakdownView | null } | null;
}

export interface LeaderboardRowView {
  rank: number;
  entryId: number;
  userId: number;
  label: string;
  displayName: string;
  total: number;
  exactCount: number;
  scorerHits: number;
  outcomeCount: number;
  /** Points banked on the current matchday — the table's "+N today" delta. */
  todayPoints?: number;
  /** This entry's picks on locked/finished matches today (expandable rows). */
  lockedPicks?: LockedPickView[];
}

export interface PrizePoolView {
  totalCents: number;
  payouts: Array<{ place: number; percent: number; amountCents: number }>;
}

export interface EntryOption {
  id: number;
  label: string;
}

export interface EntryStatsView {
  total: number;
  exactCount: number;
  scorerHits: number;
  picksMade: number;
  finishedPicked: number;
  accuracyPct: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
}

export interface HistoryItemView {
  matchId: number;
  stage: string;
  kickoffUtc: string;
  homeName: string;
  awayName: string;
  /** FIFA 3-letter codes (null for TBD/placeholder teams) — drive flag emoji. */
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number;
  awayScore: number;
  firstScorer: string | null;
  firstScoringTeam: FirstTeam | null;
  myPick: PickView | null;
  breakdown: BreakdownView | null;
  total: number | null;
}

export interface HistoryDayView {
  matchday: string;
  subtotal: number;
  items: HistoryItemView[];
}
