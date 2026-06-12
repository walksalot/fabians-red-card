import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug, prizePool } from '@/lib/services/leagues';
import { getLeaderboard } from '@/lib/services/leaderboard';
import { getLockedPicksByEntry } from '@/app/league/[slug]/_components/leaderboard-picks';
import { getTodayPointsByEntry } from '@/app/league/[slug]/_components/today-points';
import {
  entryCountOf,
  handle,
  jsonOk,
  memberCountOf,
} from '@/lib/api-helpers';

type RouteCtx = { params: Promise<{ slug: string }> };

export const GET = handle<RouteCtx>(async (_req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  const rows = await getLeaderboard(db, league.id);
  // Additive display field: points banked on the current matchday, so the
  // table can render the "+N today" daily-race delta beside season totals.
  const todayPoints = getTodayPointsByEntry(db, league.id);
  // Additive display field: each entry's picks on locked/finished matches of
  // the current matchday — drives the table's expandable rows. Open picks are
  // filtered server-side and never serialized.
  const lockedPicks = getLockedPicksByEntry(db, league.id);
  return jsonOk({
    rows: rows.map((r) => ({
      ...r,
      todayPoints: todayPoints.get(r.entryId) ?? 0,
      lockedPicks: lockedPicks.get(r.entryId) ?? [],
    })),
    prizePool: prizePool(league, entryCountOf(db, league.id)),
    memberCount: memberCountOf(db, league.id),
    // Pool math is per ENTRY while the card cites members — ship both so the
    // card can name the entry count whenever the two denominators differ.
    entryCount: entryCountOf(db, league.id),
  });
});
