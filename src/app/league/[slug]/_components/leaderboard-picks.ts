/**
 * Server-only helper: every entry's picks on the current matchday's LOCKED or
 * FINISHED matches — the leaderboard's expandable "what did they pick" reveal.
 *
 * Privacy rule (hard): a pick is only serialized once its match has kicked
 * off (locked) or finished. Open picks never leave the server through this
 * helper, so rivals can't scout each other's pending predictions.
 *
 * NEVER import this from a 'use client' component (it touches the db).
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { canonicalScorer } from '@/lib/scoring';
import type { BreakdownView, FirstTeam, LockedPickView } from './types';

function parseBreakdown(raw: string): BreakdownView | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as BreakdownView)
      : null;
  } catch {
    return null;
  }
}

/** Map of entryId → locked-pick rows for the latest kicked-off matchday. */
export function getLockedPicksByEntry(
  db: Db,
  leagueId: number,
): Map<number, LockedPickView[]> {
  const entryRows = db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entryRows.length === 0) return new Map();
  const entryIds = entryRows.map((r) => r.id);

  const matches = db.select().from(schema.matches).all();

  // Same "today" definition as the +N delta (today-points.ts): the latest
  // matchday with at least one kicked-off match per the game clock.
  const now = nowMs();
  let latestDay: string | null = null;
  for (const m of matches) {
    if (Date.parse(m.kickoffUtc) <= now) {
      if (latestDay === null || m.matchday > latestDay) latestDay = m.matchday;
    }
  }
  if (latestDay === null) return new Map();

  // Locked/finished fixtures only — an unkicked match on the same day is
  // still open and MUST stay out of the payload.
  const dayMatches = matches
    .filter(
      (m) =>
        m.matchday === latestDay &&
        (m.status === 'finished' || Date.parse(m.kickoffUtc) <= now),
    )
    .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc) || a.id - b.id);
  if (dayMatches.length === 0) return new Map();
  const dayMatchIds = dayMatches.map((m) => m.id);

  const teamById = new Map(
    db.select().from(schema.teams).all().map((t) => [t.id, t]),
  );

  // Squads for the day's teams — scorer picks render with the canonical squad
  // spelling ("Raul Jimenez" → "Raúl Jiménez"), matching the live board's
  // "First goal:" line directly above these rows.
  const dayTeamIds = [
    ...new Set(
      dayMatches
        .flatMap((m) => [m.homeTeamId, m.awayTeamId])
        .filter((id): id is number => id !== null),
    ),
  ];
  const squadByTeam = new Map<number, string[]>();
  if (dayTeamIds.length > 0) {
    for (const p of db
      .select({ teamId: schema.players.teamId, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.teamId, dayTeamIds))
      .all()) {
      const list = squadByTeam.get(p.teamId) ?? [];
      list.push(p.name);
      squadByTeam.set(p.teamId, list);
    }
  }
  const squadOf = (teamId: number | null) =>
    teamId !== null ? (squadByTeam.get(teamId) ?? []) : [];

  const pickRows = db
    .select()
    .from(schema.picks)
    .where(inArray(schema.picks.matchId, dayMatchIds))
    .all();
  const pickByEntryMatch = new Map(
    pickRows.map((p) => [`${p.entryId}:${p.matchId}`, p]),
  );

  const pointRows = db
    .select()
    .from(schema.matchPoints)
    .where(inArray(schema.matchPoints.matchId, dayMatchIds))
    .all();
  const pointsByEntryMatch = new Map(
    pointRows.map((p) => [`${p.entryId}:${p.matchId}`, p]),
  );

  const out = new Map<number, LockedPickView[]>();
  for (const entryId of entryIds) {
    const rows: LockedPickView[] = dayMatches.map((m) => {
      const pick = pickByEntryMatch.get(`${entryId}:${m.id}`) ?? null;
      const pts = pointsByEntryMatch.get(`${entryId}:${m.id}`) ?? null;
      const home = m.homeTeamId !== null ? teamById.get(m.homeTeamId) : null;
      const away = m.awayTeamId !== null ? teamById.get(m.awayTeamId) : null;
      return {
        matchId: m.id,
        matchday: m.matchday,
        homeName: home?.name ?? m.homePlaceholder ?? 'TBD',
        awayName: away?.name ?? m.awayPlaceholder ?? 'TBD',
        homeCode: home?.code ?? null,
        awayCode: away?.code ?? null,
        status: m.status === 'finished' ? 'finished' : 'scheduled',
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        liveHome: m.liveHome,
        liveAway: m.liveAway,
        liveStatus: m.liveStatus,
        pick: pick
          ? {
              predHome: pick.predHome,
              predAway: pick.predAway,
              predScorer: canonicalScorer(pick.predScorer, [
                ...squadOf(m.homeTeamId),
                ...squadOf(m.awayTeamId),
              ]),
              predFirstTeam: (pick.predFirstTeam as FirstTeam | null) ?? null,
            }
          : null,
        points: pts
          ? { total: pts.total, breakdown: parseBreakdown(pts.breakdown) }
          : null,
      };
    });
    out.set(entryId, rows);
  }
  return out;
}
