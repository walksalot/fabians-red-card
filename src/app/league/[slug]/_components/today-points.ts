/**
 * Server-only helper: points each entry has banked on the CURRENT matchday —
 * the latest matchday with any kicked-off match. Feeds the leaderboard's
 * emerald "+N" daily-race delta (table page + polling API), purely additive
 * display data on top of getLeaderboard's season totals.
 *
 * NEVER import this from a 'use client' component (it touches the db).
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';

/** Map of entryId → points scored on the latest kicked-off matchday. */
export function getTodayPointsByEntry(
  db: Db,
  leagueId: number,
): Map<number, number> {
  const entryRows = db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entryRows.length === 0) return new Map();

  const matches = db
    .select({
      id: schema.matches.id,
      matchday: schema.matches.matchday,
      kickoffUtc: schema.matches.kickoffUtc,
    })
    .from(schema.matches)
    .all();

  // "Today" = the latest matchday (YYYY-MM-DD sorts lexicographically) that
  // has at least one kicked-off match per the game clock (FAKE_NOW-aware).
  const now = nowMs();
  let latestDay: string | null = null;
  for (const m of matches) {
    if (Date.parse(m.kickoffUtc) <= now) {
      if (latestDay === null || m.matchday > latestDay) latestDay = m.matchday;
    }
  }
  if (latestDay === null) return new Map();
  const dayMatchIds = new Set(
    matches.filter((m) => m.matchday === latestDay).map((m) => m.id),
  );

  const pointRows = db
    .select({
      entryId: schema.matchPoints.entryId,
      matchId: schema.matchPoints.matchId,
      total: schema.matchPoints.total,
    })
    .from(schema.matchPoints)
    .where(
      inArray(
        schema.matchPoints.entryId,
        entryRows.map((r) => r.id),
      ),
    )
    .all();

  const byEntry = new Map<number, number>();
  for (const p of pointRows) {
    if (!dayMatchIds.has(p.matchId)) continue;
    byEntry.set(p.entryId, (byEntry.get(p.entryId) ?? 0) + p.total);
  }
  // Multipliers make totals floats — round to micro-points like the
  // leaderboard service does so "+7.5" never displays as "+7.4999…".
  for (const [k, v] of byEntry) byEntry.set(k, Math.round(v * 1e6) / 1e6);
  return byEntry;
}
