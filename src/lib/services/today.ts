/**
 * Today service: the "current matchday" board (canonical: the earliest matchday
 * that still has any unfinished match) and the full schedule for History/admin.
 */
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { AppError } from '@/lib/errors';

type MatchRow = typeof schema.matches.$inferSelect;
type TeamRow = typeof schema.teams.$inferSelect;
type PickRow = typeof schema.picks.$inferSelect;

export interface TodayBoardItem {
  match: MatchRow;
  teams: { home: TeamRow | null; away: TeamRow | null };
  myPick: PickRow | null;
  /** True when this entry's booster for the matchday targets this match. */
  booster: boolean;
  /** True when clock.now() >= kickoff (picks locked). */
  locked: boolean;
}

export interface TodayBoard {
  /** YYYY-MM-DD; null only when the matches table is empty. */
  matchday: string | null;
  matches: TodayBoardItem[];
}

export interface ScheduleItem {
  match: MatchRow;
  homeTeam: TeamRow | null;
  awayTeam: TeamRow | null;
}

function teamMapOf(db: Db): Map<number, TeamRow> {
  return new Map(db.select().from(schema.teams).all().map((t) => [t.id, t]));
}

function teamsOf(match: MatchRow, teamMap: Map<number, TeamRow>) {
  return {
    home: match.homeTeamId !== null ? (teamMap.get(match.homeTeamId) ?? null) : null,
    away: match.awayTeamId !== null ? (teamMap.get(match.awayTeamId) ?? null) : null,
  };
}

/**
 * Board for the current matchday: the earliest matchday containing any unfinished
 * match (falls back to the last matchday once the tournament is fully finished).
 * Returns ALL matches of that matchday with the entry's picks/booster/lock state.
 */
export function getTodayBoard(db: Db, leagueId: number, entryId: number): TodayBoard {
  const entry = db
    .select()
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId))
    .get();
  if (!entry) throw new AppError('entry not found', 404);
  if (entry.leagueId !== leagueId) {
    throw new AppError('entry does not belong to this league', 403);
  }

  const firstUnfinished = db
    .select({ matchday: schema.matches.matchday })
    .from(schema.matches)
    .where(ne(schema.matches.status, 'finished'))
    .orderBy(asc(schema.matches.matchday))
    .limit(1)
    .get();
  let matchday = firstUnfinished?.matchday ?? null;
  if (matchday === null) {
    const lastDay = db
      .select({ matchday: schema.matches.matchday })
      .from(schema.matches)
      .orderBy(desc(schema.matches.matchday))
      .limit(1)
      .get();
    matchday = lastDay?.matchday ?? null;
  }
  if (matchday === null) return { matchday: null, matches: [] };

  const dayMatches = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.matchday, matchday))
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();

  const teamMap = teamMapOf(db);
  const myPicks = new Map(
    db
      .select()
      .from(schema.picks)
      .where(eq(schema.picks.entryId, entryId))
      .all()
      .map((p) => [p.matchId, p]),
  );
  const boosterRow = db
    .select()
    .from(schema.boosters)
    .where(
      and(eq(schema.boosters.entryId, entryId), eq(schema.boosters.matchday, matchday)),
    )
    .get();
  const nowEpochMs = nowMs();

  const items: TodayBoardItem[] = dayMatches.map((match) => ({
    match,
    teams: teamsOf(match, teamMap),
    myPick: myPicks.get(match.id) ?? null,
    booster: boosterRow?.matchId === match.id,
    locked: nowEpochMs >= Date.parse(match.kickoffUtc),
  }));

  return { matchday, matches: items };
}

/** Every match with team rows joined, ordered by official match number. */
export function getSchedule(db: Db): ScheduleItem[] {
  const teamMap = teamMapOf(db);
  return db
    .select()
    .from(schema.matches)
    .orderBy(asc(schema.matches.id))
    .all()
    .map((match) => {
      const teams = teamsOf(match, teamMap);
      return { match, homeTeam: teams.home, awayTeam: teams.away };
    });
}
