/**
 * Leaderboard service: league standings derived from matchPoints, plus per-entry
 * stats (streaks, accuracy, badges) for the profile screen.
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';
import type { PointsBreakdown } from '@/lib/scoring';

export interface LeaderboardRow {
  rank: number;
  entryId: number;
  userId: number;
  label: string;
  displayName: string;
  total: number;
  exactCount: number;
  scorerHits: number;
  outcomeCount: number;
  /** Epoch ms of the entry's latest pick update; null when the entry has no picks. */
  lastPickAt: number | null;
}

export interface EntryStats {
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

type Standing = Omit<LeaderboardRow, 'rank'>;

/**
 * Admin-configurable REAL multipliers make totals floats, and float sums
 * depend on addend order — two mathematically equal totals can differ by
 * ~1e-13 and silently skip the contractual tiebreaks. Round to micro-points
 * before comparing or displaying.
 */
function roundTotal(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function compareStandings(a: Standing, b: Standing): number {
  if (a.total !== b.total) return b.total - a.total;
  if (a.exactCount !== b.exactCount) return b.exactCount - a.exactCount;
  if (a.scorerHits !== b.scorerHits) return b.scorerHits - a.scorerHits;
  const la = a.lastPickAt ?? Infinity; // entries without picks sort last on this key
  const lb = b.lastPickAt ?? Infinity;
  if (la !== lb) return la - lb;
  return a.entryId - b.entryId;
}

/** Standings for one league, sorted and assigned unique ranks 1..n. */
export function getLeaderboard(db: Db, leagueId: number): LeaderboardRow[] {
  const entryRows = db
    .select({ entry: schema.entries, user: schema.users })
    .from(schema.entries)
    .innerJoin(schema.users, eq(schema.entries.userId, schema.users.id))
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entryRows.length === 0) return [];

  const entryIds = entryRows.map((r) => r.entry.id);
  const pointRows = db
    .select()
    .from(schema.matchPoints)
    .where(inArray(schema.matchPoints.entryId, entryIds))
    .all();
  const pickRows = db
    .select({ entryId: schema.picks.entryId, updatedAt: schema.picks.updatedAt })
    .from(schema.picks)
    .where(inArray(schema.picks.entryId, entryIds))
    .all();

  const totals = new Map<
    number,
    { total: number; exactCount: number; scorerHits: number; outcomeCount: number }
  >();
  for (const mp of pointRows) {
    const agg = totals.get(mp.entryId) ?? {
      total: 0,
      exactCount: 0,
      scorerHits: 0,
      outcomeCount: 0,
    };
    const breakdown = JSON.parse(mp.breakdown) as PointsBreakdown;
    agg.total += mp.total;
    if (breakdown.exact > 0) agg.exactCount += 1;
    if (breakdown.scorer > 0) agg.scorerHits += 1;
    if (breakdown.outcome > 0) agg.outcomeCount += 1;
    totals.set(mp.entryId, agg);
  }

  const lastPickAt = new Map<number, number>();
  for (const p of pickRows) {
    const prev = lastPickAt.get(p.entryId);
    if (prev === undefined || p.updatedAt > prev) lastPickAt.set(p.entryId, p.updatedAt);
  }

  const standings: Standing[] = entryRows.map(({ entry, user }) => {
    const agg = totals.get(entry.id);
    return {
      entryId: entry.id,
      userId: entry.userId,
      label: entry.label,
      displayName: user.displayName,
      total: roundTotal(agg?.total ?? 0),
      exactCount: agg?.exactCount ?? 0,
      scorerHits: agg?.scorerHits ?? 0,
      outcomeCount: agg?.outcomeCount ?? 0,
      lastPickAt: lastPickAt.get(entry.id) ?? null,
    };
  });

  standings.sort(compareStandings);
  return standings.map((row, i) => ({ rank: i + 1, ...row }));
}

/** Profile stats for one entry: totals, streaks over finished picked matches, badges. */
export function getEntryStats(db: Db, entryId: number): EntryStats {
  const entry = db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId))
    .get();
  if (!entry) throw new AppError('entry not found', 404);

  const pickRows = db
    .select()
    .from(schema.picks)
    .where(eq(schema.picks.entryId, entryId))
    .all();
  const pointRows = db
    .select()
    .from(schema.matchPoints)
    .where(eq(schema.matchPoints.entryId, entryId))
    .all();
  const finishedMatches = db
    .select({ id: schema.matches.id, kickoffUtc: schema.matches.kickoffUtc })
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all();

  let total = 0;
  let exactCount = 0;
  let scorerHits = 0;
  const totalByMatch = new Map<number, number>();
  for (const mp of pointRows) {
    const breakdown = JSON.parse(mp.breakdown) as PointsBreakdown;
    total += mp.total;
    if (breakdown.exact > 0) exactCount += 1;
    if (breakdown.scorer > 0) scorerHits += 1;
    totalByMatch.set(mp.matchId, mp.total);
  }

  const pickedMatchIds = new Set(pickRows.map((p) => p.matchId));
  const finishedPickedMatches = finishedMatches
    .filter((m) => pickedMatchIds.has(m.id))
    .sort((a, b) =>
      a.kickoffUtc === b.kickoffUtc
        ? a.id - b.id
        : a.kickoffUtc < b.kickoffUtc
          ? -1
          : 1,
    );

  let currentStreak = 0;
  let bestStreak = 0;
  let scoredCount = 0;
  for (const m of finishedPickedMatches) {
    if ((totalByMatch.get(m.id) ?? 0) > 0) {
      currentStreak += 1;
      scoredCount += 1;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const finishedPicked = finishedPickedMatches.length;
  const accuracyPct =
    finishedPicked === 0 ? 0 : Math.round((scoredCount / finishedPicked) * 100);

  const badges: string[] = [];
  if (exactCount >= 1) badges.push('First Exact');
  if (exactCount >= 3) badges.push('Sniper');
  if (scorerHits >= 5) badges.push('Golden Boot Whisperer');
  if (bestStreak >= 5) badges.push('Hot Streak');
  if (finishedMatches.length > 0 && finishedPicked === finishedMatches.length) {
    badges.push('Ever Present');
  }

  return {
    total: roundTotal(total),
    exactCount,
    scorerHits,
    picksMade: pickRows.length,
    finishedPicked,
    accuracyPct,
    currentStreak,
    bestStreak,
    badges,
  };
}
