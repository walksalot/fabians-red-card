/**
 * Results service: admin result entry, knockout team assignment, underdog flags,
 * and the recompute pipeline that keeps matchPoints in sync with every league's
 * scoring settings. Results are global (one deployment per friend group), so they
 * may only be written by admins of the PRIMARY league (the seeded/first-created
 * one) — league creation is open to every user, so "admin of any league" would
 * let any player mint a throwaway league and rewrite the whole tournament.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';
import { knockoutAdvancers, propagateMatch } from '@/lib/services/bracket-propagation';
import {
  scorePick,
  type PickInput,
  type ResultInput,
  type ScoringRules,
  type Stage,
} from '@/lib/scoring';

type MatchRow = typeof schema.matches.$inferSelect;
type LeagueRow = typeof schema.leagues.$inferSelect;

export interface EnterResultInput {
  matchId: number;
  homeScore: number;
  awayScore: number;
  firstScorer: string | null;
  firstScoringTeam: 'home' | 'away' | 'none';
  /**
   * Shootout tallies when a level knockout final went to penalties. They name
   * the advancer (bracket/display only) — the scoring engine never sees them,
   * so the tie still scores as the draw it was after extra time.
   */
  homePens?: number | null;
  awayPens?: number | null;
}

export interface SetMatchTeamsInput {
  matchId: number;
  homeTeamId: number;
  awayTeamId: number;
}

export interface SetUnderdogInput {
  matchId: number;
  underdogTeamId: number | null;
}

const MAX_SCORE = 30;

/**
 * Throws 403 unless userId holds the admin role in the PRIMARY league (lowest
 * league id — the seeded/bootstrap league). Self-created leagues grant their
 * creator an admin membership, so deriving global results authority from
 * "admin of any league" would let every player corrupt the tournament data.
 */
export function requireResultsAdmin(db: Db, userId: number): void {
  const primary = db
    .select({ id: schema.leagues.id })
    .from(schema.leagues)
    .orderBy(asc(schema.leagues.id))
    .limit(1)
    .get();
  const row = primary
    ? db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.leagueId, primary.id),
            eq(schema.memberships.userId, userId),
            eq(schema.memberships.role, 'admin'),
          ),
        )
        .get()
    : undefined;
  if (!row) throw new AppError('admin access required', 403);
}

function getMatchOrThrow(db: Db, matchId: number): MatchRow {
  const match = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .get();
  if (!match) throw new AppError('match not found', 404);
  return match;
}

function validateScore(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SCORE) {
    throw new AppError(`${label} must be an integer between 0 and ${MAX_SCORE}`, 400);
  }
}

/**
 * Normalize + validate the shootout tallies for a result about to be written.
 * Only a level knockout final can have gone to penalties, and a finished
 * shootout always has a winner. Absent tallies on a level knockout score are
 * legal (feed gap / admin doesn't know them yet) — the bracket simply can't
 * name the advancer until they arrive.
 */
function validatePens(
  match: MatchRow,
  input: EnterResultInput,
): { homePens: number | null; awayPens: number | null } {
  const homePens = input.homePens ?? null;
  const awayPens = input.awayPens ?? null;
  if (homePens === null && awayPens === null) return { homePens: null, awayPens: null };
  if (homePens === null || awayPens === null) {
    throw new AppError('enter both shootout scores or neither', 400);
  }
  validateScore('homePens', homePens);
  validateScore('awayPens', awayPens);
  if (match.stage === 'group') {
    throw new AppError('shootout scores only apply to knockout matches', 400);
  }
  if (input.homeScore !== input.awayScore) {
    throw new AppError('shootout scores only apply when the match ends level', 400);
  }
  if (homePens === awayPens) {
    throw new AppError('a shootout cannot end level — one side must win it', 400);
  }
  return { homePens, awayPens };
}

/** Shared write+recompute for a final result. `source` records who entered it. */
function writeResult(
  db: Db,
  match: MatchRow,
  input: EnterResultInput,
  source: 'manual' | 'auto',
): MatchRow {
  validateScore('homeScore', input.homeScore);
  validateScore('awayScore', input.awayScore);

  let firstScorer = input.firstScorer;
  let firstScoringTeam: 'home' | 'away' | 'none' = input.firstScoringTeam;
  if (input.homeScore + input.awayScore === 0) {
    firstScorer = null;
    firstScoringTeam = 'none';
  } else if (firstScoringTeam !== 'home' && firstScoringTeam !== 'away') {
    throw new AppError(
      "firstScoringTeam must be 'home' or 'away' when goals were scored",
      400,
    );
  }
  const { homePens, awayPens } = validatePens(match, input);

  // Result write + recompute commit together: a recompute failure must never
  // leave a stored result with some leagues' points recomputed and others
  // stale. better-sqlite3 runs on a single connection, so statements issued
  // via `db` inside the callback participate in this transaction.
  return db.transaction(() => {
    // Decidability before the write: when a correction turns a DECIDED tie
    // undecidable (re-entered level without tallies), the earlier
    // propagation's child fill is known-stale and must revert.
    const wasDecided = knockoutAdvancers(match) !== null;

    const updated = db
      .update(schema.matches)
      .set({
        status: 'finished',
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        homePens,
        awayPens,
        firstScorer,
        firstScoringTeam,
        resultSource: source,
        // a final result clears any lingering live state
        liveHome: null,
        liveAway: null,
        liveStatus: null,
        liveFirstScorer: null,
        liveFirstScoringTeam: null,
        liveClock: null,
        liveHomePens: null,
        liveAwayPens: null,
      })
      .where(eq(schema.matches.id, input.matchId))
      .returning()
      .get();

    recomputeMatch(db, input.matchId);
    // The decided tie flows straight into the next round's slot — the
    // bracket and pick screens must never wait for an external team fill.
    propagateMatch(db, updated, {
      revertWhenFinished: wasDecided && knockoutAdvancers(updated) === null,
    });
    return updated;
  });
}

/** Enter (or re-enter — results are editable) a final result, then recompute points. */
export function enterResult(db: Db, adminUserId: number, input: EnterResultInput): MatchRow {
  requireResultsAdmin(db, adminUserId);
  const match = getMatchOrThrow(db, input.matchId);
  return writeResult(db, match, input, 'manual');
}

/**
 * Auto-sync entry point (no user — called by the server's feed poller). Trusted
 * caller, so no admin check. NEVER overwrites a result an admin typed by hand:
 * a 'manual' result is the admin's final word.
 */
export function enterResultAuto(db: Db, input: EnterResultInput): MatchRow | null {
  const match = getMatchOrThrow(db, input.matchId);
  if (match.resultSource === 'manual') return null;
  return writeResult(db, match, input, 'auto');
}

/** Record an in-progress live score from the feed (display only; never scores points). */
export function setLiveScore(
  db: Db,
  input: {
    matchId: number;
    liveHome: number;
    liveAway: number;
    updatedAtMs: number;
    firstScorer?: string | null;
    firstScoringTeam?: 'home' | 'away' | null;
    /** Feed's match clock ("55'", "HT"); minutes accrued, display only. */
    clock?: string | null;
    /** Running shootout tallies while penalties are being taken. */
    liveHomePens?: number | null;
    liveAwayPens?: number | null;
  },
): void {
  const match = getMatchOrThrow(db, input.matchId);
  if (match.resultSource === 'manual' || match.status === 'finished') return;
  // Attribution gap: goals exist but this poll carries no first-goal facts
  // at all (feed served the event without its details). Keep the established
  // facts instead of nulling them — one detail-less response must not flap
  // everyone's provisional scorer/first-team points. A 0-0 snapshot DOES
  // clear them (VAR can erase the only goal), and any attributed poll
  // (even scorer-null own-goal attribution) replaces them verbatim.
  const incomingScorer = input.firstScorer ?? null;
  const incomingTeam = input.firstScoringTeam ?? null;
  const attributionGap =
    input.liveHome + input.liveAway > 0 && incomingScorer === null && incomingTeam === null;
  // Same rule for a mid-shootout tallies gap: kicks never un-happen live;
  // the final result write clears all live state anyway.
  const pensGap = (input.liveHomePens ?? null) === null && (input.liveAwayPens ?? null) === null;
  db.update(schema.matches)
    .set({
      liveHome: input.liveHome,
      liveAway: input.liveAway,
      liveStatus: 'in',
      liveUpdatedAt: input.updatedAtMs,
      liveFirstScorer: attributionGap ? match.liveFirstScorer : incomingScorer,
      liveFirstScoringTeam: attributionGap ? match.liveFirstScoringTeam : incomingTeam,
      liveClock: input.clock ?? null,
      liveHomePens: pensGap ? match.liveHomePens : (input.liveHomePens ?? null),
      liveAwayPens: pensGap ? match.liveAwayPens : (input.liveAwayPens ?? null),
    })
    .where(eq(schema.matches.id, input.matchId))
    .run();
}

/**
 * Revert a (possibly mistaken) result: back to 'scheduled', score fields
 * cleared, and every league's points for the match deleted via recomputeMatch.
 * Without this, one wrong save against the 104-row admin form would mark an
 * unplayed match finished forever and award phantom points.
 */
export function clearResult(db: Db, adminUserId: number, matchId: number): MatchRow {
  requireResultsAdmin(db, adminUserId);
  const match = getMatchOrThrow(db, matchId);
  if (match.status !== 'finished') {
    throw new AppError('match has no result to clear', 409);
  }
  return db.transaction(() => {
    const updated = db
      .update(schema.matches)
      .set({
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        homePens: null,
        awayPens: null,
        firstScorer: null,
        firstScoringTeam: null,
        resultSource: null,
      })
      .where(eq(schema.matches.id, matchId))
      .returning()
      .get();

    recomputeMatch(db, matchId); // not finished → deletes the matchPoints rows
    // The tie is undecided again: any next-round slot we filled from it
    // reverts to its seeded placeholder (deliberate admin fills stay).
    propagateMatch(db, updated);
    return updated;
  });
}

/** Assign real teams to a knockout slot once the bracket resolves; clears placeholders. */
export function setMatchTeams(
  db: Db,
  adminUserId: number,
  input: SetMatchTeamsInput,
): MatchRow {
  requireResultsAdmin(db, adminUserId);
  const match = getMatchOrThrow(db, input.matchId);
  if (match.stage === 'group') {
    throw new AppError('teams can only be assigned on knockout matches', 400);
  }
  const found = db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(inArray(schema.teams.id, [input.homeTeamId, input.awayTeamId]))
    .all();
  if (!found.some((t) => t.id === input.homeTeamId)) {
    throw new AppError('home team not found', 404);
  }
  if (!found.some((t) => t.id === input.awayTeamId)) {
    throw new AppError('away team not found', 404);
  }
  if (input.homeTeamId === input.awayTeamId) {
    throw new AppError('home and away teams must differ', 400);
  }

  // An underdog flag pointing at a team no longer in the match must not
  // linger: on the next recompute a stale id can silently drop the bonus or
  // flip it onto the wrong side.
  const keepUnderdog =
    match.underdogTeamId !== null &&
    (match.underdogTeamId === input.homeTeamId ||
      match.underdogTeamId === input.awayTeamId);

  return db.transaction(() => {
    const updated = db
      .update(schema.matches)
      .set({
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
        homePlaceholder: null,
        awayPlaceholder: null,
        underdogTeamId: keepUnderdog ? match.underdogTeamId : null,
      })
      .where(eq(schema.matches.id, input.matchId))
      .returning()
      .get();

    // Mirrors setUnderdog: a team correction on an already-finished match
    // changes underdog sides, so the stored points must follow immediately.
    if (match.status === 'finished') {
      recomputeMatch(db, input.matchId);
      // The corrected pair also changes who advanced: the child slot still
      // holds the OLD pair's winner, so that team must be replaceable too.
      propagateMatch(db, updated, {
        alsoReplaceable: [match.homeTeamId, match.awayTeamId].filter(
          (id): id is number => id !== null,
        ),
      });
    }
    return updated;
  });
}

/** Flag (or clear) the underdog of a match; recomputes points if already finished. */
export function setUnderdog(
  db: Db,
  adminUserId: number,
  input: SetUnderdogInput,
): MatchRow {
  requireResultsAdmin(db, adminUserId);
  const match = getMatchOrThrow(db, input.matchId);
  if (
    input.underdogTeamId !== null &&
    input.underdogTeamId !== match.homeTeamId &&
    input.underdogTeamId !== match.awayTeamId
  ) {
    throw new AppError("underdog must be one of the match's teams", 400);
  }

  return db.transaction(() => {
    const updated = db
      .update(schema.matches)
      .set({ underdogTeamId: input.underdogTeamId })
      .where(eq(schema.matches.id, input.matchId))
      .returning()
      .get();

    if (match.status === 'finished') recomputeMatch(db, input.matchId);
    return updated;
  });
}

function underdogSideOf(match: MatchRow): 'home' | 'away' | null {
  if (match.underdogTeamId === null) return null;
  if (match.homeTeamId !== null && match.underdogTeamId === match.homeTeamId) return 'home';
  if (match.awayTeamId !== null && match.underdogTeamId === match.awayTeamId) return 'away';
  return null;
}

function resultInputOf(match: MatchRow): ResultInput {
  return {
    homeScore: match.homeScore ?? 0,
    awayScore: match.awayScore ?? 0,
    firstScorer: match.firstScorer,
    firstScoringTeam: (match.firstScoringTeam ?? 'none') as 'home' | 'away' | 'none',
    underdogSide: underdogSideOf(match),
    stage: match.stage as Stage,
  };
}

/** Score every pick of one league on one finished match and upsert matchPoints. */
function recomputeMatchForLeague(db: Db, match: MatchRow, league: LeagueRow): void {
  const rules = JSON.parse(league.scoringRules) as ScoringRules;
  const multipliers = JSON.parse(league.roundMultipliers) as Record<string, number>;
  const roundMultiplier = multipliers[match.stage] ?? 1;
  const result = resultInputOf(match);

  const rows = db
    .select({ pick: schema.picks })
    .from(schema.picks)
    .innerJoin(schema.entries, eq(schema.picks.entryId, schema.entries.id))
    .where(and(eq(schema.picks.matchId, match.id), eq(schema.entries.leagueId, league.id)))
    .all();
  if (rows.length === 0) return;

  const entryIds = rows.map((r) => r.pick.entryId);
  const boosterRows = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        eq(schema.boosters.matchday, match.matchday),
        inArray(schema.boosters.entryId, entryIds),
      ),
    )
    .all();
  const boostedEntryIds = new Set(
    boosterRows.filter((b) => b.matchId === match.id).map((b) => b.entryId),
  );

  for (const { pick } of rows) {
    const pickInput: PickInput = {
      predHome: pick.predHome,
      predAway: pick.predAway,
      predScorer: pick.predScorer,
      predFirstTeam: pick.predFirstTeam as PickInput['predFirstTeam'],
    };
    const breakdown = scorePick(pickInput, result, rules, {
      roundMultiplier,
      boosted: boostedEntryIds.has(pick.entryId),
      boosterMultiplier: league.boosterMultiplier,
    });
    db.insert(schema.matchPoints)
      .values({
        entryId: pick.entryId,
        matchId: match.id,
        breakdown: JSON.stringify(breakdown),
        total: breakdown.total,
      })
      .onConflictDoUpdate({
        target: [schema.matchPoints.entryId, schema.matchPoints.matchId],
        set: { breakdown: JSON.stringify(breakdown), total: breakdown.total },
      })
      .run();
  }
}

/**
 * Recompute matchPoints for one match across EVERY league. If the match is not
 * finished, all of its matchPoints rows are deleted instead.
 */
export function recomputeMatch(db: Db, matchId: number): void {
  const match = getMatchOrThrow(db, matchId);
  if (match.status !== 'finished') {
    db.delete(schema.matchPoints).where(eq(schema.matchPoints.matchId, matchId)).run();
    return;
  }
  const leagues = db.select().from(schema.leagues).all();
  for (const league of leagues) {
    recomputeMatchForLeague(db, match, league);
  }
}

/** Recompute all finished matches, but only for one league's entries. */
export function recomputeLeague(db: Db, leagueId: number): void {
  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) throw new AppError('league not found', 404);
  const finished = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all();
  for (const match of finished) {
    recomputeMatchForLeague(db, match, league);
  }
}
