import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const leagues = sqliteTable('leagues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  inviteToken: text('invite_token').notNull().unique(),
  joinPasswordHash: text('join_password_hash'),
  isPrivate: integer('is_private').notNull().default(1),
  buyInCents: integer('buy_in_cents').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  entriesPerUser: integer('entries_per_user').notNull().default(1),
  payoutSplit: text('payout_split').notNull().default('[60,30,10]'),
  scoringRules: text('scoring_rules')
    .notNull()
    .default('{"exact":10,"outcome":2,"scorer":8,"firstTeam":2,"underdog":5}'),
  boosterMultiplier: real('booster_multiplier').notNull().default(2),
  roundMultipliers: text('round_multipliers')
    .notNull()
    .default('{"group":1,"r32":1,"r16":1,"qf":1,"sf":1,"third":1,"final":1}'),
  // Auto-results: when the primary league has this on, the server fills final
  // scores + first scorer from the free public feed. Read from the primary league.
  autoSyncEnabled: integer('auto_sync_enabled').notNull().default(1),
  // Auto-flag clear underdogs (+5 bonus) from betting odds. Off by default —
  // it changes scoring, so the admin arms it deliberately.
  autoUnderdogEnabled: integer('auto_underdog_enabled').notNull().default(0),
  adminUserId: integer('admin_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leagueId: integer('league_id')
      .notNull()
      .references(() => leagues.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(), // 'admin' | 'member'
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('memberships_league_user').on(t.leagueId, t.userId)],
);

export const entries = sqliteTable('entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leagueId: integer('league_id')
    .notNull()
    .references(() => leagues.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  label: text('label').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(), // seeded, stable
  code: text('code').notNull().unique(), // FIFA 3-letter code
  name: text('name').notNull(),
  groupLetter: text('group_letter').notNull(), // 'A'..'L'
});

// Squad lists (from the same free feed as auto-results, so scorer names in
// picks and in results share one spelling). Refreshable; names are the contract.
export const players = sqliteTable(
  'players',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    position: text('position'),
  },
  (t) => [uniqueIndex('players_team_name').on(t.teamId, t.name)],
);

// First-goalscorer odds per match (display-only cheat sheet), keyed by the
// resolved player name; refreshed pre-match on its own gentle cadence.
export const scorerOdds = sqliteTable(
  'scorer_odds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id').notNull(),
    playerName: text('player_name').notNull(),
    american: text('american').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('scorer_odds_match_player').on(t.matchId, t.playerName)],
);

// ESPN athlete id → name cache (immutable facts; saves a request per athlete).
export const espnAthletes = sqliteTable('espn_athletes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey(), // official FIFA match number 1..104
  stage: text('stage').notNull(), // 'group'|'r32'|'r16'|'qf'|'sf'|'third'|'final'
  groupLetter: text('group_letter'),
  homeTeamId: integer('home_team_id').references(() => teams.id),
  awayTeamId: integer('away_team_id').references(() => teams.id),
  homePlaceholder: text('home_placeholder'), // knockout label until teams known
  awayPlaceholder: text('away_placeholder'),
  kickoffUtc: text('kickoff_utc').notNull(), // ISO YYYY-MM-DDTHH:MM:00Z
  matchday: text('matchday').notNull(), // YYYY-MM-DD in America/New_York
  venue: text('venue').notNull(),
  city: text('city').notNull(),
  status: text('status').notNull().default('scheduled'), // 'scheduled'|'finished'
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  firstScorer: text('first_scorer'),
  firstScoringTeam: text('first_scoring_team'), // 'home'|'away'|'none'
  underdogTeamId: integer('underdog_team_id').references(() => teams.id),
  // How a finished result was recorded: 'manual' (admin typed it — never
  // overwritten by auto-sync) or 'auto' (filled from the public feed). Null
  // while scheduled.
  resultSource: text('result_source'),
  // Live in-progress score from the feed (display only; points settle on final).
  liveHome: integer('live_home'),
  liveAway: integer('live_away'),
  liveStatus: text('live_status'), // 'in' while playing, cleared otherwise
  liveUpdatedAt: integer('live_updated_at'),
  // Match clock as the feed reports it ("55'", "90'+3'", "HT") — soccer counts
  // up, so this is minutes accrued, not remaining. Display only.
  liveClock: text('live_clock'),
  // Live first-goal facts (drive the "if it ended now" provisional board).
  liveFirstScorer: text('live_first_scorer'),
  liveFirstScoringTeam: text('live_first_scoring_team'), // 'home'|'away'
  // Betting-odds cheat sheet: parsed MatchOdds JSON (src/lib/odds.ts) from the
  // same feed as results; display-only. Refreshed by the sync; null when the
  // market is absent (TBD knockout slots).
  oddsJson: text('odds_json'),
  oddsUpdatedAt: integer('odds_updated_at'),
});

// Small key/value store for server housekeeping (last auto-sync time, last
// backup time, last sync error). One row per key.
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const picks = sqliteTable(
  'picks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id),
    matchId: integer('match_id')
      .notNull()
      .references(() => matches.id),
    predHome: integer('pred_home').notNull(),
    predAway: integer('pred_away').notNull(),
    predScorer: text('pred_scorer'),
    predFirstTeam: text('pred_first_team'), // 'home'|'away'|'none'
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('picks_entry_match').on(t.entryId, t.matchId)],
);

export const boosters = sqliteTable(
  'boosters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id),
    matchday: text('matchday').notNull(),
    matchId: integer('match_id')
      .notNull()
      .references(() => matches.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('boosters_entry_matchday').on(t.entryId, t.matchday)],
);

export const matchPoints = sqliteTable(
  'match_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id),
    matchId: integer('match_id')
      .notNull()
      .references(() => matches.id),
    breakdown: text('breakdown').notNull(), // JSON PointsBreakdown
    total: real('total').notNull(),
  },
  (t) => [uniqueIndex('match_points_entry_match').on(t.entryId, t.matchId)],
);
