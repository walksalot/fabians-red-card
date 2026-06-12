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
function requireLeagueEntry(db: Db, leagueId: number, entryId: number): void {
  const entry = db
    .select()
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId))
    .get();
  if (!entry) throw new AppError('entry not found', 404);
  if (entry.leagueId !== leagueId) {
    throw new AppError('entry does not belong to this league', 403);
  }
}

/** The matchday Today should land on by default (see getTodayBoard's doc). */
export function resolveCurrentMatchday(
  allMatches: MatchRow[],
  nowEpochMs: number,
): string | null {
  if (allMatches.length === 0) return null;
  const kickedOff = (m: MatchRow) => nowEpochMs >= Date.parse(m.kickoffUtc);
  let matchday: string | null = null;
  for (const m of allMatches) {
    if (m.status !== 'finished' && !kickedOff(m)) {
      if (matchday === null || m.matchday < matchday) matchday = m.matchday;
    }
  }
  if (matchday === null) {
    for (const m of allMatches) {
      if (m.status !== 'finished' && (matchday === null || m.matchday < matchday)) {
        matchday = m.matchday;
      }
    }
  }
  if (matchday === null) {
    matchday = allMatches.reduce(
      (max, m) => (m.matchday > max ? m.matchday : max),
      allMatches[0]!.matchday,
    );
  }
  return matchday;
}

export function getTodayBoard(
  db: Db,
  leagueId: number,
  entryId: number,
  /** A specific matchday to view (the day browser); must be >= the current day. */
  requestedDay?: string,
): TodayBoard {
  requireLeagueEntry(db, leagueId, entryId);

  const allMatches = db
    .select()
    .from(schema.matches)
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();
  if (allMatches.length === 0) return { matchday: null, matches: [] };

  const nowEpochMs = nowMs();
  const kickedOff = (m: MatchRow) => nowEpochMs >= Date.parse(m.kickoffUtc);
  const currentDay = resolveCurrentMatchday(allMatches, nowEpochMs)!;

  // Past days belong to History; unknown days fall back to the current one.
  const validDays = new Set(allMatches.map((m) => m.matchday));
  const selected =
    requestedDay !== undefined && validDays.has(requestedDay) && requestedDay >= currentDay
      ? requestedDay
      : currentDay;
  // The whole selected day, plus in-progress carryover from earlier days
  // (already in kickoff order thanks to the ordered scan).
  const boardMatches = allMatches.filter(
    (m) =>
      m.matchday === selected ||
      // in-progress carryover from earlier days — only on the default view
      (selected === currentDay &&
        m.matchday < selected &&
        m.status !== 'finished' &&
        kickedOff(m)),
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

export interface MatchdaySummary {
  matchday: string;
  matchCount: number;
  /** This entry's saved picks on the day. */
  pickedCount: number;
  boosterArmed: boolean;
  firstKickoffUtc: string;
  /** Every match still lacks a team — picking is impossible (bracket pending). */
  allTbd: boolean;
}

export interface MatchdayOverview {
  /** The day Today lands on by default. */
  currentDay: string | null;
  days: MatchdaySummary[];
  /** True when the matchday after the current one still has unpicked matches. */
  nextDayHasGaps: boolean;
}

/**
 * The day-browser's map: every matchday from the current one forward, with
 * this entry's pick progress and booster state per day. Past days are
 * History's territory and are excluded on purpose.
 */
export function getMatchdayOverview(
  db: Db,
  leagueId: number,
  entryId: number,
): MatchdayOverview {
  requireLeagueEntry(db, leagueId, entryId);

  const allMatches = db
    .select()
    .from(schema.matches)
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();
  const currentDay = resolveCurrentMatchday(allMatches, nowMs());
  if (currentDay === null) return { currentDay: null, days: [], nextDayHasGaps: false };

  const picks = new Set(
    db
      .select({ matchId: schema.picks.matchId })
      .from(schema.picks)
      .where(eq(schema.picks.entryId, entryId))
      .all()
      .map((p) => p.matchId),
  );
  const boosters = new Set(
    db
      .select({ matchday: schema.boosters.matchday })
      .from(schema.boosters)
      .where(eq(schema.boosters.entryId, entryId))
      .all()
      .map((b) => b.matchday),
  );

  const byDay = new Map<string, MatchRow[]>();
  for (const m of allMatches) {
    if (m.matchday < currentDay) continue;
    const list = byDay.get(m.matchday) ?? [];
    list.push(m);
    byDay.set(m.matchday, list);
  }

  const days: MatchdaySummary[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([matchday, matches]) => ({
      matchday,
      matchCount: matches.length,
      pickedCount: matches.filter((m) => picks.has(m.id)).length,
      boosterArmed: boosters.has(matchday),
      firstKickoffUtc: matches[0]!.kickoffUtc,
      allTbd: matches.every(
        (m) => m.homeTeamId === null || m.awayTeamId === null,
      ),
    }));

  const next = days.find((d) => d.matchday > currentDay);
  return {
    currentDay,
    days,
    nextDayHasGaps: next !== undefined && next.pickedCount < next.matchCount,
  };
}
