/**
 * Matchday Wrap: the day's recap across EVERY entry in a league — day winner,
 * biggest single-match haul, exact counts, blanks, and sole-caller shoutouts.
 * Pure read-side aggregation of already-banked matchPoints; nothing here can
 * touch scoring. Display-only by contract with the league (wagers are set).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { PointsBreakdown } from '@/lib/scoring';

export interface WrapEntryDay {
  entryId: number;
  label: string;
  total: number;
}

export interface MatchdayWrap {
  matchday: string;
  matchCount: number;
  entryCount: number;
  /** Every entry's day total, sorted descending (ties keep entryId order). */
  dayTotals: WrapEntryDay[];
  /** Highest day total (may be shared). */
  dayWinners: WrapEntryDay[];
  /**
   * Biggest single-match haul of the day — EVERY entry/match pair that hit
   * the top number, not an arbitrary first-seen one. Ties are the norm here
   * (a popular exact score pays everyone the same), so crediting one entry
   * would invent a winner. Holders sorted by entryId then matchId.
   */
  biggestHaul: {
    points: number;
    holders: Array<{ entryId: number; label: string; matchId: number }>;
  } | null;
  /** Entries that banked zero across the whole day (only when they had picks to make). */
  blankedCount: number;
  exactCount: number;
  /**
   * Sole-caller: matches where EXACTLY ONE entry got the result right
   * (outcome or exact) — the day's "only X saw it coming" line.
   */
  soleCalls: Array<{ entryId: number; label: string; matchId: number }>;
}

/** Tournament-to-date facts for the Table page's display-only league recap. */
export interface LeagueLore {
  settledPicks: number;
  settledMatches: number;
  exactCount: number;
  scorerHits: number;
  underdogHits: number;
  /** Extra points earned above the same picks without their booster. */
  boosterBonus: number;
  /** Entry-days with at least one settled pick and zero total points. */
  blankEntryDays: number;
  biggestHaul: {
    points: number;
    labels: string[];
    fixtures: string[];
  } | null;
  loneCallCount: number;
  latestLoneCall: { label: string; fixture: string } | null;
  /** The six most recent matchdays with settled picks, oldest to newest. */
  pulse: Array<{ matchday: string; total: number }>;
}

/**
 * Compute the wrap for one FINISHED matchday. Returns null when the day has
 * no finished matches (a wrap for an unplayed day would be an empty brag).
 */
export function computeMatchdayWrap(
  db: Db,
  leagueId: number,
  matchday: string,
): MatchdayWrap | null {
  const dayMatches = db
    .select()
    .from(schema.matches)
    .where(
      and(eq(schema.matches.matchday, matchday), eq(schema.matches.status, 'finished')),
    )
    .all();
  if (dayMatches.length === 0) return null;
  const matchIds = dayMatches.map((m) => m.id);

  const entries = db
    .select({ id: schema.entries.id, label: schema.entries.label })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entries.length === 0) return null;
  const labelOf = new Map(entries.map((e) => [e.id, e.label]));
  const entryIds = entries.map((e) => e.id);

  const points = db
    .select()
    .from(schema.matchPoints)
    .where(
      and(
        inArray(schema.matchPoints.matchId, matchIds),
        inArray(schema.matchPoints.entryId, entryIds),
      ),
    )
    .all();

  const totals = new Map<number, number>(entries.map((e) => [e.id, 0]));
  let bestPoints = 0;
  let bestHolders: Array<{ entryId: number; label: string; matchId: number }> = [];
  let exactCount = 0;
  /** matchId -> entryIds that got the result right (exact or outcome). */
  const callers = new Map<number, number[]>();

  const microOf = (n: number): number => Math.round(n * 1e6);
  for (const p of points) {
    totals.set(p.entryId, (totals.get(p.entryId) ?? 0) + p.total);
    if (microOf(p.total) > 0 && microOf(p.total) >= microOf(bestPoints)) {
      if (microOf(p.total) > microOf(bestPoints)) {
        bestPoints = p.total;
        bestHolders = [];
      }
      bestHolders.push({
        entryId: p.entryId,
        label: labelOf.get(p.entryId) ?? '?',
        matchId: p.matchId,
      });
    }
    let bd: PointsBreakdown | null = null;
    try {
      bd = JSON.parse(p.breakdown) as PointsBreakdown;
    } catch {
      bd = null;
    }
    if (bd) {
      if (bd.exact > 0) exactCount += 1;
      if (bd.exact > 0 || bd.outcome > 0) {
        const list = callers.get(p.matchId) ?? [];
        list.push(p.entryId);
        callers.set(p.matchId, list);
      }
    }
  }

  // Micro-point rounding before any equality/threshold, mirroring the
  // leaderboard: round multipliers are floats, and 11.999999999 vs 12 must
  // not split a genuine tie or invent a phantom "blank".
  const micro = (n: number): number => Math.round(n * 1e6);
  const dayTotals: WrapEntryDay[] = entries
    .map((e) => ({ entryId: e.id, label: e.label, total: totals.get(e.id) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.entryId - b.entryId);
  const top = dayTotals[0]?.total ?? 0;
  // A day where nobody scored crowns no winner — "won the day with 0" is a jab
  // the wrap should not make for the app (the group chat can).
  const dayWinners = micro(top) > 0 ? dayTotals.filter((t) => micro(t.total) === micro(top)) : [];
  // "Blanked" means picked and got nothing — an entry with no picks that day
  // (matchPoints rows exist only for picks) skipped it, it didn't blank it.
  const pickedEntryIds = new Set(points.map((p) => p.entryId));
  const blankedCount = dayTotals.filter(
    (t) => pickedEntryIds.has(t.entryId) && micro(t.total) === 0,
  ).length;

  const soleCalls: MatchdayWrap['soleCalls'] = [];
  for (const [matchId, list] of callers) {
    if (list.length === 1) {
      soleCalls.push({
        entryId: list[0],
        label: labelOf.get(list[0]) ?? '?',
        matchId,
      });
    }
  }
  soleCalls.sort((a, b) => a.matchId - b.matchId);
  bestHolders.sort((a, b) => a.entryId - b.entryId || a.matchId - b.matchId);

  return {
    matchday,
    matchCount: dayMatches.length,
    entryCount: entries.length,
    dayTotals,
    dayWinners,
    biggestHaul: bestHolders.length > 0 ? { points: bestPoints, holders: bestHolders } : null,
    blankedCount,
    exactCount,
    soleCalls,
  };
}

/**
 * Compute a tournament-to-date recap from already-banked matchPoints. This is
 * deliberately downstream of the scoring engine: it can describe points but
 * cannot create, alter, or reinterpret them.
 */
export function computeLeagueLore(db: Db, leagueId: number): LeagueLore | null {
  const entries = db
    .select({ id: schema.entries.id, label: schema.entries.label })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entries.length === 0) return null;

  const finishedMatches = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all();
  if (finishedMatches.length === 0) return null;

  const entryIds = entries.map((entry) => entry.id);
  const matchIds = finishedMatches.map((match) => match.id);
  const points = db
    .select()
    .from(schema.matchPoints)
    .where(
      and(
        inArray(schema.matchPoints.entryId, entryIds),
        inArray(schema.matchPoints.matchId, matchIds),
      ),
    )
    .all();
  if (points.length === 0) return null;

  const teams = db.select().from(schema.teams).all();
  const teamCode = new Map(teams.map((team) => [team.id, team.code]));
  const labelOf = new Map(entries.map((entry) => [entry.id, entry.label]));
  const matchOf = new Map(finishedMatches.map((match) => [match.id, match]));
  const fixtureOf = (matchId: number): string => {
    const match = matchOf.get(matchId);
    if (!match) return `Match ${matchId}`;
    const home =
      (match.homeTeamId === null ? null : teamCode.get(match.homeTeamId)) ??
      match.homePlaceholder ??
      'TBD';
    const away =
      (match.awayTeamId === null ? null : teamCode.get(match.awayTeamId)) ??
      match.awayPlaceholder ??
      'TBD';
    return match.homeScore === null || match.awayScore === null
      ? `${home}–${away}`
      : `${home} ${match.homeScore}–${match.awayScore} ${away}`;
  };

  const micro = (value: number): number => Math.round(value * 1e6);
  const dayTotals = new Map<string, number>();
  const entryDayTotals = new Map<string, number>();
  const callersByMatch = new Map<number, number[]>();
  let exactCount = 0;
  let scorerHits = 0;
  let underdogHits = 0;
  let boosterBonus = 0;
  let biggestPoints = 0;
  let biggestHolders: Array<{ entryId: number; matchId: number }> = [];

  for (const point of points) {
    const match = matchOf.get(point.matchId);
    if (!match) continue;
    dayTotals.set(match.matchday, (dayTotals.get(match.matchday) ?? 0) + point.total);
    const entryDayKey = `${point.entryId}:${match.matchday}`;
    entryDayTotals.set(
      entryDayKey,
      (entryDayTotals.get(entryDayKey) ?? 0) + point.total,
    );

    if (micro(point.total) > 0 && micro(point.total) >= micro(biggestPoints)) {
      if (micro(point.total) > micro(biggestPoints)) {
        biggestPoints = point.total;
        biggestHolders = [];
      }
      biggestHolders.push({ entryId: point.entryId, matchId: point.matchId });
    }

    let breakdown: PointsBreakdown | null = null;
    try {
      breakdown = JSON.parse(point.breakdown) as PointsBreakdown;
    } catch {
      // A malformed historical breakdown must not hide the rest of the recap.
    }
    if (!breakdown) continue;
    if (micro(breakdown.exact) > 0) exactCount += 1;
    if (micro(breakdown.scorer) > 0) scorerHits += 1;
    if (micro(breakdown.underdog) > 0) underdogHits += 1;
    if (breakdown.boosterMultiplier > 1) {
      const unboosted = breakdown.base * breakdown.roundMultiplier;
      boosterBonus += Math.max(0, point.total - unboosted);
    }
    if (micro(breakdown.exact) > 0 || micro(breakdown.outcome) > 0) {
      const callers = callersByMatch.get(point.matchId) ?? [];
      callers.push(point.entryId);
      callersByMatch.set(point.matchId, callers);
    }
  }

  const loneCalls = [...callersByMatch.entries()]
    .filter(([, entryIdsForMatch]) => entryIdsForMatch.length === 1)
    .map(([matchId, [entryId]]) => ({
      entryId,
      matchId,
      kickoffUtc: matchOf.get(matchId)?.kickoffUtc ?? '',
    }))
    .sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
  const latestLone = loneCalls.at(-1);

  return {
    settledPicks: points.length,
    settledMatches: new Set(points.map((point) => point.matchId)).size,
    exactCount,
    scorerHits,
    underdogHits,
    boosterBonus: micro(boosterBonus) / 1e6,
    blankEntryDays: [...entryDayTotals.values()].filter((total) => micro(total) === 0)
      .length,
    biggestHaul:
      biggestHolders.length === 0
        ? null
        : {
            points: biggestPoints,
            labels: [
              ...new Set(
                biggestHolders.map(
                  (holder) => labelOf.get(holder.entryId) ?? 'Unknown entry',
                ),
              ),
            ],
            fixtures: [
              ...new Set(biggestHolders.map((holder) => fixtureOf(holder.matchId))),
            ],
          },
    loneCallCount: loneCalls.length,
    latestLoneCall: latestLone
      ? {
          label: labelOf.get(latestLone.entryId) ?? 'Unknown entry',
          fixture: fixtureOf(latestLone.matchId),
        }
      : null,
    pulse: [...dayTotals.entries()]
      .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
      .slice(-6)
      .map(([matchday, total]) => ({ matchday, total: micro(total) / 1e6 })),
  };
}

/**
 * The most recent fully-finished matchday STRICTLY BEFORE the current one —
 * the day the Today banner recaps. A day still awaiting results is skipped
 * (a partial wrap would crown a premature winner).
 */
export function latestWrappableMatchday(db: Db, beforeDay: string): string | null {
  const all = db.select().from(schema.matches).all();
  const byDay = new Map<string, { finished: number; total: number }>();
  for (const m of all) {
    if (m.matchday >= beforeDay) continue;
    const c = byDay.get(m.matchday) ?? { finished: 0, total: 0 };
    c.total += 1;
    if (m.status === 'finished') c.finished += 1;
    byDay.set(m.matchday, c);
  }
  const done = [...byDay.entries()]
    .filter(([, c]) => c.total > 0 && c.finished === c.total)
    .map(([d]) => d)
    .sort();
  return done.length > 0 ? done[done.length - 1] : null;
}
