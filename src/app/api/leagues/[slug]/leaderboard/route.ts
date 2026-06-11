import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug, prizePool } from '@/lib/services/leagues';
import { getLeaderboard } from '@/lib/services/leaderboard';
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
  return jsonOk({
    rows,
    prizePool: prizePool(league, entryCountOf(db, league.id)),
    memberCount: memberCountOf(db, league.id),
  });
});
