/**
 * Today service: the "current matchday" board (canonical per CONTRACTS.md: the
 * next matchday with any unkicked-off match, plus any in-progress — kicked off
 * but unfinished — matches carried over from earlier matchdays) and the full
 * schedule for History/admin.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
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
 * Board for the current matchday: the earliest matchday that still has a match
 * you could act on (unkicked-off AND unfinished), plus any in-progress matches
 * (kicked off, unfinished) carried over from earlier matchdays. Pinning the
 * board to a fully-kicked-off day awaiting results would hide the next day's
 * pick forms until those picks were irreversibly locked.
 * Falls back to the earliest matchday awaiting results, then the last matchday
 * once the tournament is fully finished.
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

  const allMatches = db
    .select()
    .from(schema.matches)
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();
  if (allMatches.length === 0) return { matchday: null, matches: [] };

  const nowEpochMs = nowMs();
  const kickedOff = (m: MatchRow) => nowEpochMs >= Date.parse(m.kickoffUtc);

  // Earliest matchday with an actionable (unkicked, unfinished) match …
  let matchday: string | null = null;
  for (const m of allMatches) {
    if (m.status !== 'finished' && !kickedOff(m)) {
      if (matchday === null || m.matchday < matchday) matchday = m.matchday;
    }
  }
  // … else the earliest matchday still awaiting results …
  if (matchday === null) {
    for (const m of allMatches) {
      if (m.status !== 'finished' && (matchday === null || m.matchday < matchday)) {
        matchday = m.matchday;
      }
    }
  }
  // … else (everything finished) the final matchday.
  if (matchday === null) {
    matchday = allMatches.reduce(
      (max, m) => (m.matchday > max ? m.matchday : max),
      allMatches[0]!.matchday,
    );
  }

  const selected = matchday;
  // The whole selected day, plus in-progress carryover from earlier days
  // (already in kickoff order thanks to the ordered scan).
  const boardMatches = allMatches.filter(
    (m) =>
      m.matchday === selected ||
      (m.matchday < selected && m.status !== 'finished' && kickedOff(m)),
  );

  const teamMap = teamMapOf(db);
  const myPicks = new Map(
    db
      .select()
      .from(schema.picks)
      .where(eq(schema.picks.entryId, entryId))
      .all()
      .map((p) => [p.matchId, p]),
  );
  // The board can span more than one matchday — boosters are per matchday.
  const boardDays = [...new Set(boardMatches.map((m) => m.matchday))];
  const boosterRows = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        eq(schema.boosters.entryId, entryId),
        inArray(schema.boosters.matchday, boardDays),
      ),
    )
    .all();
  const boosterByDay = new Map(boosterRows.map((b) => [b.matchday, b]));

  const items: TodayBoardItem[] = boardMatches.map((match) => ({
    match,
    teams: teamsOf(match, teamMap),
    myPick: myPicks.get(match.id) ?? null,
    booster: boosterByDay.get(match.matchday)?.matchId === match.id,
    locked: nowEpochMs >= Date.parse(match.kickoffUtc),
  }));

  return { matchday: selected, matches: items };
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
