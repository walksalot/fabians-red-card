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
  /** Squad names for the scorer picker (empty until teams are known). */
  homeSquad: string[];
  awaySquad: string[];
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
