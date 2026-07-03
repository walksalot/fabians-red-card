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
  /** Biggest single-match haul of the day. */
  biggestHaul: { entryId: number; label: string; points: number; matchId: number } | null;
  /** Entries that banked zero across the whole day (only when they had picks to make). */
  blankedCount: number;
  exactCount: number;
  /**
   * Sole-caller: matches where EXACTLY ONE entry got the result right
   * (outcome or exact) — the day's "only X saw it coming" line.
   */
  soleCalls: Array<{ entryId: number; label: string; matchId: number }>;
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
  let biggest: MatchdayWrap['biggestHaul'] = null;
  let exactCount = 0;
  /** matchId -> entryIds that got the result right (exact or outcome). */
  const callers = new Map<number, number[]>();

  for (const p of points) {
    totals.set(p.entryId, (totals.get(p.entryId) ?? 0) + p.total);
    if (biggest === null || p.total > biggest.points) {
      biggest = {
        entryId: p.entryId,
        label: labelOf.get(p.entryId) ?? '?',
        points: p.total,
        matchId: p.matchId,
      };
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

  const dayTotals: WrapEntryDay[] = entries
    .map((e) => ({ entryId: e.id, label: e.label, total: totals.get(e.id) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.entryId - b.entryId);
  const top = dayTotals[0]?.total ?? 0;
  // A day where nobody scored crowns no winner — "won the day with 0" is a jab
  // the wrap should not make for the app (the group chat can).
  const dayWinners = top > 0 ? dayTotals.filter((t) => t.total === top) : [];
  const blankedCount = dayTotals.filter((t) => t.total === 0).length;

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

  return {
    matchday,
    matchCount: dayMatches.length,
    entryCount: entries.length,
    dayTotals,
    dayWinners,
    biggestHaul: biggest && biggest.points > 0 ? biggest : null,
    blankedCount,
    exactCount,
    soleCalls,
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
